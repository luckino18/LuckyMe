import { Buffer } from "@craftzdog/react-native-buffer";
import { useMobileWallet } from "@wallet-ui/react-native-web3js";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import * as Clipboard from "expo-clipboard";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  ImageBackground,
  Linking,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { userFacingError } from "./user-facing-error";
import { walletResultBytes } from "./wallet-result-bytes";

type CommunityTab = "missions" | "profile";

type Profile = {
  wallet: string;
  username: string;
  displayName: string;
  luckyPoints: number;
  reservedPoints: number;
  availablePoints: number;
  usernameState: {
    canCustomize: boolean;
    finalizedAt?: string | null;
    warning: string;
  };
  identities: Array<{ platform: string; displayHandle: string; verifiedAt: string }>;
  tasks: { completed: number; pending: number };
  xp: {
    total: number;
    level: number;
    rankKey: string;
    rankTitle: string;
    frameTitle: string;
    progress: number;
    nextLevel: number;
    progressPercent: number;
  };
  avatar: {
    id: string;
    name: string;
    assetKey: string;
    minLevel: number;
    pricePoints: number;
    rankKey: string;
  } | null;
  avatars: Array<{
    id: string;
    name: string;
    assetKey: string;
    minLevel: number;
    pricePoints: number;
    rankKey: string;
    owned: boolean;
    levelUnlocked: boolean;
  }>;
};

type Task = {
  id: string;
  title: string;
  description: string;
  platform: "discord" | "x" | "community";
  verificationType: string;
  actionType?: "like" | "follow" | "repost" | "comment" | null;
  actionLabel?: string | null;
  targetUrl?: string | null;
  rewardPoints: number;
  rewardXp: number;
  minLevel: number;
  maxLevel: number;
  participantLimit?: number | null;
  eligible: boolean;
  eligibility?: {
    levelEligible: boolean;
    capacityAvailable: boolean;
    approvedCount: number;
    participantLimit?: number | null;
  };
  gameplay?: {
    poolType: "any" | "mini" | "normal" | "high" | "premium";
    requiredCount: number;
  } | null;
  progress?: {
    count: number;
    required: number;
    status: string;
    completedAt?: string | null;
  } | null;
  status: string;
  submission?: {
    id: string;
    status: "pending_review" | "approved" | "rejected";
    proofUrl?: string | null;
  } | null;
};

const AVATAR_ART = {
  "avatars/clover-scout": require("../assets/avatars/clover-scout.png"),
  "avatars/fortune-explorer": require("../assets/avatars/fortune-explorer.png"),
  "avatars/emerald-challenger": require("../assets/avatars/emerald-challenger.png"),
  "avatars/vanguard-keeper": require("../assets/avatars/vanguard-keeper.png"),
  "avatars/royal-elite": require("../assets/avatars/royal-elite.png"),
  "avatars/fortune-master": require("../assets/avatars/fortune-master.png"),
  "avatars/clover-legend": require("../assets/avatars/clover-legend.png"),
  "avatars/mythic-oracle": require("../assets/avatars/mythic-oracle.png"),
  "avatars/luckyme-icon": require("../assets/avatars/luckyme-icon.png"),
} as const;

const RANK_FRAME_ART = {
  junior: require("../assets/avatar-frames/bronze-clover.png"),
  explorer: require("../assets/avatar-frames/silver-orbit.png"),
  challenger: require("../assets/avatar-frames/emerald-circuit.png"),
  vanguard: require("../assets/avatar-frames/vanguard-sapphire.png"),
  elite: require("../assets/avatar-frames/royal-amethyst.png"),
  master: require("../assets/avatar-frames/master-gold.png"),
  legend: require("../assets/avatar-frames/legendary-flame.png"),
  mythic: require("../assets/avatar-frames/mythic-prism.png"),
  luckyme_icon: require("../assets/avatar-frames/crowned-icon.png"),
} as const;

const RANK_FRAMES: Record<string, {
  primary: string;
  glow: string;
}> = {
  junior: { primary: "#ad7a45", glow: "rgba(173,122,69,.28)" },
  explorer: { primary: "#b8cbd1", glow: "rgba(101,217,232,.3)" },
  challenger: { primary: "#28d98b", glow: "rgba(40,217,139,.34)" },
  vanguard: { primary: "#42bff5", glow: "rgba(66,191,245,.4)" },
  elite: { primary: "#b36cff", glow: "rgba(179,108,255,.45)" },
  master: { primary: "#ffd466", glow: "rgba(255,212,102,.5)" },
  legend: { primary: "#ffad45", glow: "rgba(255,173,69,.58)" },
  mythic: { primary: "#77f6ff", glow: "rgba(119,246,255,.62)" },
  luckyme_icon: { primary: "#fff277", glow: "rgba(255,242,119,.72)" },
};

function AvatarPortrait({
  assetKey,
  rankKey,
  size,
  locked = false,
}: {
  assetKey?: string | null;
  rankKey: string;
  size: number;
  locked?: boolean;
}) {
  const frame = RANK_FRAMES[rankKey] ?? RANK_FRAMES.junior;
  const frameSource = RANK_FRAME_ART[rankKey as keyof typeof RANK_FRAME_ART] ?? RANK_FRAME_ART.junior;
  const source = assetKey ? AVATAR_ART[assetKey as keyof typeof AVATAR_ART] : null;
  return (
    <View
      style={[
        styles.avatarFrame,
        {
          backgroundColor: frame.glow,
          borderRadius: size / 2,
          height: size,
          shadowColor: frame.primary,
          width: size,
        },
      ]}
    >
      {source ? (
        <Image
          resizeMode="contain"
          source={source}
          style={[styles.avatarImage, { height: size - 10, width: size - 10 }]}
        />
      ) : null}
      {locked ? (
        <View style={[styles.avatarLocked, { height: size - 10, width: size - 10 }]}>
          <Text style={styles.avatarLockedText}>LVL</Text>
        </View>
      ) : null}
      <Image
        resizeMode="contain"
        source={frameSource}
        style={[styles.avatarFrameImage, { height: size + 10, width: size + 10 }]}
      />
    </View>
  );
}

type ReferralProfile = {
  referralCode: string;
  profileStatus: "pending_activation" | "active";
  stats: {
    qualifiedReferrals: number;
    pendingReferrals: number;
    invalidatedReferrals: number;
    totalPoints: number;
  };
  invitedUsers: Array<{
    username?: string | null;
    displayName?: string | null;
    walletMasked: string;
    skrDomain?: string | null;
    status: "pending" | "qualified" | "qualified_test" | "invalidated";
    accepted: boolean;
    boundAt: string;
    qualifiedAt?: string | null;
  }>;
};

type XChallenge = {
  id: string;
  taskId: string;
  message: string;
  mode: "identity" | "action";
  actionType?: "like" | "follow" | "repost" | "comment" | null;
  actionLabel?: string | null;
  targetUrl?: string | null;
  openUrl: string;
  composeUrl?: string;
  expiresAt: string;
};

type LuckyMeNftResult = {
  wallet: string;
  collections: Array<{ id: string; name: string; address: string }>;
  assets: Array<{
    assetId: string;
    name: string;
    image?: string | null;
    collectionId: string;
    collectionName: string;
    collectionAddress: string;
    compressed: boolean;
    tree?: string | null;
    leafId?: number | null;
  }>;
};

const extra = Constants.expoConfig?.extra ?? {};
const API_URL = String(extra.referralApiUrl ?? "https://api.lucky-me.app").replace(/\/$/, "");
const SESSION_KEY = "luckyme.seekerReferral.session";
const PROFILE_BACKGROUND_REFRESH_MS = 4 * 60 * 60 * 1_000;

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message ?? "LuckyMe is temporarily unavailable");
    }
    return payload as T;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeProfile(value: Profile): Profile {
  const profile = value as Partial<Profile>;
  const defaultXp = {
    total: 0,
    level: 1,
    rankKey: "junior",
    rankTitle: "Junior",
    frameTitle: "Bronze Clover",
    progress: 0,
    nextLevel: 100,
    progressPercent: 0,
  };
  return {
    ...value,
    identities: Array.isArray(profile.identities) ? profile.identities : [],
    tasks: profile.tasks ?? { completed: 0, pending: 0 },
    xp: { ...defaultXp, ...(profile.xp ?? {}) },
    avatar: profile.avatar ?? null,
    avatars: Array.isArray(profile.avatars) ? profile.avatars : [],
  };
}

function normalizeTasks(values: Task[]): Task[] {
  return (Array.isArray(values) ? values : []).map((value) => ({
    ...value,
    rewardXp: Number.isFinite(value.rewardXp) ? value.rewardXp : 0,
    minLevel: Number.isFinite(value.minLevel) ? value.minLevel : 1,
    maxLevel: Number.isFinite(value.maxLevel) ? value.maxLevel : 100,
    eligible: typeof value.eligible === "boolean" ? value.eligible : true,
    gameplay: value.gameplay ?? null,
    progress: value.progress ?? null,
  }));
}

function normalizeReferral(value: ReferralProfile): ReferralProfile {
  const referral = value as Partial<ReferralProfile>;
  return {
    ...value,
    invitedUsers: Array.isArray(referral.invitedUsers) ? referral.invitedUsers : [],
  };
}

export function CommunityScreen({
  initialTab,
  onClose,
}: {
  initialTab: CommunityTab;
  onClose: () => void;
}) {
  const wallet = useMobileWallet();
  const tab = initialTab;
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [referral, setReferral] = useState<ReferralProfile | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [busy, setBusy] = useState(true);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("Connect your wallet to load LuckyMe.");
  const [newUsername, setNewUsername] = useState("");
  const [challenge, setChallenge] = useState<XChallenge | null>(null);
  const [xHandle, setXHandle] = useState("");
  const [xPostUrl, setXPostUrl] = useState("");
  const [profileSection, setProfileSection] = useState<"identity" | "referral" | "nfts">("identity");
  const [avatarPickerVisible, setAvatarPickerVisible] = useState(false);
  const [nftBusy, setNftBusy] = useState(false);
  const [nftResult, setNftResult] = useState<LuckyMeNftResult | null>(null);
  const [nftError, setNftError] = useState("");
  const loadInFlight = useRef(false);

  const authenticate = useCallback(async () => {
    if (sessionToken) return sessionToken;
    const stored = await SecureStore.getItemAsync(SESSION_KEY).catch(() => null);
    if (stored) {
      setSessionToken(stored);
      return stored;
    }
    setMessage("Approve the LuckyMe sign-in message in your wallet.");
    const account = wallet.account ?? await wallet.connect();
    const nonce = await request<{ payload: Record<string, unknown> }>("/api/seeker/nonce", {
      method: "POST",
      body: "{}",
    });
    const output = await wallet.signIn(nonce.payload);
    if (output.account.address.toBase58() !== account.address.toBase58()) {
      throw new Error("The selected wallet changed. Please try again.");
    }
    const verified = await request<{ sessionToken: string }>("/api/seeker/verify-siws", {
      method: "POST",
      body: JSON.stringify({
        payload: nonce.payload,
        output: {
          publicKey: Buffer.from(walletResultBytes(output.account.address.toBytes(), "public key", 32)).toString("base64"),
          signature: Buffer.from(walletResultBytes(output.signature, "signature", 64)).toString("base64"),
          signedMessage: Buffer.from(walletResultBytes(output.signedMessage, "signed message")).toString("base64"),
        },
        hasPendingReferral: false,
      }),
    });
    await SecureStore.setItemAsync(SESSION_KEY, verified.sessionToken);
    setSessionToken(verified.sessionToken);
    return verified.sessionToken;
  }, [sessionToken, wallet]);

  const load = useCallback(async (
    forceToken?: string,
    options: { silent?: boolean } = {},
  ) => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    const silent = options.silent === true;
    if (!silent) setBusy(true);
    try {
      const token = forceToken ?? sessionToken ?? await SecureStore.getItemAsync(SESSION_KEY).catch(() => null);
      if (!token) {
        if (!silent) setMessage("Connect your wallet to create your LuckyMe profile.");
        return;
      }
      if (token !== sessionToken) setSessionToken(token);
      const [profilePayload, taskPayload, referralPayload] = await Promise.all([
        request<{ profile: Profile }>("/api/promotions/profile", {}, token),
        request<{ tasks: Task[] }>("/api/promotions/tasks", {}, token),
        request<ReferralProfile>("/api/referrals/me", {}, token),
      ]);
      setProfile(normalizeProfile(profilePayload.profile));
      setTasks(normalizeTasks(taskPayload.tasks));
      setReferral(normalizeReferral(referralPayload));
      if (!silent) setMessage("");
    } catch (error) {
      const technicalDetail = error instanceof Error ? error.message : "";
      const detail = userFacingError(error, "LuckyMe profile is temporarily unavailable.");
      if (/session/i.test(technicalDetail)) {
        await SecureStore.deleteItemAsync(SESSION_KEY).catch(() => undefined);
        setSessionToken(null);
      }
      if (!silent || /session/i.test(technicalDetail)) setMessage(detail);
    } finally {
      loadInFlight.current = false;
      if (!silent) setBusy(false);
    }
  }, [sessionToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && sessionToken) void load(sessionToken);
    });
    return () => subscription.remove();
  }, [load, sessionToken]);

  useEffect(() => {
    if (!sessionToken) return undefined;
    const interval = setInterval(() => {
      if (AppState.currentState === "active") {
        void load(sessionToken, { silent: true });
      }
    }, PROFILE_BACKGROUND_REFRESH_MS);
    return () => clearInterval(interval);
  }, [load, sessionToken]);

  const connect = useCallback(async () => {
    setActionBusy("connect");
    try {
      const token = await authenticate();
      await load(token);
    } catch (error) {
      setMessage(userFacingError(error, "Wallet sign-in could not be completed."));
    } finally {
      setActionBusy(null);
    }
  }, [authenticate, load]);

  const finalizeUsername = useCallback(async () => {
    if (!newUsername.trim()) return;
    setActionBusy("username");
    try {
      const token = await authenticate();
      const result = await request<{ profile: Profile }>("/api/promotions/profile/username", {
        method: "POST",
        body: JSON.stringify({
          username: newUsername.trim(),
          permanenceAccepted: true,
          confirmation: "CONFIRM PERMANENT USERNAME",
        }),
      }, token);
      setProfile(normalizeProfile(result.profile));
      setNewUsername("");
      setMessage(`@${result.profile.username} is now your permanent username.`);
    } catch (error) {
      setMessage(userFacingError(error, "Username could not be saved."));
    } finally {
      setActionBusy(null);
    }
  }, [authenticate, newUsername]);

  const startDiscord = useCallback(async (task: Task) => {
    setActionBusy(task.id);
    try {
      const token = await authenticate();
      const result = await request<{ authorizationUrl: string }>(
        `/api/promotions/tasks/${encodeURIComponent(task.id)}/discord/start`,
        { method: "POST", body: "{}" },
        token,
      );
      setMessage("Complete Discord verification, then return to LuckyMe.");
      await Linking.openURL(result.authorizationUrl);
    } catch (error) {
      setMessage(userFacingError(error, "Discord verification could not start."));
    } finally {
      setActionBusy(null);
    }
  }, [authenticate]);

  const startX = useCallback(async (task: Task) => {
    setActionBusy(task.id);
    try {
      const token = await authenticate();
      const result = await request<XChallenge>(
        `/api/promotions/tasks/${encodeURIComponent(task.id)}/x/challenge`,
        { method: "POST", body: "{}" },
        token,
      );
      setChallenge(result);
      setMessage(result.mode === "action"
        ? `${result.actionLabel}. Confirm the action in X, then return to LuckyMe.`
        : "Publish the exact message, then paste your X post link below.");
      await Linking.openURL(result.openUrl ?? result.composeUrl ?? "https://x.com");
    } catch (error) {
      setMessage(userFacingError(error, "X verification could not start."));
    } finally {
      setActionBusy(null);
    }
  }, [authenticate]);

  const submitX = useCallback(async () => {
    if (!challenge) return;
    setActionBusy(challenge.taskId);
    try {
      const token = await authenticate();
      await request(
        `/api/promotions/tasks/${encodeURIComponent(challenge.taskId)}/x/submit`,
        {
          method: "POST",
          body: JSON.stringify({
            challengeId: challenge.id,
            handle: xHandle.trim(),
            postUrl: xPostUrl.trim(),
          }),
        },
        token,
      );
      setChallenge(null);
      setXHandle("");
      setXPostUrl("");
      setMessage(challenge.mode === "action"
        ? "X action submitted for verification. Lucky Points are awarded after approval."
        : "X proof submitted. Lucky Points are awarded after review.");
      await load(token);
    } catch (error) {
      setMessage(userFacingError(error, "X proof could not be submitted."));
    } finally {
      setActionBusy(null);
    }
  }, [authenticate, challenge, load, xHandle, xPostUrl]);

  const shareReferral = useCallback(async () => {
    if (!referral) return;
    await Share.share({
      message: [
        "Join LuckyMe on Seeker.",
        `Invite code: ${referral.referralCode}`,
        "Download LuckyMe from the Solana dApp Store:",
        "https://dappstore.solanamobile.com/app/com.luckyme.seeker",
      ].join("\n"),
    });
  }, [referral]);

  const copyReferral = useCallback(async () => {
    if (!referral) return;
    await Clipboard.setStringAsync(referral.referralCode);
    setMessage(`Referral code ${referral.referralCode} copied.`);
  }, [referral]);

  const chooseAvatar = useCallback(async (avatar: Profile["avatars"][number]) => {
    setActionBusy(`avatar:${avatar.id}`);
    try {
      const token = await authenticate();
      const path = avatar.owned
        ? "/api/promotions/profile/avatar/select"
        : "/api/promotions/profile/avatar/acquire";
      const result = await request<{ profile: Profile }>(path, {
        method: "POST",
        body: JSON.stringify({ avatarId: avatar.id }),
      }, token);
      setProfile(normalizeProfile(result.profile));
      setMessage(avatar.owned ? `${avatar.name} selected.` : `${avatar.name} acquired and selected.`);
      setAvatarPickerVisible(false);
    } catch (error) {
      setMessage(userFacingError(error, "Avatar could not be selected."));
    } finally {
      setActionBusy(null);
    }
  }, [authenticate]);

  const verifyNftWallet = useCallback(async () => {
    setNftBusy(true);
    setNftError("");
    try {
      const nonce = await request<{ payload: Record<string, unknown> }>(
        "/api/luckyme-nfts/nonce",
        { method: "POST", body: "{}" },
      );
      const output = await wallet.signIn(nonce.payload);
      const result = await request<LuckyMeNftResult>("/api/luckyme-nfts/verify", {
        method: "POST",
        body: JSON.stringify({
          payload: nonce.payload,
          output: {
            publicKey: Buffer.from(walletResultBytes(output.account.address.toBytes(), "public key", 32)).toString("base64"),
            signature: Buffer.from(walletResultBytes(output.signature, "signature", 64)).toString("base64"),
            signedMessage: Buffer.from(walletResultBytes(output.signedMessage, "signed message")).toString("base64"),
          },
        }),
      });
      setNftResult(result);
    } catch (error) {
      setNftError(userFacingError(error, "NFT verification could not be completed."));
    } finally {
      setNftBusy(false);
    }
  }, [wallet]);

  return (
    <ImageBackground
      source={require("../assets/home/luckyme-home-background-v2.png")}
      style={styles.background}
      imageStyle={styles.backgroundImage}
    >
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.back}>
            <Text style={styles.backText}>‹ Back to LuckyMe</Text>
          </Pressable>
          <View style={styles.balancePill}>
            <Text style={styles.balanceValue}>{profile?.luckyPoints ?? 0}</Text>
            <Text style={styles.balanceLabel}>LUCKY POINTS</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>{tab === "missions" ? "EARN LUCKY POINTS" : profileSection === "referral" ? "GROW YOUR LEAGUE" : profileSection === "nfts" ? "YOUR LUCKYME COLLECTION" : "LUCKYME IDENTITY"}</Text>
            <Text style={styles.title}>{tab === "missions" ? "Community Missions" : profileSection === "referral" ? "Referral" : profileSection === "nfts" ? "NFTs" : profile ? `@${profile.username}` : "Your profile"}</Text>
            <Text style={styles.copy}>{tab === "missions"
              ? "Complete verified community tasks and use your points in promotional pools."
              : profileSection === "referral"
                ? "Generate your invitation code and follow every Seeker who joined your league."
                : profileSection === "nfts"
                  ? "Sign with your wallet to display verified NFTs from LuckyMe collections."
                : "Your wallet, permanent username, social identities and Lucky Points in one place."}</Text>
          </View>

          {profile && tab === "profile" ? (
            <View style={styles.profileTabs}>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: profileSection === "identity" }}
                onPress={() => setProfileSection("identity")}
                style={[styles.profileTab, profileSection === "identity" && styles.profileTabActive]}
              >
                <Text style={[styles.profileTabText, profileSection === "identity" && styles.profileTabTextActive]}>PROFILE</Text>
              </Pressable>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: profileSection === "referral" }}
                onPress={() => setProfileSection("referral")}
                style={[styles.profileTab, profileSection === "referral" && styles.profileTabActive]}
              >
                <Text style={[styles.profileTabText, profileSection === "referral" && styles.profileTabTextActive]}>REFERRAL</Text>
              </Pressable>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: profileSection === "nfts" }}
                onPress={() => setProfileSection("nfts")}
                style={[styles.profileTab, profileSection === "nfts" && styles.profileTabActive]}
              >
                <Text style={[styles.profileTabText, profileSection === "nfts" && styles.profileTabTextActive]}>NFTs</Text>
              </Pressable>
            </View>
          ) : null}

          {!profile ? (
            <Pressable onPress={connect} disabled={Boolean(actionBusy)} style={styles.primaryButton}>
              {actionBusy === "connect" ? <ActivityIndicator color="#05291D" /> : null}
              <Text style={styles.primaryText}>CONNECT WALLET & SIGN IN</Text>
            </Pressable>
          ) : tab === "missions" ? (
            <View style={styles.stack}>
              {tasks.map((task) => {
                const completed = task.submission?.status === "approved" || task.progress?.status === "completed";
                const pending = task.submission?.status === "pending_review";
                const gameplay = Boolean(task.gameplay);
                const progressCount = Math.min(task.progress?.count ?? 0, task.progress?.required ?? task.gameplay?.requiredCount ?? 0);
                const progressRequired = task.progress?.required ?? task.gameplay?.requiredCount ?? 0;
                const progressPercent = progressRequired > 0 ? Math.min(100, (progressCount / progressRequired) * 100) : 0;
                const unavailableReason = !task.eligibility?.levelEligible
                  ? `UNLOCKS AT LEVEL ${task.minLevel}`
                  : !task.eligibility?.capacityAvailable
                    ? "MISSION FULL"
                    : null;
                return <View key={task.id} style={styles.card}>
                  <View style={styles.cardHead}>
                    <View style={styles.platformBadge}><Text style={styles.platformText}>{gameplay ? `${task.gameplay?.poolType.toUpperCase()} POOLS` : task.platform.toUpperCase()}</Text></View>
                    <Text style={[styles.taskStatus, completed && styles.completed, pending && styles.pending]}>
                      {completed ? "COMPLETED" : pending ? "PENDING REVIEW" : `+${task.rewardPoints} LP · +${task.rewardXp} XP`}
                    </Text>
                  </View>
                  <Text style={styles.cardTitle}>{task.title}</Text>
                  <Text style={styles.cardCopy}>{task.description}</Text>
                  <Text style={styles.levelAccess}>LEVEL {task.minLevel}–{task.maxLevel}{task.participantLimit ? ` · FIRST ${task.participantLimit} USERS` : ""}</Text>
                  {gameplay ? (
                    <View style={styles.progressPanel}>
                      <View style={styles.progressHead}>
                        <Text style={styles.progressLabel}>VALID POOLS SINCE MISSION START</Text>
                        <Text style={styles.progressValue}>{progressCount}/{progressRequired}</Text>
                      </View>
                      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progressPercent}%` }]} /></View>
                      <Text style={styles.progressHint}>{completed ? "Reward claimed automatically." : unavailableReason ?? "Progress updates automatically after a valid draw."}</Text>
                    </View>
                  ) : (
                    <Pressable
                      disabled={completed || pending || !task.eligible || actionBusy === task.id}
                      onPress={() => task.platform === "discord" ? startDiscord(task) : startX(task)}
                      style={[styles.taskButton, (completed || pending || !task.eligible) && styles.disabled]}
                    >
                      {actionBusy === task.id ? <ActivityIndicator color="#05291D" /> : null}
                      <Text style={styles.taskButtonText}>{completed ? "REWARD CLAIMED" : pending ? "WAITING FOR ADMIN" : unavailableReason ?? (task.platform === "discord" ? "CONNECT DISCORD" : task.actionLabel ? task.actionLabel.toUpperCase() : "VERIFY ON X")}</Text>
                    </Pressable>
                  )}
                </View>;
              })}
              {challenge ? (
                <View style={[styles.card, styles.challengeCard]}>
                  <Text style={styles.eyebrow}>{challenge.mode === "action" ? "X ACTION" : "X PROOF"}</Text>
                  <Text style={styles.cardTitle}>{challenge.mode === "action" ? challenge.actionLabel : "Submit your verification post"}</Text>
                  <Text selectable style={styles.challengeMessage}>{challenge.message}</Text>
                  {challenge.mode === "action" ? (
                    <Pressable
                      onPress={() => Linking.openURL(challenge.openUrl)}
                      style={styles.secondaryButton}
                    >
                      <Text style={styles.secondaryButtonText}>REOPEN X</Text>
                    </Pressable>
                  ) : null}
                  <TextInput
                    autoCapitalize="none"
                    onChangeText={setXHandle}
                    placeholder="@your_username"
                    placeholderTextColor="#6f8980"
                    style={styles.input}
                    value={xHandle}
                  />
                  {challenge.mode === "identity" ? (
                    <TextInput
                      autoCapitalize="none"
                      keyboardType="url"
                      onChangeText={setXPostUrl}
                      placeholder="https://x.com/username/status/..."
                      placeholderTextColor="#6f8980"
                      style={styles.input}
                      value={xPostUrl}
                    />
                  ) : null}
                  <Pressable
                    disabled={!xHandle.trim() || (challenge.mode === "identity" && !xPostUrl.trim()) || Boolean(actionBusy)}
                    onPress={submitX}
                    style={[styles.taskButton, (!xHandle.trim() || (challenge.mode === "identity" && !xPostUrl.trim())) && styles.disabled]}
                  >
                    <Text style={styles.taskButtonText}>{challenge.mode === "action" ? "YES, I COMPLETED IT" : "SEND FOR APPROVAL"}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.stack}>
              {profileSection === "identity" ? (
                <>
              <View style={[styles.card, styles.levelCard]}>
                <View style={styles.levelHeader}>
                  <Pressable
                    accessibilityHint="Opens your avatar collection"
                    accessibilityLabel="Change avatar"
                    accessibilityRole="button"
                    onPress={() => setAvatarPickerVisible(true)}
                    style={({ pressed }) => [styles.activeAvatarWrap, styles.avatarHeroPressable, pressed && styles.avatarHeroPressed]}
                  >
                    <AvatarPortrait
                      assetKey={profile.avatar?.assetKey ?? "avatars/clover-scout"}
                      rankKey={profile.xp.rankKey}
                      size={94}
                    />
                    <View style={styles.levelPill}>
                      <Text style={styles.levelPillText}>LVL {profile.xp.level}</Text>
                    </View>
                  </Pressable>
                  <View style={styles.levelCopy}>
                    <Text style={styles.eyebrow}>{profile.xp.rankTitle.toUpperCase()}</Text>
                    <Text style={styles.cardTitle}>{profile.avatar?.name ?? "LuckyMe member"}</Text>
                    <Text style={styles.frameTitle}>{profile.xp.frameTitle} frame</Text>
                    <Text style={styles.cardCopy}>{profile.xp.total} total XP</Text>
                  </View>
                </View>
                <View style={styles.progressHead}>
                  <Text style={styles.progressLabel}>LEVEL PROGRESS</Text>
                  <Text style={styles.progressValue}>{profile.xp.progress}/{profile.xp.nextLevel} XP</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${profile.xp.progressPercent}%` }]} />
                </View>
              </View>
              <View style={styles.profileGrid}>
                <Stat label="AVAILABLE LP" value={String(profile.availablePoints)} />
                <Stat label="COMPLETED" value={String(profile.tasks.completed)} />
                <Stat label="PENDING" value={String(profile.tasks.pending)} />
              </View>
              <View style={styles.card}>
                <Text style={styles.eyebrow}>CONNECTED WALLET</Text>
                <Text selectable style={styles.walletText}>{profile.wallet}</Text>
              </View>
              {profile.usernameState.canCustomize ? (
                <View style={[styles.card, styles.challengeCard]}>
                  <Text style={styles.eyebrow}>CHOOSE ONCE</Text>
                  <Text style={styles.cardTitle}>Permanent username</Text>
                  <Text style={styles.cardCopy}>{profile.usernameState.warning}</Text>
                  <TextInput
                    autoCapitalize="none"
                    maxLength={32}
                    onChangeText={setNewUsername}
                    placeholder="3-32 letters, numbers or underscores"
                    placeholderTextColor="#6f8980"
                    style={styles.input}
                    value={newUsername}
                  />
                  <Pressable
                    disabled={!newUsername.trim() || actionBusy === "username"}
                    onPress={finalizeUsername}
                    style={[styles.taskButton, !newUsername.trim() && styles.disabled]}
                  >
                    <Text style={styles.taskButtonText}>CONFIRM PERMANENT USERNAME</Text>
                  </Pressable>
                </View>
              ) : null}
              <View style={styles.card}>
                <Text style={styles.eyebrow}>VERIFIED SOCIAL ACCOUNTS</Text>
                {profile.identities.length ? profile.identities.map((identity) =>
                  <Text key={identity.platform} style={styles.identityText}>{identity.platform.toUpperCase()} · @{identity.displayHandle}</Text>,
                ) : <Text style={styles.cardCopy}>No social account verified yet.</Text>}
              </View>
                </>
              ) : profileSection === "referral" ? (
              <View style={[styles.card, styles.referralCard]}>
                <Text style={styles.eyebrow}>REFERRAL LEAGUE</Text>
                <Text style={styles.cardTitle}>Invite verified Seekers</Text>
                <Text style={styles.cardCopy}>Share your permanent code. Every invited Seeker appears below with their current qualification status.</Text>
                {referral ? (
                  <>
                    <View style={styles.referralCodeRow}>
                      <Text selectable style={styles.referralCode}>{referral.referralCode}</Text>
                      <View style={styles.referralActions}>
                        <Pressable onPress={copyReferral} style={styles.smallButton}><Text style={styles.smallButtonText}>COPY</Text></Pressable>
                        <Pressable onPress={shareReferral} style={[styles.smallButton, styles.smallButtonPrimary]}><Text style={[styles.smallButtonText, styles.smallButtonPrimaryText]}>SHARE</Text></Pressable>
                      </View>
                    </View>
                    <View style={styles.referralStats}>
                      <Stat label="QUALIFIED" value={String(referral.stats.qualifiedReferrals)} />
                      <Stat label="PENDING" value={String(referral.stats.pendingReferrals)} />
                      <Stat label="TOTAL" value={String(referral.invitedUsers.length)} />
                    </View>
                    <Text style={[styles.eyebrow, styles.invitedHeading]}>PEOPLE YOU INVITED</Text>
                    {referral.invitedUsers.length ? referral.invitedUsers.map((invited, index) => (
                      <View key={`${invited.walletMasked}-${index}`} style={styles.invitedRow}>
                        <View style={styles.invitedIdentity}>
                          <Text style={styles.invitedName}>{invited.username ? `@${invited.username}` : invited.skrDomain ?? invited.walletMasked}</Text>
                          <Text style={styles.invitedWallet}>{invited.walletMasked}</Text>
                        </View>
                        <Text style={[styles.invitedStatus, invited.accepted ? styles.completed : invited.status === "invalidated" ? styles.invalidated : styles.pending]}>
                          {invited.accepted ? "QUALIFIED" : invited.status.toUpperCase()}
                        </Text>
                      </View>
                    )) : <Text style={styles.emptyReferral}>No one has accepted your invitation yet.</Text>}
                  </>
                ) : <Text style={styles.cardCopy}>Referral profile is synchronizing.</Text>}
              </View>
              ) : (
                <View style={styles.stack}>
                  <View style={[styles.card, styles.nftIntroCard]}>
                    <Image
                      resizeMode="contain"
                      source={require("../assets/home/nft-medallion-v1.png")}
                      style={styles.nftHeroArt}
                    />
                    <Text style={styles.eyebrow}>WALLET OWNERSHIP</Text>
                    <Text style={styles.cardTitle}>Verify your LuckyMe NFTs</Text>
                    <Text style={styles.cardCopy}>One authentication signature checks this wallet against every approved LuckyMe collection. No transaction or fee.</Text>
                    <Pressable
                      disabled={nftBusy}
                      onPress={verifyNftWallet}
                      style={[styles.taskButton, nftBusy && styles.disabled]}
                    >
                      {nftBusy ? <ActivityIndicator color="#05291D" /> : null}
                      <Text style={styles.taskButtonText}>{nftBusy ? "VERIFYING WALLET…" : nftResult ? "VERIFY AGAIN" : "VERIFY NFT WALLET"}</Text>
                    </Pressable>
                    {nftError ? <Text style={styles.nftError}>{nftError}</Text> : null}
                  </View>
                  {nftResult ? (
                    <>
                      <View style={styles.card}>
                        <Text style={styles.eyebrow}>VERIFIED WALLET</Text>
                        <Text selectable style={styles.walletText}>{nftResult.wallet}</Text>
                        <Text style={styles.nftCount}>{nftResult.assets.length} LuckyMe NFT{nftResult.assets.length === 1 ? "" : "s"} found</Text>
                      </View>
                      {nftResult.assets.length ? nftResult.assets.map((asset) => (
                        <View key={asset.assetId} style={[styles.card, styles.nftAssetCard]}>
                          {asset.image ? (
                            <Image resizeMode="cover" source={{ uri: asset.image }} style={styles.nftAssetImage} />
                          ) : (
                            <Image resizeMode="contain" source={require("../assets/home/nft-medallion-v1.png")} style={styles.nftAssetImage} />
                          )}
                          <View style={styles.nftAssetCopy}>
                            <Text style={styles.cardTitle}>{asset.name}</Text>
                            <Text style={styles.nftCollectionName}>{asset.collectionName}</Text>
                            <Text selectable numberOfLines={2} style={styles.invitedWallet}>{asset.assetId}</Text>
                          </View>
                        </View>
                      )) : (
                        <View style={styles.card}>
                          <Text style={styles.cardTitle}>No LuckyMe NFTs found</Text>
                          <Text style={styles.cardCopy}>This wallet does not currently hold an active NFT from an approved LuckyMe collection.</Text>
                        </View>
                      )}
                    </>
                  ) : null}
                </View>
              )}
            </View>
          )}

          {!profile && (busy || message) ? <View style={styles.message}>
            {busy ? <ActivityIndicator color="#6df2a8" size="small" /> : null}
            <Text style={styles.messageText}>{message}</Text>
          </View> : null}
        </ScrollView>
      </SafeAreaView>
      <Modal
        animationType="fade"
        onRequestClose={() => setAvatarPickerVisible(false)}
        statusBarTranslucent
        transparent
        visible={avatarPickerVisible && Boolean(profile)}
      >
        <View style={styles.avatarModalBackdrop}>
          <Pressable
            accessibilityLabel="Close avatar collection"
            accessibilityRole="button"
            onPress={() => setAvatarPickerVisible(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.avatarModalPanel}>
            <View style={styles.avatarModalHeader}>
              <View style={styles.avatarModalTitleCopy}>
                <Text style={styles.eyebrow}>YOUR COLLECTION</Text>
                <Text style={styles.avatarModalTitle}>Choose avatar</Text>
                <Text style={styles.cardCopy}>Unlock by level, acquire with Lucky Points, then switch freely.</Text>
              </View>
              <Pressable
                accessibilityLabel="Close"
                accessibilityRole="button"
                onPress={() => setAvatarPickerVisible(false)}
                style={styles.avatarModalClose}
              >
                <Text style={styles.avatarModalCloseText}>×</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.avatarList} showsVerticalScrollIndicator={false}>
              {profile?.avatars.map((avatar) => {
                const selected = profile.avatar?.id === avatar.id;
                const locked = !avatar.levelUnlocked;
                return <View key={avatar.id} style={[styles.avatarRow, selected && styles.avatarSelected]}>
                  <AvatarPortrait
                    assetKey={avatar.assetKey}
                    locked={locked}
                    rankKey={avatar.rankKey}
                    size={72}
                  />
                  <View style={styles.avatarCopy}>
                    <Text style={styles.invitedName}>{avatar.name}</Text>
                    <Text style={styles.invitedWallet}>LEVEL {avatar.minLevel} · {avatar.pricePoints ? `${avatar.pricePoints} LP` : "LEVEL REWARD"}</Text>
                  </View>
                  <Pressable
                    disabled={locked || selected || actionBusy === `avatar:${avatar.id}`}
                    onPress={() => chooseAvatar(avatar)}
                    style={[styles.smallButton, (!avatar.owned && !locked) && styles.smallButtonPrimary, (locked || selected) && styles.disabled]}
                  >
                    {actionBusy === `avatar:${avatar.id}` ? <ActivityIndicator color="#05291D" size="small" /> : (
                      <Text style={[styles.smallButtonText, (!avatar.owned && !locked) && styles.smallButtonPrimaryText]}>
                        {locked ? "LOCKED" : selected ? "ACTIVE" : avatar.owned ? "SELECT" : "ACQUIRE"}
                      </Text>
                    )}
                  </Pressable>
                </View>;
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ImageBackground>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  background: { backgroundColor: "#00251B", flex: 1 },
  backgroundImage: { opacity: 0.58 },
  safe: { flex: 1 },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 8 },
  back: { paddingVertical: 10 },
  backText: { color: "#efff74", fontSize: 16, fontWeight: "900" },
  balancePill: { alignItems: "center", borderColor: "rgba(109,242,168,.45)", borderRadius: 16, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 6 },
  balanceValue: { color: "#fff6a2", fontSize: 17, fontWeight: "900" },
  balanceLabel: { color: "#8db6a8", fontSize: 7, fontWeight: "900", letterSpacing: 0.8 },
  tabs: { alignSelf: "center", backgroundColor: "rgba(3,31,24,.88)", borderColor: "rgba(109,242,168,.28)", borderRadius: 16, borderWidth: 1, flexDirection: "row", marginTop: 8, padding: 4, width: "72%" },
  tab: { alignItems: "center", borderRadius: 12, flex: 1, paddingVertical: 10 },
  tabActive: { backgroundColor: "rgba(109,242,168,.16)" },
  tabText: { color: "#7fa095", fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  tabTextActive: { color: "#efff74" },
  content: { gap: 12, padding: 18, paddingBottom: 54 },
  hero: { backgroundColor: "rgba(3,40,30,.84)", borderColor: "rgba(109,242,168,.3)", borderRadius: 22, borderWidth: 1, padding: 20 },
  eyebrow: { color: "#6df2a8", fontSize: 10, fontWeight: "900", letterSpacing: 1.4 },
  title: { color: "white", fontSize: 30, fontWeight: "900", letterSpacing: -0.7, marginTop: 6 },
  copy: { color: "#b8cdc5", fontSize: 13, lineHeight: 19, marginTop: 7 },
  stack: { gap: 11 },
  card: { backgroundColor: "rgba(3,35,27,.88)", borderColor: "rgba(109,242,168,.25)", borderRadius: 19, borderWidth: 1, padding: 16 },
  challengeCard: { borderColor: "rgba(255,230,111,.42)" },
  cardHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  platformBadge: { backgroundColor: "rgba(109,242,168,.11)", borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5 },
  platformText: { color: "#6df2a8", fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  taskStatus: { color: "#fff3a0", fontSize: 10, fontWeight: "900" },
  completed: { color: "#6df2a8" },
  pending: { color: "#ffd06f" },
  invalidated: { color: "#ff8f8f" },
  cardTitle: { color: "white", fontSize: 20, fontWeight: "900", marginTop: 11 },
  cardCopy: { color: "#a8beb5", fontSize: 13, lineHeight: 19, marginTop: 5 },
  levelAccess: { color: "#75988b", fontSize: 9, fontWeight: "900", letterSpacing: 0.7, marginTop: 10 },
  taskButton: { alignItems: "center", backgroundColor: "#69efaa", borderRadius: 14, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 14, minHeight: 49, paddingHorizontal: 14 },
  taskButtonText: { color: "#05291D", fontSize: 12, fontWeight: "900", letterSpacing: 0.4 },
  secondaryButton: { alignItems: "center", borderColor: "rgba(109,242,168,.45)", borderRadius: 12, borderWidth: 1, marginTop: 10, minHeight: 44, justifyContent: "center" },
  secondaryButtonText: { color: "#6df2a8", fontSize: 11, fontWeight: "900", letterSpacing: 0.5 },
  primaryButton: { alignItems: "center", backgroundColor: "#69efaa", borderRadius: 17, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 58, paddingHorizontal: 18 },
  primaryText: { color: "#05291D", fontSize: 14, fontWeight: "900" },
  disabled: { opacity: 0.42 },
  challengeMessage: { backgroundColor: "rgba(0,0,0,.25)", borderRadius: 11, color: "#fff3a0", fontSize: 12, marginTop: 10, padding: 11 },
  input: { backgroundColor: "rgba(0,0,0,.3)", borderColor: "rgba(109,242,168,.25)", borderRadius: 12, borderWidth: 1, color: "white", fontSize: 14, marginTop: 10, paddingHorizontal: 13, paddingVertical: 12 },
  profileGrid: { flexDirection: "row", gap: 8 },
  profileTabs: { backgroundColor: "rgba(3,31,24,.9)", borderColor: "rgba(109,242,168,.28)", borderRadius: 15, borderWidth: 1, flexDirection: "row", padding: 4 },
  profileTab: { alignItems: "center", borderRadius: 11, flex: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: 8 },
  profileTabActive: { backgroundColor: "rgba(109,242,168,.16)" },
  profileTabText: { color: "#7fa095", fontSize: 10, fontWeight: "900", letterSpacing: 0.7 },
  profileTabTextActive: { color: "#efff74" },
  levelCard: { borderColor: "rgba(255,230,111,.42)" },
  levelHeader: { alignItems: "center", flexDirection: "row", gap: 13 },
  activeAvatarWrap: { paddingBottom: 7, position: "relative" },
  avatarHeroPressable: { alignItems: "center", borderRadius: 54, paddingHorizontal: 6, paddingTop: 4 },
  avatarHeroPressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
  levelPill: { alignSelf: "center", backgroundColor: "#efff74", borderColor: "#071d17", borderRadius: 10, borderWidth: 2, bottom: 0, paddingHorizontal: 8, paddingVertical: 3, position: "absolute" },
  levelPillText: { color: "#08251c", fontSize: 8, fontWeight: "900", letterSpacing: 0.6 },
  levelCopy: { flex: 1 },
  frameTitle: { color: "#fff3a0", fontSize: 10, fontWeight: "900", letterSpacing: 0.35, marginTop: 4 },
  progressPanel: { backgroundColor: "rgba(0,0,0,.2)", borderRadius: 13, marginTop: 13, padding: 12 },
  progressHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 14 },
  progressLabel: { color: "#83a599", fontSize: 8, fontWeight: "900", letterSpacing: 0.7 },
  progressValue: { color: "#fff3a0", fontSize: 10, fontWeight: "900" },
  progressTrack: { backgroundColor: "rgba(109,242,168,.13)", borderRadius: 6, height: 7, marginTop: 7, overflow: "hidden" },
  progressFill: { backgroundColor: "#6df2a8", borderRadius: 6, height: "100%" },
  progressHint: { color: "#8ba49b", fontSize: 10, lineHeight: 15, marginTop: 8 },
  stat: { alignItems: "center", backgroundColor: "rgba(3,35,27,.88)", borderColor: "rgba(109,242,168,.25)", borderRadius: 15, borderWidth: 1, flex: 1, paddingHorizontal: 7, paddingVertical: 14 },
  statValue: { color: "#fff3a0", fontSize: 23, fontWeight: "900" },
  statLabel: { color: "#8ba49b", fontSize: 8, fontWeight: "900", marginTop: 3 },
  walletText: { color: "#75eec0", fontSize: 11, lineHeight: 17, marginTop: 8 },
  identityText: { color: "#75eec0", fontSize: 13, fontWeight: "800", marginTop: 9 },
  referralCard: { borderColor: "rgba(125,104,255,.4)" },
  nftIntroCard: { borderColor: "rgba(255,230,111,.42)", overflow: "hidden" },
  nftHeroArt: { alignSelf: "center", height: 132, marginBottom: 6, width: 132 },
  nftError: { color: "#ff9d9d", fontSize: 11, lineHeight: 16, marginTop: 10, textAlign: "center" },
  nftCount: { color: "#fff3a0", fontSize: 12, fontWeight: "900", marginTop: 10 },
  nftAssetCard: { alignItems: "center", flexDirection: "row", gap: 13 },
  nftAssetImage: { backgroundColor: "rgba(0,0,0,.22)", borderRadius: 15, height: 88, width: 88 },
  nftAssetCopy: { flex: 1, minWidth: 0 },
  nftCollectionName: { color: "#6df2a8", fontSize: 10, fontWeight: "900", marginTop: 5 },
  referralCodeRow: { alignItems: "center", backgroundColor: "rgba(0,0,0,.22)", borderRadius: 14, flexDirection: "row", justifyContent: "space-between", marginTop: 14, padding: 11 },
  referralCode: { color: "#fff3a0", fontSize: 20, fontWeight: "900", letterSpacing: 1 },
  referralActions: { flexDirection: "row", gap: 6 },
  smallButton: { borderColor: "rgba(109,242,168,.45)", borderRadius: 9, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  smallButtonPrimary: { backgroundColor: "#69efaa", borderColor: "#69efaa" },
  smallButtonText: { color: "#6df2a8", fontSize: 9, fontWeight: "900" },
  smallButtonPrimaryText: { color: "#05291D" },
  referralStats: { flexDirection: "row", gap: 7, marginTop: 10 },
  avatarList: { paddingBottom: 8, paddingTop: 10 },
  avatarRow: { alignItems: "center", borderColor: "rgba(109,242,168,.12)", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 11, justifyContent: "space-between", marginTop: 8, padding: 10 },
  avatarSelected: { borderColor: "rgba(255,230,111,.55)", backgroundColor: "rgba(255,230,111,.07)" },
  avatarCopy: { flex: 1, minWidth: 0 },
  avatarModalBackdrop: { alignItems: "center", backgroundColor: "rgba(0,9,7,.78)", flex: 1, justifyContent: "center", padding: 18 },
  avatarModalPanel: { backgroundColor: "#062b21", borderColor: "rgba(109,242,168,.45)", borderRadius: 24, borderWidth: 1, maxHeight: "82%", padding: 16, shadowColor: "#6df2a8", shadowOffset: { height: 0, width: 0 }, shadowOpacity: 0.28, shadowRadius: 18, width: "100%" },
  avatarModalHeader: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  avatarModalTitleCopy: { flex: 1, paddingRight: 12 },
  avatarModalTitle: { color: "white", fontSize: 24, fontWeight: "900", marginTop: 4 },
  avatarModalClose: { alignItems: "center", backgroundColor: "rgba(109,242,168,.1)", borderColor: "rgba(109,242,168,.3)", borderRadius: 18, borderWidth: 1, height: 36, justifyContent: "center", width: 36 },
  avatarModalCloseText: { color: "#efff74", fontSize: 26, fontWeight: "700", lineHeight: 29 },
  avatarFrame: { alignItems: "center", justifyContent: "center", overflow: "visible", shadowOffset: { height: 0, width: 0 }, shadowOpacity: 0.7, shadowRadius: 9 },
  avatarImage: { borderRadius: 999, left: 5, position: "absolute", top: 5 },
  avatarFrameImage: { left: -5, position: "absolute", top: -5, zIndex: 3 },
  avatarLocked: { alignItems: "center", backgroundColor: "rgba(0,9,7,.68)", borderRadius: 999, justifyContent: "center", left: 5, position: "absolute", top: 5, zIndex: 2 },
  avatarLockedText: { color: "#b3c3bd", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  invitedHeading: { marginTop: 18 },
  invitedRow: { alignItems: "center", borderBottomColor: "rgba(109,242,168,.12)", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: 12 },
  invitedIdentity: { flex: 1, paddingRight: 10 },
  invitedName: { color: "white", fontSize: 13, fontWeight: "800" },
  invitedWallet: { color: "#78958a", fontSize: 9, marginTop: 3 },
  invitedStatus: { fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },
  emptyReferral: { color: "#829d93", fontSize: 12, fontStyle: "italic", marginTop: 12 },
  message: { alignItems: "center", backgroundColor: "rgba(2,25,20,.84)", borderRadius: 14, flexDirection: "row", gap: 9, padding: 13 },
  messageText: { color: "#b3c9c0", flex: 1, fontSize: 12, lineHeight: 17 },
});
