import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Buffer } from "@craftzdog/react-native-buffer";
import { useMobileWallet } from "@wallet-ui/react-native-web3js";
import QRCode from "react-native-qrcode-svg";
import { WalletOutputError, walletResultBytes } from "./wallet-result-bytes";

const appExtra = Constants.expoConfig?.extra ?? {};
const API_URL = String(appExtra.referralApiUrl ?? "https://api.lucky-me.app")
  .replace(/\/$/, "");
const TEST_MODE_UI = appExtra.referralTestMode === true;
const SESSION_KEY = TEST_MODE_UI
  ? "luckyme.seekerReferralTest.session"
  : "luckyme.seekerReferral.session";
const PENDING_CODE_KEY = TEST_MODE_UI
  ? "luckyme.seekerReferralTest.pendingReferralCode"
  : "luckyme.seekerReferral.pendingReferralCode";
const CODE_RE = /^LM-[A-HJ-NP-Z2-9]{6}$/;

type VerificationState =
  | "IDLE"
  | "VERIFYING"
  | "VERIFIED"
  | "NO_SGT"
  | "INVALID_SIWS"
  | "SGT_ALREADY_BOUND"
  | "NETWORK_ERROR"
  | "BACKEND_UNAVAILABLE";

type ReferralProfile = {
  state: "VERIFIED";
  walletMasked: string;
  skrDomain: string | null;
  sgtMintMasked: string;
  verifiedAt: string;
  referralCode: string;
  profileStatus: "pending_activation" | "active";
  season: { name: string; closesAt: string };
  stats: {
    qualifiedReferrals: number;
    pendingReferrals: number;
    invalidatedReferrals: number;
    totalPoints: number;
  };
  prizePreview: string;
  disclaimer: string;
};

type LeaderboardEntry = {
  rank: number;
  referralCode: string;
  qualifiedReferrals: number;
  pendingReferrals: number;
  invalidatedReferrals: number;
  totalPoints: number;
};

class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function randomIdempotencyKey(prefix: string) {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}:${Date.now()}:${Buffer.from(bytes).toString("hex")}`;
}

function parseReferralCode(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    const candidate = segments.at(-1)?.toUpperCase();
    const pathKind = segments.at(-2);
    if ((url.hostname === "www.lucky-me.app" && (pathKind === "referral" || pathKind === "referral-test")) ||
        url.protocol === "luckyme:" || url.protocol === "luckyme-seeker-referral-test:") {
      return candidate && CODE_RE.test(candidate) ? candidate : null;
    }
  } catch {
    return null;
  }
  return null;
}

function referralUrl(code: string) {
  return `https://www.lucky-me.app/${TEST_MODE_UI ? "referral-test" : "referral"}/${code}`;
}

async function request(path: string, options: RequestInit = {}, token?: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const responseCode = typeof payload.error === "string" ? payload.error : "request_failed";
      if (response.status === 404 && responseCode.replace(/[_ -]/g, "").toLowerCase() === "notfound") {
        throw new ApiError(404, "backend_unavailable", "The Seeker referral service is not available on the server");
      }
      throw new ApiError(response.status, responseCode, payload.message ?? "Request failed");
    }
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, "network_error", "The referral service could not be reached");
  } finally {
    clearTimeout(timer);
  }
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return parsed.toLocaleString();
}

function stateFromError(error: unknown): VerificationState {
  if (error instanceof WalletOutputError) return "INVALID_SIWS";
  if (!(error instanceof ApiError)) return "NETWORK_ERROR";
  if (error.code === "no_sgt") return "NO_SGT";
  if (["invalid_siws", "nonce_expired", "nonce_reused"].includes(error.code)) return "INVALID_SIWS";
  if (error.code === "sgt_already_bound") return "SGT_ALREADY_BOUND";
  if (error.status === 404 || error.code === "backend_unavailable") return "BACKEND_UNAVAILABLE";
  if (error.status === 503 || error.status >= 500) return "BACKEND_UNAVAILABLE";
  return error.status === 0 ? "NETWORK_ERROR" : "BACKEND_UNAVAILABLE";
}

function ActionButton({
  label,
  onPress,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.buttonSecondary,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{label}</Text>
    </Pressable>
  );
}

function VerificationRail({ connected, verified, registered }: {
  connected: boolean;
  verified: boolean;
  registered: boolean;
}) {
  const steps = [
    ["Device surface", true, "Informational only — never grants eligibility"],
    ["Wallet connected", connected, "Mobile Wallet Adapter"],
    ["SIWS verified", verified, "Cryptographic server verification"],
    ["SGT verified", verified, "Token-2022 authenticity checked on mainnet"],
    ["Referral registered", registered, "Immutable server-side identity"],
  ] as const;
  return (
    <View style={styles.rail}>
      {steps.map(([label, complete, detail]) => (
        <View key={label} style={styles.railRow}>
          <View style={[styles.railDot, complete && styles.railDotComplete]} />
          <View style={styles.railCopy}>
            <Text style={styles.railLabel}>{label}</Text>
            <Text style={styles.railDetail}>{detail}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function SeekerReferralScreen({
  incomingReferralUrl,
  onClose,
}: {
  incomingReferralUrl?: string | null;
  onClose?: () => void;
} = {}) {
  const wallet = useMobileWallet();
  const [state, setState] = useState<VerificationState>("IDLE");
  const [profile, setProfile] = useState<ReferralProfile | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [howVisible, setHowVisible] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [lastSignedWallet, setLastSignedWallet] = useState<string | null>(null);

  const connected = Boolean(wallet.account);
  const verified = state === "VERIFIED" && Boolean(profile);
  const registered = profile?.profileStatus === "active";

  const rememberDeepLink = useCallback(async (url: string | null) => {
    const code = parseReferralCode(url);
    if (!code) return;
    setPendingCode(code);
    await SecureStore.setItemAsync(PENDING_CODE_KEY, code, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    setLastMessage(`Referral ${code} is waiting for verification and confirmation.`);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      SecureStore.getItemAsync(SESSION_KEY),
      SecureStore.getItemAsync(PENDING_CODE_KEY),
      Linking.getInitialURL(),
    ]).then(async ([storedSession, storedCode, initialUrl]) => {
      if (!active) return;
      if (storedCode && CODE_RE.test(storedCode)) setPendingCode(storedCode);
      await rememberDeepLink(initialUrl);
      if (!storedSession) return;
      try {
        const restored = await request("/api/seeker/profile", {}, storedSession);
        if (!active) return;
        setSessionToken(storedSession);
        setProfile(restored);
        setState("VERIFIED");
      } catch {
        await SecureStore.deleteItemAsync(SESSION_KEY);
      }
    }).catch(() => undefined);
    const subscription = Linking.addEventListener("url", ({ url }) => {
      rememberDeepLink(url).catch(() => undefined);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [rememberDeepLink]);

  useEffect(() => {
    if (incomingReferralUrl) {
      rememberDeepLink(incomingReferralUrl).catch(() => undefined);
    }
  }, [incomingReferralUrl, rememberDeepLink]);

  const loadLeaderboard = useCallback(async (token: string) => {
    try {
      const data = await request("/api/referrals/leaderboard", {}, token);
      setLeaderboard(data.entries ?? []);
    } catch {
      setLeaderboard([]);
    }
  }, []);

  useEffect(() => {
    if (sessionToken && verified) loadLeaderboard(sessionToken).catch(() => undefined);
  }, [loadLeaderboard, sessionToken, verified]);

  const bindPendingCode = useCallback(async (token: string, code: string) => {
    setBusyLabel("Binding referral");
    try {
      await request("/api/referrals/bind", {
        method: "POST",
        body: JSON.stringify({
          referralCode: code,
          idempotencyKey: randomIdempotencyKey("bind"),
        }),
      }, token);
      await SecureStore.deleteItemAsync(PENDING_CODE_KEY);
      setPendingCode(null);
      const refreshed = await request("/api/seeker/profile", {}, token);
      setProfile(refreshed);
      setLastMessage(`Referral ${code} was confirmed and permanently bound.`);
      await loadLeaderboard(token);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Referral binding failed";
      Alert.alert("Referral not bound", message);
      if (error instanceof ApiError && error.code === "referral_code_not_found") {
        await SecureStore.deleteItemAsync(PENDING_CODE_KEY);
        setPendingCode(null);
      }
    } finally {
      setBusyLabel(null);
    }
  }, [loadLeaderboard]);

  const continueWithoutReferral = useCallback(async () => {
    if (!sessionToken) return;
    setBusyLabel("Activating without referral");
    try {
      await request("/api/referrals/activate", {
        method: "POST",
        body: JSON.stringify({}),
      }, sessionToken);
      await SecureStore.deleteItemAsync(PENDING_CODE_KEY);
      setPendingCode(null);
      const refreshed = await request("/api/seeker/profile", {}, sessionToken);
      setProfile(refreshed);
      setLastMessage("Profile activated without a referral. A referral cannot be added later.");
    } catch (error) {
      Alert.alert("Profile not activated", error instanceof Error ? error.message : "Activation failed");
    } finally {
      setBusyLabel(null);
    }
  }, [sessionToken]);

  const previewAndConfirm = useCallback(async (token: string, code: string) => {
    try {
      const preview = await request(`/api/referrals/preview/${encodeURIComponent(code)}`, {}, token);
      Alert.alert(
        "Confirm referral",
        `Code ${preview.referralCode}\nReferrer ${preview.referrerMasked}\n\nThis binding cannot be changed later.`,
        [
          { text: "Not now", style: "cancel" },
          { text: "Confirm binding", onPress: () => bindPendingCode(token, code).catch(() => undefined) },
        ],
      );
    } catch (error) {
      Alert.alert("Invalid referral link", error instanceof Error ? error.message : "Referral code is unavailable");
      if (error instanceof ApiError && error.code === "referral_code_not_found") {
        await SecureStore.deleteItemAsync(PENDING_CODE_KEY);
        setPendingCode(null);
      }
    }
  }, [bindPendingCode]);

  const verifySeeker = useCallback(async () => {
    setState("VERIFYING");
    setBusyLabel("Requesting secure nonce");
    setLastMessage(null);
    try {
      const nonce = await request("/api/seeker/nonce", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setBusyLabel("Approve SIWS in your wallet");
      const output = await wallet.signIn(nonce.payload);
      const signedWalletAddress = output.account.address.toBase58();
      setLastSignedWallet(signedWalletAddress);
      const publicKey = walletResultBytes(output.account.address.toBytes(), "public key", 32);
      const signature = walletResultBytes(output.signature, "signature", 64);
      const signedMessage = walletResultBytes(output.signedMessage, "signed message");
      setBusyLabel("Verifying SGT on mainnet");
      const result = await request("/api/seeker/verify-siws", {
        method: "POST",
        body: JSON.stringify({
          payload: nonce.payload,
          output: {
            publicKey: Buffer.from(publicKey).toString("base64"),
            signature: Buffer.from(signature).toString("base64"),
            signedMessage: Buffer.from(signedMessage).toString("base64"),
          },
          hasPendingReferral: Boolean(pendingCode),
        }),
      });
      await SecureStore.setItemAsync(SESSION_KEY, result.sessionToken, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      setSessionToken(result.sessionToken);
      setProfile(result.profile);
      setState("VERIFIED");
      setLastMessage("Wallet ownership and authentic Seeker Genesis Token verified.");
      await loadLeaderboard(result.sessionToken);
      if (pendingCode) {
        setTimeout(() => previewAndConfirm(result.sessionToken, pendingCode).catch(() => undefined), 250);
      }
    } catch (error) {
      setState(stateFromError(error));
      setLastMessage(error instanceof Error ? error.message : "Verification failed");
    } finally {
      setBusyLabel(null);
    }
  }, [loadLeaderboard, pendingCode, previewAndConfirm, wallet]);

  const clearWalletSelection = useCallback(async () => {
    setBusyLabel("Clearing wallet selection");
    try {
      if (sessionToken) {
        await request("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }, sessionToken)
          .catch(() => undefined);
      }
      await Promise.all([
        SecureStore.deleteItemAsync(SESSION_KEY),
        wallet.disconnect().catch(() => undefined),
      ]);
      setSessionToken(null);
      setProfile(null);
      setLeaderboard([]);
      setLastSignedWallet(null);
      setState("IDLE");
      setLastMessage("Wallet selection cleared. Tap Verify and choose the PRIMARY Seed Vault wallet that holds your Genesis Token.");
    } finally {
      setBusyLabel(null);
    }
  }, [sessionToken, wallet]);

  const disconnect = useCallback(async () => {
    setBusyLabel("Disconnecting");
    try {
      if (sessionToken) {
        await request("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }, sessionToken)
          .catch(() => undefined);
      }
      await Promise.all([
        SecureStore.deleteItemAsync(SESSION_KEY),
        wallet.disconnect().catch(() => undefined),
      ]);
      setSessionToken(null);
      setProfile(null);
      setLeaderboard([]);
      setLastSignedWallet(null);
      setState("IDLE");
      setLastMessage("Disconnected. No offline eligibility is retained.");
    } finally {
      setBusyLabel(null);
    }
  }, [sessionToken, wallet]);

  const simulateQualification = useCallback(async () => {
    if (!sessionToken) return;
    setBusyLabel("Simulating test qualification");
    try {
      await request("/api/test/referrals/simulate-qualification", {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: randomIdempotencyKey("qualify") }),
      }, sessionToken);
      const refreshed = await request("/api/seeker/profile", {}, sessionToken);
      setProfile(refreshed);
      await loadLeaderboard(sessionToken);
      setLastMessage("Qualified test referral recorded. No payment or blockchain transaction occurred.");
    } catch (error) {
      Alert.alert("Simulation unavailable", error instanceof Error ? error.message : "Simulation failed");
    } finally {
      setBusyLabel(null);
    }
  }, [loadLeaderboard, sessionToken]);

  const shareLink = useMemo(() => profile ? referralUrl(profile.referralCode) : "", [profile]);

  const renderStateMessage = () => {
    const messages: Partial<Record<VerificationState, string>> = {
      NO_SGT: "No valid Seeker Genesis Token was found in the connected wallet.",
      INVALID_SIWS: "Wallet ownership verification failed.",
      SGT_ALREADY_BOUND: "This Seeker Genesis Token is already registered.",
      NETWORK_ERROR: "Network error. Retry is safe and will not duplicate profiles or events.",
      BACKEND_UNAVAILABLE: "Verification backend unavailable. Eligibility is never granted offline.",
    };
    const message = messages[state];
    if (!message) return null;
    const noSgt = state === "NO_SGT";
    return (
      <View style={[styles.stateCard, state === "NO_SGT" ? styles.stateCardAmber : styles.stateCardRed]}>
        <Text style={styles.stateTitle}>{state}</Text>
        <Text style={styles.stateText}>{message}</Text>
        {noSgt && lastSignedWallet && (
          <View style={styles.walletDiagnostic}>
            <Text style={styles.walletDiagnosticLabel}>WALLET CHECKED ON MAINNET</Text>
            <Text selectable style={styles.walletDiagnosticAddress}>{lastSignedWallet}</Text>
            <ActionButton
              label="Copy wallet address"
              onPress={() => Clipboard.setStringAsync(lastSignedWallet)}
              secondary
            />
          </View>
        )}
        {noSgt && (
          <>
            <Text style={styles.stateHint}>
              Open Seed Vault Wallet and confirm the Genesis Token is claimed in this exact wallet. If this is not your primary wallet, clear the selection and choose the primary account on the next wallet prompt.
            </Text>
            <ActionButton label="Clear and choose another wallet" onPress={clearWalletSelection} secondary />
            <ActionButton
              label="Open official SGT setup help"
              onPress={() => Linking.openURL("https://wallet-help.solanamobile.com/en/articles/11727929-what-is-a-seeker-id")}
              secondary
            />
          </>
        )}
        <ActionButton label="Try again" onPress={verifySeeker} secondary />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.ambientPurple} />
        <View style={styles.ambientCyan} />
        <View style={styles.header}>
          {onClose && (
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.backButton}>
              <Text style={styles.backButtonText}>‹ Back to LuckyMe</Text>
            </Pressable>
          )}
          <Text style={styles.eyebrow}>LUCKYME · SEEKER EXCLUSIVE</Text>
          <Text style={styles.title}>Seeker Referral League</Text>
          <Text style={styles.subtitle}>Verify your Seeker ownership and invite other verified Seeker owners.</Text>
        </View>

        <VerificationRail connected={connected} verified={verified} registered={registered} />

        {busyLabel && (
          <View style={styles.busyCard}>
            <ActivityIndicator color="#14F1D9" />
            <Text style={styles.busyText}>{busyLabel}</Text>
          </View>
        )}

        {pendingCode && (
          <View style={styles.pendingCard}>
            <Text style={styles.pendingLabel}>PENDING REFERRAL</Text>
            <Text style={styles.pendingCode}>{pendingCode}</Text>
            <Text style={styles.pendingText}>It will be bound only after SGT verification and your explicit confirmation.</Text>
            {verified && sessionToken && (
              <>
                <ActionButton label="Review and confirm" onPress={() => previewAndConfirm(sessionToken, pendingCode)} secondary />
                <ActionButton
                  label="Continue without referral"
                  onPress={() => Alert.alert(
                    "Continue without referral?",
                    "Your profile will become active and a referral cannot be added later.",
                    [
                      { text: "Cancel", style: "cancel" },
                      { text: "Continue", style: "destructive", onPress: () => continueWithoutReferral().catch(() => undefined) },
                    ],
                  )}
                  secondary
                />
              </>
            )}
          </View>
        )}

        {lastMessage && <Text style={styles.message}>{lastMessage}</Text>}
        {renderStateMessage()}

        {!verified && state !== "VERIFYING" && (
          <View style={styles.actions}>
            <ActionButton label="Verify my Seeker" onPress={verifySeeker} />
            <ActionButton label="How verification works" onPress={() => setHowVisible(true)} secondary />
            <ActionButton label="Disconnect" onPress={disconnect} secondary />
          </View>
        )}

        {profile && verified && (
          <>
            <View style={styles.verifiedCard}>
              <View style={styles.verifiedBadge}><Text style={styles.verifiedBadgeText}>✓ VERIFIED</Text></View>
              <Text style={styles.verifiedTitle}>Verified Seeker Owner</Text>
              <View style={styles.detailRow}><Text style={styles.detailLabel}>Wallet</Text><Text style={styles.detailValue}>{profile.walletMasked}</Text></View>
              {profile.skrDomain ? (
                <View style={styles.detailRow}><Text style={styles.detailLabel}>.skr</Text><Text style={styles.detailValue}>{profile.skrDomain}</Text></View>
              ) : null}
              <View style={styles.detailRow}><Text style={styles.detailLabel}>SGT mint</Text><Text style={styles.detailValue}>{profile.sgtMintMasked}</Text></View>
              <View style={styles.detailRow}><Text style={styles.detailLabel}>Verified</Text><Text style={styles.detailValue}>{formatDate(profile.verifiedAt)}</Text></View>
              <View style={styles.codePanel}>
                <Text style={styles.codeLabel}>YOUR REFERRAL CODE</Text>
                <Text style={styles.code}>{profile.referralCode}</Text>
                <Text style={styles.linkText}>{shareLink}</Text>
              </View>
              {profile.profileStatus === "pending_activation" && (
                <Text style={styles.activationNote}>Confirm the pending referral before this profile becomes active.</Text>
              )}
              <View style={styles.actions}>
                <ActionButton label="Share referral" onPress={() => Share.share({ message: `Join the LuckyMe Seeker Referral League: ${shareLink}`, url: shareLink })} />
                <ActionButton label="Copy code" onPress={() => Clipboard.setStringAsync(profile.referralCode)} secondary />
                <ActionButton label="Show QR" onPress={() => setQrVisible(true)} secondary />
                {TEST_MODE_UI && (
                  <ActionButton label="Simulate qualification" onPress={simulateQualification} secondary />
                )}
                <ActionButton label="Disconnect" onPress={disconnect} secondary />
              </View>
            </View>

            {TEST_MODE_UI ? (
              <>
                <View style={styles.seasonCard}>
                  <Text style={styles.sectionEyebrow}>TEST LEAGUE</Text>
                  <Text style={styles.sectionTitle}>{profile.season.name}</Text>
                  <View style={styles.metrics}>
                    <View style={styles.metric}><Text style={styles.metricValue}>{profile.stats.qualifiedReferrals}</Text><Text style={styles.metricLabel}>Qualified</Text></View>
                    <View style={styles.metric}><Text style={styles.metricValue}>{profile.stats.pendingReferrals}</Text><Text style={styles.metricLabel}>Pending</Text></View>
                    <View style={styles.metric}><Text style={styles.metricValue}>{profile.stats.invalidatedReferrals}</Text><Text style={styles.metricLabel}>Invalid</Text></View>
                    <View style={styles.metric}><Text style={styles.metricValue}>{profile.stats.totalPoints}</Text><Text style={styles.metricLabel}>Points</Text></View>
                  </View>
                  <Text style={styles.closeText}>Closes {formatDate(profile.season.closesAt)}</Text>
                  <Text style={styles.prizeText}>Prize preview: {profile.prizePreview}</Text>
                  <Text style={styles.disclaimer}>{profile.disclaimer}</Text>
                </View>

                <View style={styles.leaderboardCard}>
                  <Text style={styles.sectionEyebrow}>LEADERBOARD</Text>
                  {leaderboard.length === 0 ? (
                    <Text style={styles.emptyText}>No ranked test referrals yet.</Text>
                  ) : leaderboard.map((entry) => (
                    <View style={styles.leaderRow} key={`${entry.rank}-${entry.referralCode}`}>
                      <Text style={styles.rank}>#{entry.rank}</Text>
                      <View style={styles.leaderCopy}>
                        <Text style={styles.leaderCode}>{entry.referralCode}</Text>
                        <Text style={styles.leaderDetail}>{entry.qualifiedReferrals} qualified · {entry.pendingReferrals} pending · {entry.invalidatedReferrals} invalid</Text>
                      </View>
                      <Text style={styles.points}>{entry.totalPoints} pt</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : (
              <View style={styles.seasonCard}>
                <Text style={styles.sectionEyebrow}>REFERRAL LEAGUE</Text>
                <Text style={styles.sectionTitle}>Your verified referral profile is ready</Text>
                <Text style={styles.closeText}>Share your code with other Seeker owners. Season rankings and rewards appear here only when officially active.</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={howVisible} transparent animationType="fade" onRequestClose={() => setHowVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>How verification works</Text>
            <Text style={styles.modalBody}>1. Mobile Wallet Adapter opens your installed wallet.</Text>
            <Text style={styles.modalBody}>2. SIWS signs a one-time message — not a transaction.</Text>
            <Text style={styles.modalBody}>3. The backend verifies the signature, domain, URI, nonce and expiry.</Text>
            <Text style={styles.modalBody}>4. Mainnet is queried read-only for an authentic Token-2022 SGT.</Text>
            <Text style={styles.modalBody}>5. The unique SGT mint becomes the anti-duplicate identity.</Text>
            <Text style={styles.modalWarning}>No SOL, SKR or ticket payment is requested.</Text>
            <ActionButton label="Close" onPress={() => setHowVisible(false)} />
          </View>
        </View>
      </Modal>

      <Modal visible={qrVisible} transparent animationType="fade" onRequestClose={() => setQrVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, styles.qrCard]}>
            <Text style={styles.modalTitle}>Referral QR</Text>
            {shareLink ? <View style={styles.qrWrap}><QRCode value={shareLink} size={210} color="#050609" backgroundColor="#FFFFFF" /></View> : null}
            <Text style={styles.qrCode}>{profile?.referralCode}</Text>
            <ActionButton label="Close" onPress={() => setQrVisible(false)} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#050609" },
  page: { paddingHorizontal: 20, paddingTop: 36, paddingBottom: 56, gap: 16, overflow: "hidden" },
  ambientPurple: { position: "absolute", width: 280, height: 280, borderRadius: 140, backgroundColor: "rgba(124,58,237,0.18)", top: -120, right: -120 },
  ambientCyan: { position: "absolute", width: 240, height: 240, borderRadius: 120, backgroundColor: "rgba(20,241,217,0.08)", top: 270, left: -150 },
  header: { gap: 8, marginBottom: 4 },
  backButton: { alignSelf: "flex-start", paddingVertical: 7, paddingRight: 14, marginBottom: 2 },
  backButtonText: { color: "#14F1D9", fontSize: 14, fontWeight: "800" },
  eyebrow: { color: "#14F1D9", fontSize: 11, fontWeight: "800", letterSpacing: 1.8 },
  title: { color: "#F7F8FC", fontSize: 34, lineHeight: 39, fontWeight: "800", letterSpacing: -1.2 },
  subtitle: { color: "#9CA6B7", fontSize: 16, lineHeight: 23, maxWidth: 340 },
  rail: { borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(14,18,28,0.82)", borderRadius: 22, padding: 18, gap: 14 },
  railRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  railDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: "#5D687A", backgroundColor: "#181E29" },
  railDotComplete: { backgroundColor: "#14F195", borderColor: "#14F195", shadowColor: "#14F195", shadowOpacity: 0.8, shadowRadius: 8 },
  railCopy: { flex: 1 },
  railLabel: { color: "#F0F3F8", fontSize: 14, fontWeight: "700" },
  railDetail: { color: "#788397", fontSize: 12, marginTop: 2 },
  busyCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 16, backgroundColor: "rgba(20,241,217,0.09)", borderWidth: 1, borderColor: "rgba(20,241,217,0.25)" },
  busyText: { color: "#D9FFFA", fontWeight: "700" },
  pendingCard: { padding: 18, borderRadius: 20, backgroundColor: "rgba(245,158,11,0.10)", borderWidth: 1, borderColor: "rgba(245,158,11,0.28)", gap: 7 },
  pendingLabel: { color: "#F6B94A", fontSize: 11, letterSpacing: 1.5, fontWeight: "800" },
  pendingCode: { color: "#FFF4D6", fontSize: 24, fontWeight: "800" },
  pendingText: { color: "#B8A987", fontSize: 13, lineHeight: 19, marginBottom: 4 },
  message: { color: "#AAB4C6", fontSize: 13, lineHeight: 19, textAlign: "center" },
  actions: { gap: 10, marginTop: 4 },
  button: { minHeight: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#7857FF", paddingHorizontal: 16, borderWidth: 1, borderColor: "#8D75FF" },
  buttonSecondary: { backgroundColor: "rgba(255,255,255,0.035)", borderColor: "rgba(255,255,255,0.12)" },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { transform: [{ scale: 0.985 }], opacity: 0.9 },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  buttonTextSecondary: { color: "#CFD6E3" },
  stateCard: { padding: 18, borderRadius: 20, borderWidth: 1, gap: 8 },
  stateCardAmber: { backgroundColor: "rgba(245,158,11,0.10)", borderColor: "rgba(245,158,11,0.30)" },
  stateCardRed: { backgroundColor: "rgba(248,113,113,0.09)", borderColor: "rgba(248,113,113,0.28)" },
  stateTitle: { color: "#F5B5B5", fontWeight: "900", letterSpacing: 1 },
  stateText: { color: "#D6BDBD", lineHeight: 20, marginBottom: 5 },
  stateHint: { color: "#FFF1C7", fontSize: 13, lineHeight: 20 },
  walletDiagnostic: { gap: 9, borderRadius: 14, padding: 12, backgroundColor: "rgba(0,0,0,0.22)", borderWidth: 1, borderColor: "rgba(255,214,102,0.28)" },
  walletDiagnosticLabel: { color: "#FFD666", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  walletDiagnosticAddress: { color: "#FFFFFF", fontSize: 12, lineHeight: 18 },
  verifiedCard: { padding: 20, borderRadius: 24, backgroundColor: "rgba(10,24,23,0.90)", borderWidth: 1, borderColor: "rgba(20,241,149,0.32)", gap: 12 },
  verifiedBadge: { alignSelf: "flex-start", backgroundColor: "rgba(20,241,149,0.13)", borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7 },
  verifiedBadgeText: { color: "#37F6A7", fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  verifiedTitle: { color: "#F5FFF9", fontSize: 25, fontWeight: "800", marginBottom: 4 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.10)", paddingBottom: 10 },
  detailLabel: { color: "#7E918B", fontSize: 13 },
  detailValue: { color: "#DCEAE5", fontSize: 13, fontWeight: "700", flexShrink: 1, textAlign: "right" },
  codePanel: { marginTop: 4, padding: 18, alignItems: "center", borderRadius: 18, backgroundColor: "rgba(124,58,237,0.13)", borderWidth: 1, borderColor: "rgba(139,92,246,0.25)" },
  codeLabel: { color: "#AFA0F8", fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  code: { color: "#FFFFFF", fontSize: 31, fontWeight: "900", letterSpacing: 2, marginVertical: 7 },
  linkText: { color: "#8390A6", fontSize: 10, textAlign: "center" },
  activationNote: { color: "#F4BD56", textAlign: "center", lineHeight: 19 },
  seasonCard: { padding: 20, borderRadius: 24, backgroundColor: "rgba(14,18,28,0.86)", borderWidth: 1, borderColor: "rgba(124,58,237,0.24)", gap: 10 },
  sectionEyebrow: { color: "#9A82FF", fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  sectionTitle: { color: "#F3F5FA", fontSize: 21, fontWeight: "800" },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  metric: { flexGrow: 1, minWidth: "45%", padding: 14, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.035)" },
  metricValue: { color: "#F9FAFC", fontSize: 23, fontWeight: "900" },
  metricLabel: { color: "#7F8A9E", fontSize: 11, marginTop: 3 },
  closeText: { color: "#A2ACBD", fontSize: 13 },
  prizeText: { color: "#CBD1DC", fontSize: 13 },
  disclaimer: { color: "#F6B94A", fontSize: 12, fontWeight: "900", letterSpacing: 0.5, marginTop: 4 },
  leaderboardCard: { padding: 20, borderRadius: 24, backgroundColor: "rgba(14,18,28,0.86)", borderWidth: 1, borderColor: "rgba(255,255,255,0.09)", gap: 12 },
  emptyText: { color: "#7F8A9E", paddingVertical: 8 },
  leaderRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.09)" },
  rank: { color: "#9C85FF", fontWeight: "900", width: 28 },
  leaderCopy: { flex: 1 },
  leaderCode: { color: "#EBEEF4", fontWeight: "800" },
  leaderDetail: { color: "#747F91", fontSize: 10, marginTop: 3 },
  points: { color: "#14F1D9", fontWeight: "900" },
  modalBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.78)", padding: 20 },
  modalCard: { width: "100%", maxWidth: 420, padding: 22, borderRadius: 24, backgroundColor: "#101522", borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", gap: 13 },
  modalTitle: { color: "#F5F7FB", fontSize: 24, fontWeight: "900" },
  modalBody: { color: "#A9B2C2", fontSize: 14, lineHeight: 21 },
  modalWarning: { color: "#37F6A7", fontSize: 13, lineHeight: 19, fontWeight: "800" },
  qrCard: { alignItems: "center" },
  qrWrap: { padding: 14, backgroundColor: "#FFFFFF", borderRadius: 18 },
  qrCode: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", letterSpacing: 1.5 },
});
