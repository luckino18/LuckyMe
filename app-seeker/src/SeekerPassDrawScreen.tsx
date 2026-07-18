import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Constants from "expo-constants";
import { Buffer } from "@craftzdog/react-native-buffer";
import { useMobileWallet } from "@wallet-ui/react-native-web3js";

import { walletResultBytes } from "./wallet-result-bytes";

const PASS_IMAGE = "https://lucky-me.app/cnft/luckyme-seeker-pass-v2.png";
const API_URL = String(Constants.expoConfig?.extra?.referralApiUrl ?? "https://api.lucky-me.app").replace(/\/$/, "");
const PROMOTION_ACCESSIBILITY_SUMMARY = "3 SOL across 20 winning NFT entries after 1,000 unique verified NFT entries, using one wallet authentication signature. Payouts activate after prize funding is confirmed.";

type Prize = { rank: number; prizeLamports: string; prizeSol: number };
type PromotionStatus = {
  campaignId: string;
  name: string;
  enabled: boolean;
  status: "open" | "commitment_frozen" | "randomness_pending" | "drawn_unfunded" | "paid";
  entryCount: number;
  entryThreshold: number;
  entriesRemaining: number;
  progressPercent: number;
  winnerCount: number;
  prizeSol: number;
  prizes: Prize[];
  funded: boolean;
  payoutEnabled: boolean;
  entryCommitment: string | null;
  targetSlot: number | null;
  resolvedSlot: number | null;
  randomnessHash: string | null;
};

type VerificationResult = {
  eligible: boolean;
  registered: boolean;
  alreadyRegistered: boolean;
  entryNumber: number | null;
  testOnly: boolean;
  wallet: string;
  collection: string;
  asset: { assetId: string; tree: string; leafId: number | null } | null;
  message: string;
  promotion: PromotionStatus;
};

async function request(path: string, options: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message ?? `LuckyMe request failed (HTTP ${response.status})`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function promotionStatus() {
  return request("/api/seeker-pass/status") as Promise<PromotionStatus>;
}

function statusCopy(status: PromotionStatus | null) {
  if (!status) return "Loading live promotion counter…";
  if (!status.enabled) return "Promotion registration is temporarily paused.";
  if (status.status === "open") return `${status.entriesRemaining.toLocaleString()} verified entries remain before the automatic draw.`;
  if (status.status === "commitment_frozen") return "1,000 entries reached. The public entry commitment is frozen.";
  if (status.status === "randomness_pending") return "1,000 entries reached. Waiting for the committed finalized Solana slot.";
  if (status.status === "drawn_unfunded") return "The draw is complete. Prize payouts remain locked until funding is confirmed.";
  return "The promotion is complete and prizes are marked as paid.";
}

export function SeekerPassDrawScreen({ onClose }: { onClose: () => void }) {
  const wallet = useMobileWallet();
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [promotion, setPromotion] = useState<PromotionStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPromotion(await promotionStatus());
    } catch {
      // The entry action shows actionable request errors; counter refresh is best-effort.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const verify = useCallback(async () => {
    setBusy(true);
    setResult(null);
    try {
      setBusyLabel("Requesting your one-time entry message");
      const nonce = await request("/api/seeker-pass/nonce", { method: "POST", body: "{}" });
      setPromotion(nonce.promotion as PromotionStatus);
      setBusyLabel("Approve one free authentication signature");
      const output = await wallet.signIn(nonce.payload);
      const publicKey = walletResultBytes(output.account.address.toBytes(), "public key", 32);
      const signature = walletResultBytes(output.signature, "signature", 64);
      const signedMessage = walletResultBytes(output.signedMessage, "signed message");
      setBusyLabel("Verifying your NFT and registering the entry");
      const verified = await request("/api/seeker-pass/verify", {
        method: "POST",
        body: JSON.stringify({
          payload: nonce.payload,
          output: {
            publicKey: Buffer.from(publicKey).toString("base64"),
            signature: Buffer.from(signature).toString("base64"),
            signedMessage: Buffer.from(signedMessage).toString("base64"),
          },
        }),
      }) as VerificationResult;
      setResult(verified);
      setPromotion(verified.promotion);
    } catch {
      console.warn("[LuckyMe] NFT verification ended without a confirmed result.");
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }, [wallet]);

  const clearWallet = useCallback(async () => {
    setResult(null);
    await wallet.disconnect();
  }, [wallet]);

  const progress = Math.max(0, Math.min(100, promotion?.progressPercent ?? 0));
  const prizes = promotion?.prizes ?? [
    0.58, 0.35, 0.27, 0.22, 0.19, 0.17, 0.15, 0.14, 0.13, 0.12,
    0.11, 0.10, 0.09, 0.08, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05,
  ].map((prizeSol, index) => ({ rank: index + 1, prizeSol, prizeLamports: String(prizeSol * 1_000_000_000) }));

  return (
    <ImageBackground source={require("../assets/home/luckyme-home-background-v2.png")} style={styles.background} imageStyle={styles.backgroundImage}>
      <StatusBar hidden translucent backgroundColor="transparent" barStyle="light-content" />
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.back}>
            <Text style={styles.backText}>‹ Back to LuckyMe</Text>
          </Pressable>

          <View accessibilityHint={PROMOTION_ACCESSIBILITY_SUMMARY} style={styles.hero}>
            <Image source={require("../assets/home/nft-medallion-v1.png")} style={styles.heroArt} />
            <View style={styles.heroShade} />
            <View style={styles.heroCopy}>
              <Text style={styles.kicker}>LUCKYME SEEKER PASS</Text>
              <Text style={styles.title}>NFT Holders{`\n`}Draw</Text>
              <Text style={styles.prizeLine}>{promotion?.prizeSol ?? 3} SOL · {promotion?.winnerCount ?? 20} WINNERS</Text>
              <Text style={styles.subtitle}>One free verified entry per active wallet and official NFT.</Text>
            </View>
          </View>

          <View style={styles.counterCard}>
            <View style={styles.counterHead}>
              <Text style={styles.counterLabel}>VERIFIED ENTRIES</Text>
              <Text style={styles.counterValue}>{(promotion?.entryCount ?? 0).toLocaleString()} / {(promotion?.entryThreshold ?? 1_000).toLocaleString()}</Text>
            </View>
            <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
            <View style={styles.factRow}>
              <View style={styles.fact}><Text style={styles.factValue}>Free</Text><Text style={styles.factLabel}>ENTRY</Text></View>
              <View style={styles.fact}><Text style={styles.factValue}>{promotion?.winnerCount ?? 20}</Text><Text style={styles.factLabel}>WINNERS</Text></View>
              <View style={styles.fact}><Text style={styles.factValue}>{(promotion?.entriesRemaining ?? 1_000).toLocaleString()}</Text><Text style={styles.factLabel}>STILL NEEDED</Text></View>
            </View>
          </View>

          <View style={styles.fundingCard}>
            <View><Text style={styles.fundingLabel}>CAMPAIGN PAYOUT</Text><Text style={styles.fundingValue}>{promotion?.funded ? "Funding confirmed" : "Funding pending"}</Text></View>
            <Text style={styles.fundingBadge}>{promotion?.funded ? "FUNDED" : "NOT FUNDED"}</Text>
          </View>

          {result ? (
            <View style={[styles.resultCard, result.registered ? styles.resultEligible : styles.resultMissing]}>
              <Text style={styles.resultTitle}>{result.registered ? "✓ ENTRY CONFIRMED" : result.eligible ? "NFT VERIFIED" : "NFT NOT FOUND"}</Text>
              <Text style={styles.resultText}>{result.message}</Text>
              {result.entryNumber ? <Text style={styles.entryNumber}>ENTRY #{result.entryNumber}</Text> : null}
              <Text style={styles.resultLabel}>WALLET CHECKED</Text>
              <Text selectable style={styles.address}>{result.wallet}</Text>
              {result.asset ? <><Text style={styles.resultLabel}>NFT ASSET</Text><Text selectable style={styles.address}>{result.asset.assetId}</Text></> : null}
            </View>
          ) : null}

          <Pressable accessibilityRole="button" disabled={busy} onPress={verify} style={({ pressed }) => [styles.verifyButton, pressed && !busy ? styles.pressed : null, busy ? styles.disabled : null]}>
            {busy ? <ActivityIndicator color="#05291D" /> : null}
            <Text style={styles.verifyButtonText}>{busy ? busyLabel : "Verify NFT & Enter Free"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => clearWallet().catch(() => undefined)} style={styles.clearButton}>
            <Text style={styles.clearButtonText}>Clear wallet selection</Text>
          </Pressable>
          <Text style={styles.disclaimer}>Authentication only—no transaction and no fee. Ownership is checked again before winner confirmation.</Text>
          <Text style={styles.statusCopy}>{statusCopy(promotion)}</Text>
          <Text style={styles.prizeDetails}>Prize split: {prizes.map((item) => `#${item.rank} ${item.prizeSol.toFixed(2)}`).join(" · ")} SOL</Text>
        </ScrollView>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: "#031B14" },
  backgroundImage: { opacity: 0.78, resizeMode: "cover" },
  safe: { flex: 1, backgroundColor: "rgba(1,22,16,0.20)" },
  content: { gap: 10, padding: 16, paddingBottom: 34 },
  back: { alignSelf: "flex-start", paddingVertical: 6 },
  backText: { color: "#D6FF84", fontSize: 13, fontWeight: "900" },
  hero: { borderColor: "rgba(155,255,104,0.38)", borderRadius: 20, borderWidth: 1, height: 202, justifyContent: "flex-end", overflow: "hidden", padding: 18 },
  heroArt: { height: 190, position: "absolute", right: -22, top: -24, width: 190 },
  heroShade: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(2,31,24,0.55)" },
  heroCopy: { gap: 4, maxWidth: "72%" },
  kicker: { color: "#83F1E0", fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  title: { color: "#FFFFFF", fontSize: 31, fontWeight: "900", letterSpacing: -1, lineHeight: 31 },
  prizeLine: { color: "#FFE66F", fontSize: 14, fontWeight: "900", letterSpacing: 0.4 },
  subtitle: { color: "rgba(255,255,255,0.76)", fontSize: 12, lineHeight: 17 },
  counterCard: { backgroundColor: "rgba(2,37,28,0.82)", borderColor: "rgba(155,255,104,0.30)", borderRadius: 18, borderWidth: 1, padding: 13 },
  counterHead: { flexDirection: "row", justifyContent: "space-between" },
  counterLabel: { color: "rgba(255,255,255,0.68)", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  counterValue: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  progressTrack: { backgroundColor: "#151D2A", borderRadius: 99, height: 10, marginTop: 12, overflow: "hidden" },
  progressFill: { backgroundColor: "#8EFF69", borderRadius: 99, height: "100%" },
  factRow: { flexDirection: "row", gap: 7, marginTop: 10 },
  fact: { alignItems: "center", backgroundColor: "rgba(1,27,22,0.80)", borderColor: "rgba(168,255,112,0.20)", borderRadius: 13, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 67 },
  factValue: { color: "#FFF5A5", fontSize: 18, fontWeight: "900" },
  factLabel: { color: "rgba(255,255,255,0.60)", fontSize: 8, fontWeight: "900", marginTop: 3 },
  fundingCard: { alignItems: "center", backgroundColor: "rgba(2,37,28,0.84)", borderColor: "rgba(155,255,104,0.26)", borderRadius: 18, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", padding: 13 },
  fundingLabel: { color: "rgba(255,255,255,0.55)", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  fundingValue: { color: "#FFFFFF", fontSize: 13, fontWeight: "900", marginTop: 2 },
  fundingBadge: { backgroundColor: "rgba(95,72,8,0.32)", borderColor: "rgba(255,224,101,0.30)", borderRadius: 20, borderWidth: 1, color: "#FFE477", fontSize: 8, fontWeight: "900", overflow: "hidden", paddingHorizontal: 9, paddingVertical: 6 },
  prizeCard: { alignItems: "center", backgroundColor: "rgba(255,216,77,0.08)", borderColor: "rgba(255,216,77,0.34)", borderRadius: 18, borderWidth: 1, marginTop: 16, padding: 18 },
  prizeLabel: { color: "#FFD84D", fontSize: 11, fontWeight: "900", letterSpacing: 1.3 },
  prize: { color: "#FFFFFF", fontSize: 42, fontWeight: "900", marginTop: 3 },
  prizeCopy: { color: "#CAD3E0", fontSize: 13, lineHeight: 19, marginTop: 5, textAlign: "center" },
  prizeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 15, width: "100%" },
  prizeItem: { backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 9, flexBasis: "23%", flexGrow: 1, paddingHorizontal: 7, paddingVertical: 8 },
  prizeRank: { color: "#8895A8", fontSize: 9, fontWeight: "800" },
  prizeAmount: { color: "#FFD84D", fontSize: 11, fontWeight: "900", marginTop: 2 },
  fundingCopy: { color: "#AEB9CB", fontSize: 10, lineHeight: 15, marginTop: 13, textAlign: "center" },
  steps: { gap: 10, marginTop: 18 },
  step: { alignItems: "center", backgroundColor: "#0D1320", borderColor: "#202B3D", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 12, padding: 14 },
  stepNumber: { color: "#070A12", backgroundColor: "#14F1D9", borderRadius: 14, fontSize: 13, fontWeight: "900", overflow: "hidden", paddingHorizontal: 9, paddingVertical: 5 },
  stepText: { color: "#D9E1EC", flex: 1, fontSize: 13, lineHeight: 19 },
  resultCard: { borderRadius: 16, borderWidth: 1, marginTop: 20, padding: 16 },
  resultEligible: { backgroundColor: "rgba(20,241,149,0.09)", borderColor: "rgba(20,241,149,0.42)" },
  resultMissing: { backgroundColor: "rgba(255,150,70,0.08)", borderColor: "rgba(255,150,70,0.38)" },
  resultTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  resultText: { color: "#C8D1DD", fontSize: 13, lineHeight: 19, marginTop: 6 },
  entryNumber: { color: "#14F195", fontSize: 28, fontWeight: "900", marginTop: 12 },
  resultLabel: { color: "#8996A9", fontSize: 9, fontWeight: "900", letterSpacing: 1, marginTop: 14 },
  address: { color: "#FFFFFF", fontSize: 11, lineHeight: 17, marginTop: 4 },
  resultValue: { color: "#FFFFFF", fontSize: 13, marginTop: 4 },
  resultNote: { color: "#8894A6", fontSize: 10, lineHeight: 15, marginTop: 16 },
  verifyButton: { alignItems: "center", backgroundColor: "#70F2A8", borderRadius: 14, flexDirection: "row", gap: 9, justifyContent: "center", minHeight: 52, paddingHorizontal: 18 },
  verifyButtonText: { color: "#05291D", flexShrink: 1, fontSize: 14, fontWeight: "900", textAlign: "center" },
  clearButton: { alignItems: "center", borderColor: "rgba(190,255,142,0.22)", borderRadius: 14, borderWidth: 1, justifyContent: "center", minHeight: 42 },
  clearButtonText: { color: "rgba(255,255,255,0.72)", fontSize: 12, fontWeight: "800" },
  pressed: { opacity: 0.68 },
  disabled: { opacity: 0.62 },
  disclaimer: { color: "rgba(255,255,255,0.65)", fontSize: 10, lineHeight: 15, textAlign: "center" },
  statusCopy: { color: "rgba(255,255,255,0.52)", fontSize: 10, lineHeight: 15, textAlign: "center" },
  prizeDetails: { color: "rgba(255,255,255,0.45)", fontSize: 9, lineHeight: 14, textAlign: "center" },
});
