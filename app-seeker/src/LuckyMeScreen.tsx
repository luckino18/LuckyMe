import { Transaction } from "@solana/web3.js";
import {
  fromUint8Array,
  toUint8Array,
  useMobileWallet,
} from "@wallet-ui/react-native-web3js";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";

declare const process:
  | {
      env?: {
        EXPO_PUBLIC_LUCKYME_API_URL?: string;
      };
    }
  | undefined;

type RoundState = {
  address?: string;
  roundId: number;
  startTs: number;
  endTs: number;
  totalTickets: string;
  totalSol?: string;
  entrantCount: number;
  settled: boolean;
  jackpotTriggered: boolean;
  winner?: string;
};

type Pool = {
  id: string;
  label: string;
  ticketPriceSol: string;
  currentRound?: number;
  jackpotSol?: string;
  roundDurationSeconds?: number;
  mainPrizeBps?: number;
  houseFeeBps?: number;
  jackpotBps?: number;
  activeRound?: RoundState | null;
};

type PoolsResponse = {
  source?: string;
  onchain?: {
    available: boolean;
    clusterUrl?: string;
    programId?: string;
  };
  pools?: Pool[];
};

type BuildBuyTicketsResponse = {
  transactionBase64: string;
  summary: {
    amountSol: string;
    pool: string;
    roundId: number;
    ticketCount: number;
  };
  simulation?: {
    ok: boolean;
    err: unknown;
  };
};

type SubmitTransactionResponse = {
  signature: string;
};

const API_BASE_URL =
  typeof process !== "undefined" && process.env?.EXPO_PUBLIC_LUCKYME_API_URL
    ? process.env.EXPO_PUBLIC_LUCKYME_API_URL
    : "http://localhost:8788";

const FALLBACK_POOLS: Pool[] = [
  {
    id: "mini",
    label: "Mini",
    ticketPriceSol: "0.005",
    currentRound: 0,
    jackpotSol: "0",
    roundDurationSeconds: 300,
    mainPrizeBps: 9500,
    houseFeeBps: 300,
    jackpotBps: 200,
    activeRound: null,
  },
  {
    id: "normal",
    label: "Normal",
    ticketPriceSol: "0.01",
    currentRound: 0,
    jackpotSol: "0",
    roundDurationSeconds: 300,
    mainPrizeBps: 9500,
    houseFeeBps: 300,
    jackpotBps: 200,
    activeRound: null,
  },
  {
    id: "high",
    label: "High",
    ticketPriceSol: "0.1",
    currentRound: 0,
    jackpotSol: "0",
    roundDurationSeconds: 300,
    mainPrizeBps: 9500,
    houseFeeBps: 300,
    jackpotBps: 200,
    activeRound: null,
  },
];

function formatSol(value: string | number | undefined) {
  if (value === undefined) {
    return "0";
  }

  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return String(value);
  }

  if (amount === 0) {
    return "0";
  }

  return amount
    .toFixed(amount < 0.001 ? 6 : 4)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

function formatBps(value: number | undefined) {
  if (value === undefined) {
    return "--";
  }

  return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}%`;
}

function formatRemaining(endTs: number | undefined, now: number) {
  if (!endTs) {
    return "--";
  }

  const remainingSeconds = Math.max(0, Math.ceil((endTs * 1000 - now) / 1000));
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = String(remainingSeconds % 60).padStart(2, "0");

  return `${minutes}:${seconds}`;
}

async function postJson<TResponse>(path: string, body: unknown) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
  const payload = await response.json();

  if (!response.ok) {
    const message =
      typeof payload?.message === "string" ? payload.message : "Request failed";
    throw new Error(message);
  }

  return payload as TResponse;
}

function shortAddress(address: string | undefined) {
  if (!address) {
    return "--";
  }

  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function LuckyMeScreen() {
  const { account, connect, disconnect, signTransaction } = useMobileWallet();
  const [pools, setPools] = useState<Pool[]>(FALLBACK_POOLS);
  const [selectedPoolId, setSelectedPoolId] = useState(FALLBACK_POOLS[1].id);
  const [ticketCount, setTicketCount] = useState(1);
  const [source, setSource] = useState("fallback");
  const [clusterUrl, setClusterUrl] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const loadPools = useCallback(async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const response = await fetch(`${API_BASE_URL}/pools`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as PoolsResponse;

      if (!Array.isArray(payload.pools) || payload.pools.length === 0) {
        throw new Error("No pools returned");
      }

      setPools(payload.pools);
      setSource(payload.source ?? "backend");
      setClusterUrl(payload.onchain?.clusterUrl);
      setError(null);
      setSelectedPoolId((current: string) =>
        payload.pools?.some((pool: Pool) => pool.id === current)
          ? current
          : payload.pools?.[0]?.id ?? FALLBACK_POOLS[0].id,
      );
    } catch (caught) {
      setPools(FALLBACK_POOLS);
      setSource("fallback");
      setClusterUrl(undefined);
      setError(caught instanceof Error ? caught.message : "Backend unavailable");
      setSelectedPoolId((current: string) =>
        FALLBACK_POOLS.some((pool: Pool) => pool.id === current)
          ? current
          : FALLBACK_POOLS[0].id,
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadPools();
  }, [loadPools]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(interval);
  }, []);

  const selectedPool = useMemo(
    () =>
      pools.find((pool: Pool) => pool.id === selectedPoolId) ?? FALLBACK_POOLS[0],
    [pools, selectedPoolId],
  );

  const activeRound = selectedPool.activeRound;

  const estimatedChance = useMemo(() => {
    if (!activeRound || activeRound.settled) {
      return "--";
    }

    const currentTickets = Number(activeRound.totalTickets);

    if (!Number.isFinite(currentTickets)) {
      return "--";
    }

    return ((ticketCount / (currentTickets + ticketCount)) * 100).toFixed(2);
  }, [activeRound, ticketCount]);

  const roundStatus = useMemo(() => {
    if (!activeRound) {
      return "Waiting";
    }

    if (activeRound.settled) {
      return "Settled";
    }

    return activeRound.endTs * 1000 <= now ? "Ready" : "Open";
  }, [activeRound, now]);

  const roundEnds = activeRound?.settled
    ? "Settled"
    : formatRemaining(activeRound?.endTs, now);
  const sourceLabel =
    source === "onchain"
      ? "On-chain"
      : source === "fallback"
        ? "Fallback"
        : source === "static"
          ? "Static"
          : "Backend";
  const splitLabel = `${formatBps(selectedPool.mainPrizeBps)} / ${formatBps(
    selectedPool.houseFeeBps,
  )} / ${formatBps(selectedPool.jackpotBps)}`;
  const walletAddress = account?.address.toBase58();
  const roundEndTs = activeRound?.endTs;
  const roundIsOpen =
    Boolean(activeRound && !activeRound.settled) &&
    typeof roundEndTs === "number" &&
    roundEndTs * 1000 > now;
  const joinDisabled =
    !roundIsOpen ||
    source !== "onchain" ||
    loading ||
    refreshing ||
    submitting;
  const primaryDisabled = account ? joinDisabled : submitting;
  const primaryButtonLabel = !account
    ? "Connect wallet"
    : submitting
      ? "Joining..."
      : !roundIsOpen
        ? "No open round"
        : "Join round";

  const handlePrimaryAction = useCallback(async () => {
    setWalletError(null);
    setTxSignature(null);

    if (!account || !walletAddress) {
      try {
        await connect();
      } catch (caught) {
        setWalletError(
          caught instanceof Error ? caught.message : "Wallet connection failed",
        );
      }
      return;
    }

    if (joinDisabled) {
      return;
    }

    setSubmitting(true);

    try {
      const built = await postJson<BuildBuyTicketsResponse>(
        "/transactions/buy-tickets",
        {
          player: walletAddress,
          pool: selectedPool.id,
          ticketCount,
        },
      );

      if (built.simulation && !built.simulation.ok) {
        throw new Error(`Simulation failed: ${JSON.stringify(built.simulation.err)}`);
      }

      const transaction = Transaction.from(toUint8Array(built.transactionBase64));
      const signedTransaction = await signTransaction(transaction);
      const signedTransactionBase64 = fromUint8Array(
        Uint8Array.from(signedTransaction.serialize()),
      );
      const submitted = await postJson<SubmitTransactionResponse>(
        "/transactions/submit",
        {
          signedTransactionBase64,
        },
      );

      setTxSignature(submitted.signature);
      await loadPools(true);
    } catch (caught) {
      setWalletError(caught instanceof Error ? caught.message : "Join failed");
    } finally {
      setSubmitting(false);
    }
  }, [
    account,
    connect,
    joinDisabled,
    loadPools,
    selectedPool.id,
    signTransaction,
    ticketCount,
    walletAddress,
  ]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>LuckyMe</Text>
              <Text style={styles.subtitle}>
                {source === "onchain"
                  ? "Live Solana pools"
                  : source === "static"
                    ? "Static pool metadata"
                    : "Local fallback pools"}
              </Text>
            </View>
            <Pressable
              disabled={loading || refreshing}
              onPress={() => void loadPools(true)}
              style={[
                styles.refreshButton,
                (loading || refreshing) && styles.refreshButtonDisabled,
              ]}
            >
              {loading || refreshing ? (
                <ActivityIndicator color="#17120a" />
              ) : (
                <Text style={styles.refreshText}>Refresh</Text>
              )}
            </Pressable>
          </View>
          {error ? <Text style={styles.errorText}>Offline: {error}</Text> : null}
        </View>

        <FlatList
          data={pools}
          keyExtractor={(item: Pool) => item.id}
          horizontal
          contentContainerStyle={styles.poolList}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }: { item: Pool }) => (
            <Pressable
              onPress={() => setSelectedPoolId(item.id)}
              style={[
                styles.poolButton,
                selectedPool.id === item.id && styles.poolButtonSelected,
              ]}
            >
              <Text style={styles.poolLabel}>{item.label}</Text>
              <Text style={styles.poolPrice}>{item.ticketPriceSol} SOL</Text>
            </Pressable>
          )}
        />

        <View style={styles.roundPanel}>
          <View style={styles.row}>
            <Text style={styles.label}>Active pool</Text>
            <Text style={styles.value}>{selectedPool.label}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Ticket</Text>
            <Text style={styles.value}>{selectedPool.ticketPriceSol} SOL</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Jackpot</Text>
            <Text style={styles.value}>
              {formatSol(selectedPool.jackpotSol)} SOL
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Round</Text>
            <Text style={styles.value}>
              {activeRound?.roundId ?? selectedPool.currentRound ?? 0}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Status</Text>
            <Text style={styles.value}>{roundStatus}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Round ends</Text>
            <Text style={styles.value}>{roundEnds}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Tickets</Text>
            <Text style={styles.value}>{activeRound?.totalTickets ?? "0"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Your chance</Text>
            <Text style={styles.value}>
              {estimatedChance === "--" ? estimatedChance : `${estimatedChance}%`}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Split</Text>
            <Text style={styles.value}>{splitLabel}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Source</Text>
            <Text style={styles.value}>
              {clusterUrl ? `${sourceLabel} RPC` : sourceLabel}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Wallet</Text>
            <View style={styles.walletValue}>
              <Text style={styles.value}>{shortAddress(walletAddress)}</Text>
              {account ? (
                <Pressable
                  disabled={submitting}
                  onPress={() => void disconnect()}
                  style={styles.disconnectButton}
                >
                  <Text style={styles.disconnectText}>Disconnect</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.stepper}>
          <Pressable
            style={styles.stepperButton}
            onPress={() => setTicketCount(Math.max(1, ticketCount - 1))}
            disabled={ticketCount <= 1}
          >
            <Text style={styles.stepperText}>-</Text>
          </Pressable>
          <Text style={styles.ticketCount}>{ticketCount}</Text>
          <Pressable
            style={styles.stepperButton}
            onPress={() => setTicketCount(ticketCount + 1)}
          >
            <Text style={styles.stepperText}>+</Text>
          </Pressable>
        </View>

        <Pressable
          disabled={primaryDisabled}
          onPress={() => void handlePrimaryAction()}
          style={[
            styles.joinButton,
            primaryDisabled && styles.joinButtonDisabled,
          ]}
        >
          <Text
            style={[styles.joinText, primaryDisabled && styles.joinTextDisabled]}
          >
            {primaryButtonLabel}
          </Text>
        </Pressable>
        {walletError ? <Text style={styles.errorText}>{walletError}</Text> : null}
        {txSignature ? (
          <Text style={styles.successText}>
            Sent {shortAddress(txSignature)}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#101316",
  },
  screen: {
    flex: 1,
    gap: 18,
    padding: 20,
  },
  header: {
    gap: 4,
  },
  headerTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: "#f7f3ea",
    fontSize: 34,
    fontWeight: "800",
  },
  subtitle: {
    color: "#98a2ad",
    fontSize: 15,
  },
  refreshButton: {
    alignItems: "center",
    backgroundColor: "#f2b84b",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 40,
    minWidth: 86,
    paddingHorizontal: 14,
  },
  refreshButtonDisabled: {
    opacity: 0.64,
  },
  refreshText: {
    color: "#17120a",
    fontSize: 13,
    fontWeight: "800",
  },
  errorText: {
    color: "#ff9b8f",
    fontSize: 13,
    marginTop: 6,
  },
  poolList: {
    gap: 10,
  },
  poolButton: {
    width: 118,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2d343b",
    backgroundColor: "#171b20",
    padding: 14,
  },
  poolButtonSelected: {
    borderColor: "#f2b84b",
    backgroundColor: "#241f15",
  },
  poolLabel: {
    color: "#f7f3ea",
    fontSize: 16,
    fontWeight: "700",
  },
  poolPrice: {
    color: "#98a2ad",
    marginTop: 8,
  },
  roundPanel: {
    gap: 12,
    borderRadius: 8,
    backgroundColor: "#171b20",
    padding: 16,
  },
  row: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  label: {
    color: "#98a2ad",
    flex: 1,
    fontSize: 14,
  },
  value: {
    color: "#f7f3ea",
    flexShrink: 1,
    fontSize: 15,
    fontWeight: "700",
    textAlign: "right",
  },
  walletValue: {
    alignItems: "flex-end",
    flexShrink: 1,
    gap: 8,
  },
  disconnectButton: {
    borderColor: "#3a424b",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  disconnectText: {
    color: "#d7dde4",
    fontSize: 12,
    fontWeight: "700",
  },
  stepper: {
    alignItems: "center",
    flexDirection: "row",
    gap: 18,
    justifyContent: "center",
  },
  stepperButton: {
    alignItems: "center",
    backgroundColor: "#252b31",
    borderRadius: 24,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  stepperText: {
    color: "#f7f3ea",
    fontSize: 26,
    fontWeight: "800",
  },
  ticketCount: {
    color: "#f7f3ea",
    fontSize: 28,
    fontWeight: "800",
    minWidth: 54,
    textAlign: "center",
  },
  joinButton: {
    alignItems: "center",
    backgroundColor: "#f2b84b",
    borderRadius: 8,
    marginTop: "auto",
    paddingVertical: 16,
  },
  joinButtonDisabled: {
    backgroundColor: "#5d6470",
  },
  joinText: {
    color: "#17120a",
    fontSize: 17,
    fontWeight: "800",
  },
  joinTextDisabled: {
    color: "#d7dde4",
  },
  successText: {
    color: "#89e5b6",
    fontSize: 13,
    textAlign: "center",
  },
});
