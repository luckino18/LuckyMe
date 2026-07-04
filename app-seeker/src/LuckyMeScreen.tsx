import { PublicKey, Transaction } from "@solana/web3.js";
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
  ScrollView,
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
  startTs?: number;
  endTs?: number;
  totalTickets?: string;
  totalSol?: string;
  entrantCount?: number;
  settled?: boolean;
  jackpotTriggered?: boolean;
  winner?: string;
  jackpotWinner?: string;
  userEntry?: {
    address: string;
    player: string;
    ticketStart: string;
    ticketCount: string;
    lamports: string;
    chancePercent: string;
  } | null;
  missing?: boolean;
};

type PoolAddresses = {
  pool?: string;
  poolVault?: string;
  jackpotVault?: string;
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
  addresses?: PoolAddresses;
  activeRound?: RoundState | null;
  recentRounds?: RoundState[];
};

type ConfigState = {
  treasury?: string;
  jackpotOddsDenominator?: number;
};

type PoolsResponse = {
  source?: string;
  onchain?: {
    available: boolean;
    clusterUrl?: string;
    programId?: string;
  };
  config?: ConfigState | null;
  pools?: Pool[];
};

type BuildBuyTicketsResponse = {
  clusterUrl?: string;
  programId?: string;
  transactionBase64: string;
  summary: {
    amountLamports?: string;
    amountSol: string;
    player?: string;
    pool: string;
    roundId: number;
    ticketPriceLamports?: string;
    ticketCount: number;
  };
  simulation?: {
    ok: boolean;
    err: unknown;
    unitsConsumed?: number | null;
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

function formatBpsShare(totalSol: string | undefined, bps: number | undefined) {
  if (totalSol === undefined || bps === undefined) {
    return "--";
  }

  const amount = Number(totalSol);

  if (!Number.isFinite(amount)) {
    return "--";
  }

  return `${formatSol((amount * bps) / 10_000)} SOL`;
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

function walletAddressFromAccount(
  account: { address?: unknown } | null | undefined,
) {
  const address = account?.address;

  if (!address) {
    return undefined;
  }

  if (typeof address === "string") {
    return address;
  }

  if (address instanceof Uint8Array) {
    return new PublicKey(address).toBase58();
  }

  if (typeof address === "object") {
    const toBase58 = (address as { toBase58?: unknown }).toBase58;

    if (typeof toBase58 === "function") {
      return toBase58.call(address) as string;
    }
  }

  return undefined;
}

function roundOutcome(round: RoundState, now: number) {
  if (round.missing) {
    return "Missing";
  }

  if (round.settled) {
    return "Settled";
  }

  if (typeof round.endTs === "number" && round.endTs * 1000 <= now) {
    return "Ready";
  }

  return "Open";
}

export function LuckyMeScreen() {
  const { account, connect, disconnect, signTransaction } = useMobileWallet();
  const walletAddress = walletAddressFromAccount(account);
  const [pools, setPools] = useState<Pool[]>(FALLBACK_POOLS);
  const [selectedPoolId, setSelectedPoolId] = useState(FALLBACK_POOLS[1].id);
  const [ticketCount, setTicketCount] = useState(1);
  const [source, setSource] = useState("fallback");
  const [clusterUrl, setClusterUrl] = useState<string | undefined>();
  const [config, setConfig] = useState<ConfigState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [pendingJoin, setPendingJoin] = useState<BuildBuyTicketsResponse | null>(
    null,
  );

  const loadPools = useCallback(async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const params = new URLSearchParams();
      if (walletAddress) {
        params.set("player", walletAddress);
      }
      const query = params.toString();
      const response = await fetch(
        `${API_BASE_URL}/pools${query ? `?${query}` : ""}`,
      );

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
      setConfig(payload.config ?? null);
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
      setConfig(null);
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
  }, [walletAddress]);

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
  const recentRounds = (selectedPool.recentRounds ?? []).filter(
    (round) => !round.missing,
  );
  const transparencyTotalSol = activeRound?.totalSol;

  const walletChance = useMemo(() => {
    if (!walletAddress || !activeRound || activeRound.missing) {
      return "--";
    }

    return activeRound.userEntry?.chancePercent ?? "0.00";
  }, [activeRound, walletAddress]);

  const roundStatus = useMemo(() => {
    if (!activeRound) {
      return "Waiting";
    }

    if (activeRound.settled) {
      return "Settled";
    }

    return roundOutcome(activeRound, now);
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

  useEffect(() => {
    setPendingJoin(null);
  }, [selectedPoolId, ticketCount, walletAddress]);

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
    submitting ||
    Boolean(pendingJoin);
  const primaryDisabled = account ? joinDisabled : submitting;
  const primaryButtonLabel = !account
    ? "Connect wallet"
    : submitting
      ? "Preparing..."
      : pendingJoin
        ? "Review transaction"
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
    setPendingJoin(null);

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

      setPendingJoin(built);
    } catch (caught) {
      setWalletError(
        caught instanceof Error ? caught.message : "Transaction build failed",
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    account,
    connect,
    joinDisabled,
    selectedPool.id,
    ticketCount,
    walletAddress,
  ]);

  const handleConfirmPendingJoin = useCallback(async () => {
    if (!pendingJoin) {
      return;
    }

    setWalletError(null);
    setTxSignature(null);
    setSubmitting(true);

    try {
      const transaction = Transaction.from(
        toUint8Array(pendingJoin.transactionBase64),
      );
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
      setPendingJoin(null);
      await loadPools(true);
    } catch (caught) {
      setWalletError(caught instanceof Error ? caught.message : "Join failed");
    } finally {
      setSubmitting(false);
    }
  }, [loadPools, pendingJoin, signTransaction]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.screen}>
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
              {walletChance === "--" ? walletChance : `${walletChance}%`}
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

        <View style={styles.roundPanel}>
          <Text style={styles.sectionTitle}>Recent rounds</Text>
          {recentRounds.length > 0 ? (
            recentRounds.map((round) => {
              const outcome = roundOutcome(round, now);

              return (
                <View key={round.address ?? round.roundId} style={styles.historyItem}>
                  <View style={styles.historyHeader}>
                    <Text style={styles.historyRound}>Round {round.roundId}</Text>
                    <Text
                      style={[
                        styles.statusPill,
                        outcome === "Settled" && styles.statusPillSettled,
                        outcome === "Ready" && styles.statusPillReady,
                      ]}
                    >
                      {outcome}
                    </Text>
                  </View>
                  <Text style={styles.historyMeta}>
                    Tickets {round.totalTickets ?? "0"} | Pool{" "}
                    {formatSol(round.totalSol)} SOL
                  </Text>
                  {round.settled ? (
                    <Text style={styles.historyMeta}>
                      Winner {shortAddress(round.winner)}
                    </Text>
                  ) : (
                    <Text style={styles.historyMeta}>
                      Ends {formatRemaining(round.endTs, now)}
                    </Text>
                  )}
                  {round.jackpotTriggered ? (
                    <Text style={styles.historyMeta}>
                      Jackpot {shortAddress(round.jackpotWinner)}
                    </Text>
                  ) : null}
                </View>
              );
            })
          ) : (
            <Text style={styles.emptyText}>No on-chain rounds yet</Text>
          )}
        </View>

        <View style={styles.roundPanel}>
          <Text style={styles.sectionTitle}>Transparency</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Main prize</Text>
            <Text style={styles.value}>
              {formatBps(selectedPool.mainPrizeBps)} /{" "}
              {formatBpsShare(transparencyTotalSol, selectedPool.mainPrizeBps)}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>House fee</Text>
            <Text style={styles.value}>
              {formatBps(selectedPool.houseFeeBps)} /{" "}
              {formatBpsShare(transparencyTotalSol, selectedPool.houseFeeBps)}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Jackpot add</Text>
            <Text style={styles.value}>
              {formatBps(selectedPool.jackpotBps)} /{" "}
              {formatBpsShare(transparencyTotalSol, selectedPool.jackpotBps)}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Treasury</Text>
            <Text style={styles.value}>{shortAddress(config?.treasury)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Pool vault</Text>
            <Text style={styles.value}>
              {shortAddress(selectedPool.addresses?.poolVault)}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Jackpot vault</Text>
            <Text style={styles.value}>
              {shortAddress(selectedPool.addresses?.jackpotVault)}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Jackpot odds</Text>
            <Text style={styles.value}>
              1 / {config?.jackpotOddsDenominator ?? "--"}
            </Text>
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

        {pendingJoin ? (
          <View style={styles.reviewPanel}>
            <Text style={styles.sectionTitle}>Review transaction</Text>
            <View style={styles.row}>
              <Text style={styles.label}>Action</Text>
              <Text style={styles.value}>Buy tickets</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Pool</Text>
              <Text style={styles.value}>{selectedPool.label}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Round</Text>
              <Text style={styles.value}>{pendingJoin.summary.roundId}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Tickets</Text>
              <Text style={styles.value}>{pendingJoin.summary.ticketCount}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Amount</Text>
              <Text style={styles.value}>
                {formatSol(pendingJoin.summary.amountSol)} SOL
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Cluster</Text>
              <Text style={styles.value}>
                {pendingJoin.clusterUrl ?? clusterUrl ?? "--"}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Program</Text>
              <Text style={styles.value}>{shortAddress(pendingJoin.programId)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Wallet</Text>
              <Text style={styles.value}>
                {shortAddress(pendingJoin.summary.player ?? walletAddress)}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Simulation</Text>
              <Text style={styles.value}>
                {pendingJoin.simulation?.ok ? "Passed" : "Not available"}
              </Text>
            </View>
            <Text style={styles.reviewNote}>
              Wallet warnings are expected on localnet/devnet because the program
              is not a known mainnet app. Check the amount and cluster before
              signing.
            </Text>
            <View style={styles.reviewActions}>
              <Pressable
                disabled={submitting}
                onPress={() => setPendingJoin(null)}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={submitting}
                onPress={() => void handleConfirmPendingJoin()}
                style={[
                  styles.signButton,
                  submitting && styles.joinButtonDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.joinText,
                    submitting && styles.joinTextDisabled,
                  ]}
                >
                  {submitting ? "Submitting..." : "Sign in wallet"}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {!pendingJoin ? (
          <Pressable
            disabled={primaryDisabled}
            onPress={() => void handlePrimaryAction()}
            style={[
              styles.joinButton,
              primaryDisabled && styles.joinButtonDisabled,
            ]}
          >
            <Text
              style={[
                styles.joinText,
                primaryDisabled && styles.joinTextDisabled,
              ]}
            >
              {primaryButtonLabel}
            </Text>
          </Pressable>
        ) : null}
        {walletError ? <Text style={styles.errorText}>{walletError}</Text> : null}
        {txSignature ? (
          <Text style={styles.successText}>
            Sent {shortAddress(txSignature)}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#101316",
  },
  scroll: {
    flex: 1,
  },
  screen: {
    gap: 18,
    padding: 20,
    paddingBottom: 28,
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
  reviewPanel: {
    gap: 12,
    borderColor: "#f2b84b",
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: "#1f211f",
    padding: 16,
  },
  sectionTitle: {
    color: "#f7f3ea",
    fontSize: 17,
    fontWeight: "800",
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
  historyItem: {
    borderTopColor: "#2d343b",
    borderTopWidth: 1,
    gap: 6,
    paddingTop: 12,
  },
  historyHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  historyRound: {
    color: "#f7f3ea",
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
  },
  historyMeta: {
    color: "#98a2ad",
    fontSize: 13,
  },
  statusPill: {
    backgroundColor: "#24404d",
    borderRadius: 8,
    color: "#9ee8ff",
    fontSize: 12,
    fontWeight: "800",
    minWidth: 68,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 5,
    textAlign: "center",
  },
  statusPillReady: {
    backgroundColor: "#473c22",
    color: "#ffd982",
  },
  statusPillSettled: {
    backgroundColor: "#1e4332",
    color: "#89e5b6",
  },
  emptyText: {
    color: "#98a2ad",
    fontSize: 13,
  },
  reviewNote: {
    color: "#ffd982",
    fontSize: 13,
    lineHeight: 18,
  },
  reviewActions: {
    flexDirection: "row",
    gap: 12,
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#3a424b",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 12,
  },
  secondaryText: {
    color: "#d7dde4",
    fontSize: 15,
    fontWeight: "800",
  },
  signButton: {
    alignItems: "center",
    backgroundColor: "#f2b84b",
    borderRadius: 8,
    flex: 1.4,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 12,
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
