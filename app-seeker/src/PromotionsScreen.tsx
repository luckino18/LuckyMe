import Constants from "expo-constants";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as SecureStore from "expo-secure-store";
import {
  ActivityIndicator,
  ImageBackground,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useMobileWallet } from "@wallet-ui/react-native-web3js";
import { PublicKey, Transaction } from "@solana/web3.js";
import { Buffer } from "@craftzdog/react-native-buffer";
import { userFacingError } from "./user-facing-error";
import { walletResultBytes } from "./wallet-result-bytes";

type Promotion = {
  id: string;
  title: string;
  subtitle: string;
  description?: string;
  entryCount: number;
  capacity: number;
  entryCostPoints: number;
  status: string;
  prizeAsset: "SOL" | "SKR";
  prizeAmountBaseUnits: string;
  prizeDecimals: number;
  minLevel: number;
  maxLevel: number;
  economyMode?: "standard" | "ultra";
  expiryMode: "timed" | "capacity-only";
  winnerIndex?: number;
  winnerAddress?: string;
  settleSignature?: string;
};

const extra = Constants.expoConfig?.extra ?? {};
const API_URL = String(extra.referralApiUrl ?? "https://api.lucky-me.app").replace(/\/$/, "");
const SESSION_KEY = "luckyme.seekerReferral.session";

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
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
    if (!response.ok) throw new Error(payload?.message ?? "LuckyMe is temporarily unavailable");
    return payload as T;
  } finally {
    clearTimeout(timer);
  }
}

function statusLabel(promotion: Promotion | null) {
  const status = promotion?.status;
  if (status === "open") return "OPEN";
  if (status === "locked" || status === "drawing") return "DRAWING";
  if (status === "winner_ready") return "WINNER READY";
  if (status === "paid" || status === "archived") return "PAID";
  return String(status ?? "WAITING").replaceAll("_", " ").toUpperCase();
}

function prizeLabel(promotion: Promotion | null) {
  if (!promotion) return "Promotion";
  const units = BigInt(promotion.prizeAmountBaseUnits);
  const scale = 10n ** BigInt(promotion.prizeDecimals);
  const fraction = (units % scale).toString().padStart(promotion.prizeDecimals, "0").replace(/0+$/, "");
  return `${units / scale}${fraction ? `.${fraction}` : ""} ${promotion.prizeAsset}`;
}

function shortAddress(value?: string) {
  if (!value) return "";
  return `${value.slice(0, 5)}…${value.slice(-5)}`;
}

export function PromotionsScreen({
  initialPromotionId,
  onClose,
}: {
  initialPromotionId?: string;
  onClose: () => void;
}) {
  const wallet = useMobileWallet();
  const [luckyPoints, setLuckyPoints] = useState<number | null>(null);
  const [playerLevel, setPlayerLevel] = useState<number | null>(null);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [promotion, setPromotion] = useState<Promotion | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [entering, setEntering] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const storedToken = sessionToken ?? await SecureStore.getItemAsync(SESSION_KEY).catch(() => null);
      if (storedToken && storedToken !== sessionToken) setSessionToken(storedToken);
      const promotionsPayload = await request<{ promotions: Promotion[] }>("/api/promotions");
      if (storedToken) {
        const me = await request<{ luckyPoints: number; profile?: { xp?: { level?: number } } }>("/api/promotions/me", {}, storedToken);
        setLuckyPoints(me.luckyPoints);
        setPlayerLevel(Number(me.profile?.xp?.level ?? 1));
      }
      const active = new Set(["open", "locked", "randomness_pending", "winner_ready"]);
      const available = promotionsPayload.promotions.filter((item) =>
        active.has(item.status) || item.status === "paid" || item.status === "archived"
      );
      setPromotions(available);
      setPromotion((current) => {
        return available.find((item) => item.id === initialPromotionId)
          ?? available.find((item) => item.id === current?.id)
          ?? available.find((item) => item.status === "open")
          ?? available.find((item) => active.has(item.status))
          ?? available[0]
          ?? null;
      });
      setMessage(available.length > 0 ? "" : "No active promotion");
    } catch (error) {
      setMessage(userFacingError(error, "Promotion service is temporarily unavailable."));
    } finally {
      setBusy(false);
    }
  }, [initialPromotionId, sessionToken]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const progress = useMemo(() => promotion
    ? Math.max(0, Math.min(100, Math.round((promotion.entryCount / promotion.capacity) * 100)))
    : 0, [promotion]);
  const levelEligible = promotion && playerLevel !== null
    ? playerLevel >= Number(promotion.minLevel ?? 1) && playerLevel <= Number(promotion.maxLevel ?? 100)
    : true;
  const canEnter = promotion?.status === "open" && levelEligible && !entering;
  const winnerAddress = promotion?.winnerAddress;
  const settlementExplorer = promotion?.settleSignature
    ? `https://solscan.io/tx/${promotion.settleSignature}`
    : undefined;

  const authenticatedToken = useCallback(async () => {
    if (sessionToken) return sessionToken;
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

  const enter = useCallback(async () => {
    if (!promotion) return;
    setEntering(true);
    try {
      setMessage("Approve your entry in your wallet…");
      const token = await authenticatedToken();
      const prepared = await request<{
        entryId: string;
        entryAddress: string;
        expectedEntryIndex: number;
        luckyPoints: number;
        transactionBase64: string;
      }>(
        `/api/promotions/${promotion.id}/entry/prepare`,
        {
          method: "POST",
          body: JSON.stringify({ idempotencyKey: `apk-mainnet:${promotion.id}:${Date.now()}` }),
        },
        token,
      );
      const transaction = Transaction.from(Buffer.from(prepared.transactionBase64, "base64"));
      const minContextSlot = await wallet.connection.getSlot("confirmed").catch(() => 0);
      const signature = await wallet.signAndSendTransactions(transaction, minContextSlot);
      await wallet.connection.confirmTransaction(signature, "confirmed");
      const info = await wallet.connection.getAccountInfo(new PublicKey(prepared.entryAddress), "confirmed");
      if (!info || info.data.length !== 80) throw new Error("Your entry is still confirming. Please refresh shortly.");
      const entryIndex = info.data.readUInt32LE(72);
      const result = await request<{ promotion: Promotion; luckyPoints: number }>(
        `/api/promotions/${promotion.id}/entry/confirm`,
        {
          method: "POST",
          body: JSON.stringify({
            entryId: prepared.entryId,
            entryAddress: prepared.entryAddress,
            entryIndex,
            signature,
          }),
        },
        token,
      );
      setLuckyPoints(result.luckyPoints);
      setMessage(result.promotion.status === "locked"
        ? "All spots filled. Winner selection is starting."
        : "Entry confirmed.");
      await refresh();
    } catch (error) {
      setMessage(userFacingError(error, "Entry could not be confirmed."));
    } finally {
      setEntering(false);
    }
  }, [authenticatedToken, promotion, refresh, wallet]);

  return (
    <ImageBackground source={require("../assets/home/luckyme-home-background-v2.png")} style={styles.background} imageStyle={styles.backgroundImage}>
      <StatusBar hidden translucent backgroundColor="transparent" barStyle="light-content" />
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.back}>
            <Text style={styles.backText}>‹ Back to LuckyMe</Text>
          </Pressable>

          {promotions.length > 1 ? (
            <ScrollView
              contentContainerStyle={styles.promotionPicker}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {promotions.map((item) => {
                const selected = item.id === promotion?.id;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={item.id}
                    onPress={() => {
                      setPromotion(item);
                      setMessage("");
                    }}
                    style={[styles.promotionChip, selected && styles.promotionChipSelected]}
                  >
                    <Text numberOfLines={1} style={[styles.promotionChipTitle, selected && styles.promotionChipTitleSelected]}>
                      {item.title}
                    </Text>
                    <Text style={styles.promotionChipMeta}>{prizeLabel(item)} · {statusLabel(item)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          <View style={styles.hero}>
            <View style={styles.heroCopy}>
              <Text style={styles.kicker}>PROMOTION</Text>
              <Text style={styles.title}>{promotion?.title ?? "LuckyMe Promotion"}</Text>
              <Text style={styles.prizeLine}>{prizeLabel(promotion)}</Text>
              {promotion?.subtitle ? <Text style={styles.subtitle}>{promotion.subtitle}</Text> : null}
            </View>
          </View>

          <View style={styles.counterCard}>
            <View style={styles.counterHead}>
              <Text style={styles.counterLabel}>CONFIRMED ENTRIES</Text>
              <Text style={styles.counterValue}>{promotion?.entryCount ?? 0} / {promotion?.capacity ?? 0}</Text>
            </View>
            <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
            <View style={styles.factRow}>
              <Fact value={`${promotion?.entryCostPoints ?? 0}`} label="LUCKY POINTS" />
              <Fact value={`${Math.max(0, (promotion?.capacity ?? 0) - (promotion?.entryCount ?? 0))}`} label="STILL NEEDED" />
              <Fact value={statusLabel(promotion)} label="STATUS" small />
            </View>
          </View>

          {(promotion?.minLevel ?? 1) > 1 || (promotion?.maxLevel ?? 100) < 100 ? (
            <Text style={styles.levelRule}>Available to levels {promotion?.minLevel ?? 1}–{promotion?.maxLevel ?? 100}</Text>
          ) : null}

          {winnerAddress ? (
            <View style={styles.winnerCard}>
              <Text style={styles.winnerLabel}>WINNER</Text>
              <Text style={styles.winnerTitle}>Entry #{Number(promotion?.winnerIndex ?? 0) + 1}</Text>
              <Text selectable style={styles.winnerAddress}>{shortAddress(winnerAddress)}</Text>
              {settlementExplorer ? (
                <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(settlementExplorer); }} style={styles.proofButton}>
                  <Text style={styles.proofButtonText}>VIEW PAYOUT PROOF ↗</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {promotion?.description ? <Text style={styles.description}>{promotion.description}</Text> : null}

          <Pressable accessibilityRole="button" disabled={!canEnter} onPress={enter} style={({ pressed }) => [styles.enterButton, !canEnter && styles.disabled, pressed && canEnter && styles.pressed]}>
            {entering ? <ActivityIndicator color="#05291D" /> : null}
            <Text style={styles.enterButtonText}>{entering
              ? "CONFIRMING…"
              : promotion?.status === "open" && !levelEligible
                ? `REQUIRES LEVEL ${promotion?.minLevel ?? 1}–${promotion?.maxLevel ?? 100}`
                : canEnter
                  ? `ENTER FOR ${promotion?.entryCostPoints ?? 0} LUCKY POINTS`
                  : "ENTRIES CLOSED"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void refresh(); }} style={styles.refreshButton}>
            {busy ? <ActivityIndicator color="#D6FF84" size="small" /> : null}
            <Text style={styles.refreshText}>Refresh promotion</Text>
          </Pressable>

          {message ? (
            <View style={styles.statusCard}>
              <View style={[styles.dot, message.toLowerCase().includes("unavailable") ? styles.dotWarning : null]} />
              <Text style={styles.statusText}>{message}</Text>
            </View>
          ) : null}
          {luckyPoints === null ? null : <Text style={styles.balance}>{luckyPoints} Lucky Points available</Text>}
        </ScrollView>
      </SafeAreaView>
    </ImageBackground>
  );
}

function Fact({ value, label, small = false }: { value: string; label: string; small?: boolean }) {
  return <View style={styles.fact}><Text numberOfLines={1} adjustsFontSizeToFit style={[styles.factValue, small && styles.factValueSmall]}>{value}</Text><Text style={styles.factLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: "#031B14" },
  backgroundImage: { opacity: 0.78, resizeMode: "cover" },
  safe: { flex: 1, backgroundColor: "rgba(1,22,16,0.20)" },
  content: { gap: 10, padding: 16, paddingBottom: 34 },
  back: { alignSelf: "flex-start", paddingVertical: 6 },
  backText: { color: "#D6FF84", fontSize: 13, fontWeight: "900" },
  promotionPicker: { gap: 8, paddingVertical: 2 },
  promotionChip: { backgroundColor: "rgba(2,37,28,0.84)", borderColor: "rgba(155,255,104,0.24)", borderRadius: 13, borderWidth: 1, minWidth: 150, paddingHorizontal: 12, paddingVertical: 10 },
  promotionChipSelected: { backgroundColor: "rgba(19,99,68,0.96)", borderColor: "#70F2A8" },
  promotionChipTitle: { color: "rgba(255,255,255,0.72)", fontSize: 12, fontWeight: "900", maxWidth: 190 },
  promotionChipTitleSelected: { color: "#FFFFFF" },
  promotionChipMeta: { color: "#FFF5A5", fontSize: 8, fontWeight: "800", marginTop: 4 },
  hero: { backgroundColor: "rgba(2,37,28,0.84)", borderColor: "rgba(155,255,104,0.38)", borderRadius: 20, borderWidth: 1, justifyContent: "center", minHeight: 148, padding: 18 },
  heroCopy: { gap: 4 },
  kicker: { color: "#83F1E0", fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  title: { color: "#FFFFFF", fontSize: 29, fontWeight: "900", letterSpacing: -1, lineHeight: 30 },
  prizeLine: { color: "#FFE66F", fontSize: 14, fontWeight: "900", letterSpacing: 0.3 },
  subtitle: { color: "rgba(255,255,255,0.78)", fontSize: 12, lineHeight: 17 },
  counterCard: { backgroundColor: "rgba(2,37,28,0.84)", borderColor: "rgba(155,255,104,0.30)", borderRadius: 18, borderWidth: 1, padding: 13 },
  counterHead: { flexDirection: "row", justifyContent: "space-between" },
  counterLabel: { color: "rgba(255,255,255,0.68)", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  counterValue: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  progressTrack: { backgroundColor: "#151D2A", borderRadius: 99, height: 10, marginTop: 12, overflow: "hidden" },
  progressFill: { backgroundColor: "#8EFF69", borderRadius: 99, height: "100%" },
  factRow: { flexDirection: "row", gap: 7, marginTop: 10 },
  fact: { alignItems: "center", backgroundColor: "rgba(1,27,22,0.80)", borderColor: "rgba(168,255,112,0.20)", borderRadius: 13, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 67, paddingHorizontal: 4 },
  factValue: { color: "#FFF5A5", fontSize: 18, fontWeight: "900", maxWidth: "100%" },
  factValueSmall: { fontSize: 12 },
  factLabel: { color: "rgba(255,255,255,0.60)", fontSize: 7, fontWeight: "900", marginTop: 3 },
  levelRule: { color: "#83F1E0", fontSize: 10, fontWeight: "900", letterSpacing: 0.3, paddingHorizontal: 3 },
  winnerCard: { alignItems: "center", backgroundColor: "rgba(39,30,4,0.88)", borderColor: "rgba(255,230,111,0.48)", borderRadius: 18, borderWidth: 1, gap: 5, padding: 15 },
  winnerLabel: { color: "#FFE66F", fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  winnerTitle: { color: "#FFFFFF", fontSize: 21, fontWeight: "900" },
  winnerAddress: { color: "rgba(255,255,255,0.76)", fontSize: 12, fontWeight: "700" },
  proofButton: { borderColor: "rgba(255,230,111,0.32)", borderRadius: 10, borderWidth: 1, marginTop: 5, paddingHorizontal: 14, paddingVertical: 9 },
  proofButtonText: { color: "#FFF5A5", fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  description: { color: "rgba(255,255,255,0.67)", fontSize: 11, lineHeight: 17, paddingHorizontal: 3 },
  enterButton: { alignItems: "center", backgroundColor: "#70F2A8", borderRadius: 14, flexDirection: "row", gap: 9, justifyContent: "center", minHeight: 52, paddingHorizontal: 18 },
  enterButtonText: { color: "#05291D", flexShrink: 1, fontSize: 13, fontWeight: "900", textAlign: "center" },
  refreshButton: { alignItems: "center", borderColor: "rgba(190,255,142,0.22)", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 42 },
  refreshText: { color: "rgba(255,255,255,0.75)", fontSize: 12, fontWeight: "800" },
  statusCard: { alignItems: "center", backgroundColor: "rgba(1,27,22,0.78)", borderRadius: 12, flexDirection: "row", gap: 9, padding: 11 },
  dot: { backgroundColor: "#70F2A8", borderRadius: 4, height: 8, width: 8 },
  dotWarning: { backgroundColor: "#FFB64D" },
  statusText: { color: "rgba(255,255,255,0.70)", flex: 1, fontSize: 10, lineHeight: 15 },
  balance: { color: "rgba(255,255,255,0.55)", fontSize: 9, textAlign: "center" },
  pressed: { opacity: 0.68 },
  disabled: { opacity: 0.50 },
});
