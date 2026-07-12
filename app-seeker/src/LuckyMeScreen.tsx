import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";
import { useMobileWallet } from "@wallet-ui/react-native-web3js";
import { Transaction } from "@solana/web3.js";
import { Buffer } from "@craftzdog/react-native-buffer";

import {
  hasVerifiedMinimumPolicy,
  isLivePoolEntryReady,
  renderStitchScreen,
  stitchDefaultTab,
  STITCH_SCREENS,
} from "./stitchScreens";
import type {
  LivePool,
  StitchScreenId,
  TransactionStatus,
  WinnerShareData,
} from "./stitchScreens";

type LegalLinkKey = "terms" | "privacy" | "support";
type NotificationOptInState =
  | "checking"
  | "prompt"
  | "enabled"
  | "declined"
  | "denied"
  | "unavailable"
  | "error";

type StitchMessage =
  | { type: "navigate"; screen: StitchScreenId; pool?: string }
  | { type: "refresh" }
  | { type: "action"; action: "ticket-dec" | "ticket-inc" | "buy-entry"; pool?: string }
  | { type: "link"; link: LegalLinkKey }
  | { type: "external"; url: string }
  | undefined;

const INITIAL_SCREEN: StitchScreenId = "home";
const UNAVAILABLE_SCREEN: StitchScreenId = "unavailable";
const WINNER_SCREEN: StitchScreenId = "winner";
const API_URL =
  process.env.EXPO_PUBLIC_LUCKYME_API_URL ?? "https://api.lucky-me.app";
const UI_PREVIEW_ENABLED = process.env.EXPO_PUBLIC_LUCKYME_UI_PREVIEW === "true";
const LIVE_POOL_REFRESH_INTERVAL_MS = 15_000;
const NOTIFICATION_PROMPT_KEY = "luckyme.notifications.prompt.v4";
const PUSH_TOKEN_KEY = "luckyme.notifications.expoPushToken.v1";
const ROUND_ALERTS_CHANNEL_ID = "luckyme-round-alerts";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const LEGAL_LINKS: Record<LegalLinkKey, string> = {
  terms: process.env.EXPO_PUBLIC_LUCKYME_TERMS_URL ?? "https://lucky-me.app/terms",
  privacy:
    process.env.EXPO_PUBLIC_LUCKYME_PRIVACY_URL ?? "https://lucky-me.app/privacy",
  support:
    process.env.EXPO_PUBLIC_LUCKYME_SUPPORT_URL ?? "https://lucky-me.app/support",
};

const SCREEN_BY_LABEL: Record<string, StitchScreenId> = {
  activity: "activity",
  home: "home",
  "how to": "how-to-play",
  "how to play": "how-to-play",
  links: "links",
  pools: "pools",
  settings: "links",
  wallet: "wallet",
};
const UNAVAILABLE_ALLOWED_SCREENS = new Set<StitchScreenId>([
  "how-to-play",
  "links",
  "wallet",
  "winner",
]);
const NAV_ITEMS: StitchScreenId[] = ["home", "pools", "activity", "wallet", "how-to-play"];
const NAV_TABS = new Set<StitchScreenId>(NAV_ITEMS);

function isLegalLinkKey(value: unknown): value is LegalLinkKey {
  return value === "terms" || value === "privacy" || value === "support";
}

function parseStitchMessage(data: string): StitchMessage {
  try {
    const message = JSON.parse(data) as {
      action?: string;
      pool?: string;
      type?: string;
      screen?: StitchScreenId;
      link?: string;
      url?: string;
    };

    if (message?.type === "refresh") {
      return { type: "refresh" };
    }

    if (message?.type === "link" && isLegalLinkKey(message.link)) {
      return { type: "link", link: message.link };
    }

    if (message?.type === "external" && typeof message.url === "string") {
      return { type: "external", url: message.url };
    }

    if (
      message?.type === "action" &&
      (message.action === "ticket-dec" ||
        message.action === "ticket-inc" ||
        message.action === "buy-entry")
    ) {
      return { type: "action", action: message.action, pool: message.pool };
    }

    if (message?.type === "navigate" && message.screen && message.screen in STITCH_SCREENS) {
      return { type: "navigate", screen: message.screen, pool: message.pool };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function injectedNavigation(screen: StitchScreenId, onchainAvailable: boolean) {
  const labels = JSON.stringify(SCREEN_BY_LABEL);
  const currentScreen = JSON.stringify(screen);
  const canNavigateOnchainScreens = JSON.stringify(onchainAvailable);

  return `
    (function () {
      const labels = ${labels};
      const currentScreen = ${currentScreen};
      const canNavigateOnchainScreens = ${canNavigateOnchainScreens};

      function post(payload) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }

      function send(screen) {
        post({ type: 'navigate', screen: screen });
      }

      function refresh() {
        post({ type: 'refresh' });
      }

      function sendLink(link) {
        post({ type: 'link', link: link });
      }

      function textOf(element) {
        return (element.textContent || '').trim().toLowerCase();
      }

      function routeFor(element) {
        // Preferred path: explicit route metadata on the control.
        const carrier = element.closest ? element.closest('[data-route]') : null;
        const dataRoute = carrier ? carrier.getAttribute('data-route') : null;

        if (dataRoute === 'refresh') {
          refresh();
          return null;
        }

        if (dataRoute === 'link') {
          const link = carrier.getAttribute('data-link') || '';
          if (link) {
            sendLink(link);
          }
          return null;
        }

        if (dataRoute === 'external') {
          const url = carrier.getAttribute('data-url') || carrier.getAttribute('href') || '';
          if (url) {
            post({ type: 'external', url: url });
          }
          return null;
        }

        if (dataRoute) {
          // The native wrapper applies availability gating authoritatively.
          return dataRoute;
        }

        // Fallback: legacy text matching for controls without metadata.
        const text = textOf(element);

        for (const label in labels) {
          if (text === label || text.endsWith(label)) {
            const route = labels[label];
            return canNavigateOnchainScreens || route === 'how-to-play' || route === 'links' || route === 'wallet' ? route : null;
          }
        }

        if (!canNavigateOnchainScreens) {
          if (text.includes('retry')) {
            refresh();
          }
          return null;
        }

        if (text.includes('confirm') || text.includes('sign')) {
          return 'syncing';
        }

        if (text.includes('retry')) {
          refresh();
          return null;
        }

        if (text.includes('complete') || text.includes('continue') || text.includes('success')) {
          return 'success';
        }

        if (text === 'done' || text.endsWith('done')) {
          return 'home';
        }

        if (text.includes('join')) {
          return currentScreen === 'pools' ? 'review' : 'pools';
        }

        if (text.includes('disconnect')) {
          return 'wallet';
        }

        if (text.includes('pool details')) {
          return 'home';
        }

        return null;
      }

      document.querySelectorAll('a, button').forEach(function (element) {
        element.addEventListener('click', function (event) {
          const actionCarrier = element.closest ? element.closest('[data-action]') : null;
          const dataAction = actionCarrier ? actionCarrier.getAttribute('data-action') : null;
          if (dataAction) {
            event.preventDefault();
            event.stopPropagation();
            post({
              type: 'action',
              action: dataAction,
              pool: actionCarrier.getAttribute('data-pool') || ''
            });
            return;
          }

          const route = routeFor(element);
          if (!route) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          const routeCarrier = element.closest ? element.closest('[data-route]') : null;
          post({
            type: 'navigate',
            screen: route,
            pool: routeCarrier ? routeCarrier.getAttribute('data-pool') || '' : ''
          });
        }, true);
      });

      true;
    })();
  `;
}

type BackendConfig = {
  onchainAvailable?: boolean;
  onchain?: {
    available?: boolean;
  };
};

type InitialScreenResult = {
  onchainAvailable: boolean;
  screen: StitchScreenId;
};

type PoolsResult = {
  onchainAvailable: boolean;
  pools: LivePool[];
};

type RefreshOptions = {
  allowScreenChange?: boolean;
  targetScreen?: StitchScreenId;
};

async function loadInitialScreen() {
  if (UI_PREVIEW_ENABLED) {
    return {
      onchainAvailable: true,
      screen: INITIAL_SCREEN,
    } satisfies InitialScreenResult;
  }

  const response = await fetch(`${API_URL}/config`, {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    return { onchainAvailable: false, screen: UNAVAILABLE_SCREEN };
  }

  const config = (await response.json()) as BackendConfig;
  const onchainAvailable =
    config.onchainAvailable === true || config.onchain?.available === true;

  return {
    onchainAvailable,
    screen: onchainAvailable ? INITIAL_SCREEN : UNAVAILABLE_SCREEN,
  } satisfies InitialScreenResult;
}

async function loadPoolsForWallet(player?: string): Promise<PoolsResult> {
  if (UI_PREVIEW_ENABLED) {
    return {
      onchainAvailable: true,
      pools: [],
    };
  }

  const url = new URL(`${API_URL}/pools`);
  if (player) {
    url.searchParams.set("player", player);
  }

  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    return { onchainAvailable: false, pools: [] };
  }

  const payload = (await response.json()) as {
    onchain?: { available?: boolean };
    pools?: LivePool[];
  };

  return {
    onchainAvailable: payload.onchain?.available === true,
    pools: Array.isArray(payload.pools) ? payload.pools : [],
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampTicketCount(pool: string, value: number) {
  const limit = pool === "premium" ? 1 : 1_000;
  const next = Number.isFinite(value) ? Math.trunc(value) : 1;
  return Math.max(1, Math.min(limit, next));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Wallet request failed";
}

function poolHasUserEntry(pools: LivePool[], poolId: string) {
  const pool = pools.find((item) => item.id === poolId);
  const round = pool?.activeRound ?? pool?.recentRounds?.[0];
  const tickets = round?.userEntry?.ticketCount;
  return Number(tickets ?? 0) > 0;
}

async function configureNotificationChannel() {
  if (Platform.OS !== "android") {
    return;
  }

  await Notifications.setNotificationChannelAsync(ROUND_ALERTS_CHANNEL_ID, {
    description: "Pool start and last 10 minute reminders for opted-in players.",
    enableLights: true,
    enableVibrate: true,
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: "#14F195",
    name: "LuckyMe round alerts",
    showBadge: false,
    vibrationPattern: [0, 240, 140, 240],
  });
}

async function requestNativeNotificationPermission() {
  if (Platform.OS === "android" && Number(Platform.Version) >= 33) {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      {
        title: "Allow LuckyMe notifications?",
        message: "LuckyMe sends pool-start and last-10-minute round alerts.",
        buttonPositive: "Allow",
        buttonNegative: "Not now",
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }

  const permissions = await Notifications.requestPermissionsAsync();
  return permissions.granted;
}

function expoProjectId() {
  return (
    Constants.easConfig?.projectId ??
    Constants.expoConfig?.extra?.eas?.projectId ??
    undefined
  );
}

async function getExpoPushToken() {
  const projectId = expoProjectId();
  const token = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  return token.data;
}

async function registerExpoPushToken(token: string, wallet?: string) {
  const response = await fetch(`${API_URL}/notifications/register`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      token,
      platform: Platform.OS,
      projectId: expoProjectId(),
      wallet,
    }),
  });

  if (!response.ok) {
    throw new Error("Push registration failed");
  }
}

function notificationDeepLink(response: Notifications.NotificationResponse) {
  const data = response.notification.request.content.data;
  const url = data?.url;
  return typeof url === "string" ? url : undefined;
}

type AppRoute =
  | { screen: StitchScreenId; pool?: string; winner?: WinnerShareData }
  | undefined;

function parseAppRoute(value: string): AppRoute {
  try {
    const url = new URL(value);
    const pathScreen = url.pathname.split("/").filter(Boolean)[0];
    const screenName = url.protocol === "luckyme:"
      ? url.hostname || pathScreen
      : pathScreen;

    if (screenName === "winner") {
      return {
        screen: WINNER_SCREEN,
        winner: {
          amount: url.searchParams.get("amount") ?? "",
          pool: url.searchParams.get("pool") ?? "",
          round: url.searchParams.get("round") ?? url.searchParams.get("roundId") ?? "",
          shareUrl: url.searchParams.get("shareUrl") ?? "https://lucky-me.app/play/",
          wallet: url.searchParams.get("wallet") ?? "",
        },
      };
    }

    if (screenName === "pool" || screenName === "pools" || screenName === "play") {
      return { screen: "pools", pool: url.searchParams.get("pool") ?? undefined };
    }

    if (screenName === "how-to-play" || screenName === "how" || screenName === "guide") {
      return { screen: "how-to-play" };
    }

    if (
      screenName === "home" ||
      screenName === "activity" ||
      screenName === "wallet" ||
      screenName === "links" ||
      screenName === "settings"
    ) {
      return {
        screen: screenName === "settings" ? "links" : screenName,
        pool: url.searchParams.get("pool") ?? undefined,
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function LuckyMeScreen() {
  const [onchainAvailable, setOnchainAvailable] = useState(false);
  const [screen, setScreen] = useState<StitchScreenId>(UNAVAILABLE_SCREEN);
  const [requestedTab, setRequestedTab] = useState<StitchScreenId>(INITIAL_SCREEN);
  const [winnerShare, setWinnerShare] = useState<WinnerShareData | undefined>();
  const [notificationOptInState, setNotificationOptInState] =
    useState<NotificationOptInState>("checking");
  const [notificationPromptVisible, setNotificationPromptVisible] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [livePools, setLivePools] = useState<LivePool[]>([]);
  const [selectedPool, setSelectedPool] = useState("mini");
  const [ticketCount, setTicketCount] = useState(1);
  const [transactionStatus, setTransactionStatus] = useState<TransactionStatus>({
    state: "idle",
  });
  const mountedRef = useRef(false);
  const wallet = useMobileWallet();
  const walletAddress = walletAddressToString(wallet.account?.address);
  const liveStateReady = livePools.length > 0 || UI_PREVIEW_ENABLED;
  const mainnetReady = onchainAvailable && liveStateReady;

  const html = useMemo(
    () =>
      renderStitchScreen(screen, {
        onchainAvailable: mainnetReady,
        activeTab: screen === UNAVAILABLE_SCREEN ? requestedTab : undefined,
        livePools,
        selectedPool,
        ticketCount,
        transaction: transactionStatus,
        walletAddress,
        winner: winnerShare,
      }),
    [
      livePools,
      mainnetReady,
      requestedTab,
      screen,
      selectedPool,
      ticketCount,
      transactionStatus,
      walletAddress,
      winnerShare,
    ],
  );

  const activeTab =
    screen === UNAVAILABLE_SCREEN ? requestedTab : stitchDefaultTab(screen);

  const injectedJavaScript = useMemo(
    () => injectedNavigation(screen, mainnetReady),
    [mainnetReady, screen],
  );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshFromBackend = useCallback(async (options: RefreshOptions = {}) => {
    const allowScreenChange = options.allowScreenChange ?? true;
    const targetScreen = options.targetScreen ?? requestedTab;

    try {
      const [nextResult, poolsResult] = await Promise.allSettled([
        loadInitialScreen(),
        loadPoolsForWallet(walletAddress),
      ]);
      const next = nextResult.status === "fulfilled"
        ? nextResult.value
        : { onchainAvailable: false, screen: UNAVAILABLE_SCREEN };
      const pools = poolsResult.status === "fulfilled"
        ? poolsResult.value
        : { onchainAvailable: false, pools: [] };

      if (!mountedRef.current) {
        return pools.pools;
      }

      const hasFreshPools = pools.pools.length > 0;
      const hasMainnetState = UI_PREVIEW_ENABLED || (
        next.onchainAvailable && pools.onchainAvailable && hasFreshPools
      );

      setOnchainAvailable(hasMainnetState);
      setLivePools(hasMainnetState ? pools.pools : []);

      if (allowScreenChange) {
        setScreen((current) => {
          if (hasMainnetState) {
            if (current === UNAVAILABLE_SCREEN) {
              return targetScreen;
            }
            if (current === INITIAL_SCREEN) {
              return next.screen;
            }
            return current;
          }

          return current === INITIAL_SCREEN ? UNAVAILABLE_SCREEN : current;
        });
      }

      return pools.pools;
    } catch {
      if (mountedRef.current) {
        setOnchainAvailable(UI_PREVIEW_ENABLED);
        setLivePools([]);
        if (UI_PREVIEW_ENABLED && allowScreenChange) {
          setScreen((current) =>
            current === UNAVAILABLE_SCREEN || current === INITIAL_SCREEN ? INITIAL_SCREEN : current,
          );
        }
      }

      return [];
    }
  }, [requestedTab, walletAddress]);

  useEffect(() => {
    void refreshFromBackend();

    const interval = setInterval(() => {
      void refreshFromBackend({ allowScreenChange: false });
    }, LIVE_POOL_REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [refreshFromBackend]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refreshFromBackend({ allowScreenChange: false });
      }
    });

    return () => {
      subscription.remove();
    };
  }, [refreshFromBackend]);

  useEffect(() => {
    let active = true;

    async function syncNotificationState() {
      try {
        await configureNotificationChannel();
        const permissions = await Notifications.getPermissionsAsync();

        if (!active) {
          return;
        }

        if (permissions.granted) {
          setNotificationOptInState("enabled");
          setNotificationPromptVisible(false);

          try {
            const token = await getExpoPushToken();
            await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
            await registerExpoPushToken(token, walletAddress);
          } catch {
            // Token fetch can fail offline; permission state remains valid.
          }
          return;
        }

        const previousDecision = await AsyncStorage.getItem(NOTIFICATION_PROMPT_KEY);
        if (!active) {
          return;
        }

        if (permissions.status === "denied") {
          setNotificationOptInState("denied");
          setNotificationPromptVisible(previousDecision !== "declined");
          return;
        }

        if (previousDecision === "declined") {
          setNotificationOptInState("declined");
          setNotificationPromptVisible(false);
          return;
        }

        setNotificationOptInState("prompt");
        setNotificationPromptVisible(true);
      } catch {
        if (active) {
          setNotificationOptInState("unavailable");
          setNotificationPromptVisible(false);
        }
      }
    }

    syncNotificationState();

    return () => {
      active = false;
    };
  }, [walletAddress]);

  const navigateTo = useCallback((nextScreen: StitchScreenId, pool?: string) => {
    if (pool) {
      setSelectedPool(pool);
      setTicketCount(1);
      setTransactionStatus({ state: "idle" });
    }

    if (NAV_TABS.has(nextScreen)) {
      setRequestedTab(nextScreen);
    }

    if (nextScreen === "home" || nextScreen === "pools" || nextScreen === "activity") {
      void refreshFromBackend({ allowScreenChange: true, targetScreen: nextScreen });
    }

    if (mainnetReady || UNAVAILABLE_ALLOWED_SCREENS.has(nextScreen)) {
      setScreen(nextScreen);
    } else {
      setScreen(UNAVAILABLE_SCREEN);
    }
  }, [mainnetReady, refreshFromBackend]);

  const handleAppUrl = useCallback((url: string) => {
    const route = parseAppRoute(url);

    if (!route) {
      return;
    }

    if (route.winner) {
      setWinnerShare(route.winner);
      setRequestedTab("activity");
      setScreen(WINNER_SCREEN);
      return;
    }

    navigateTo(route.screen, route.pool);
  }, [navigateTo]);

  useEffect(() => {
    let active = true;

    Linking.getInitialURL()
      .then((url) => {
        if (active && url) {
          handleAppUrl(url);
        }
      })
      .catch(() => {});

    const linkSubscription = Linking.addEventListener("url", ({ url }) => {
      handleAppUrl(url);
    });

    const notificationSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const url = notificationDeepLink(response);
        if (url) {
          handleAppUrl(url);
        }
      },
    );

    const lastNotification = Notifications.getLastNotificationResponse();
    const lastUrl = lastNotification ? notificationDeepLink(lastNotification) : undefined;
    if (lastUrl) {
      handleAppUrl(lastUrl);
      Notifications.clearLastNotificationResponse();
    }

    return () => {
      active = false;
      linkSubscription.remove();
      notificationSubscription.remove();
    };
  }, [handleAppUrl]);

  const refreshLivePools = useCallback(async (player = walletAddress) => {
    try {
      const pools = await loadPoolsForWallet(player);
      const verified = UI_PREVIEW_ENABLED || (pools.onchainAvailable && pools.pools.length > 0);
      setOnchainAvailable(verified);
      setLivePools(verified ? pools.pools : []);
      return pools.pools;
    } catch {
      setOnchainAvailable(UI_PREVIEW_ENABLED);
      setLivePools([]);
      return [];
    }
  }, [walletAddress]);

  const buyEntry = useCallback(async (pool = selectedPool) => {
    const poolId = pool || selectedPool;
    const count = clampTicketCount(poolId, ticketCount);
    const livePool = livePools.find((candidate) => candidate.id === poolId);
    setSelectedPool(poolId);
    setTicketCount(count);
    setRequestedTab("pools");

    if (!isLivePoolEntryReady(livePool)) {
      setTransactionStatus({
        state: "error",
        message: "This pool does not currently have a verified round open for entries.",
      });
      setScreen("review");
      return;
    }

    const reviewedRound = livePool?.activeRound;
    const expectedRoundId = Number(reviewedRound?.id ?? reviewedRound?.roundId);
    const expectedTotalTickets = String(reviewedRound?.totalTickets ?? "");
    if (
      !hasVerifiedMinimumPolicy(livePool) ||
      !Number.isSafeInteger(expectedRoundId) ||
      expectedRoundId < 1 ||
      !/^\d+$/.test(expectedTotalTickets)
    ) {
      setTransactionStatus({
        state: "error",
        message: "Verified round progress changed. Refresh and review the purchase again.",
      });
      setScreen("review");
      return;
    }

    setScreen("syncing");
    setTransactionStatus({
      state: "building",
      message: "Preparing the on-chain ticket transaction.",
    });

    try {
      const account = wallet.account ?? await wallet.connect();
      const player = walletAddressToString(account.address);

      if (!player) {
        throw new Error("Wallet did not return a usable public key");
      }

      const response = await fetch(`${API_URL}/transactions/buy-tickets`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          player,
          pool: poolId,
          ticketCount: count,
          expectedRoundId,
          expectedTotalTickets,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        simulation?: { ok?: boolean; err?: unknown };
        summary?: { roundId?: number; totalTicketsBefore?: string | number };
        transactionBase64?: string;
      };

      if (!response.ok) {
        throw new Error(payload.message ?? payload.error ?? "Ticket transaction build failed");
      }
      if (!payload.transactionBase64) {
        throw new Error("Backend did not return a ticket transaction");
      }
      if (payload.simulation?.ok === false) {
        throw new Error(`Backend simulation failed: ${JSON.stringify(payload.simulation.err)}`);
      }
      if (
        Number(payload.summary?.roundId) !== expectedRoundId ||
        String(payload.summary?.totalTicketsBefore ?? "") !== expectedTotalTickets
      ) {
        throw new Error("Round progress changed while preparing the transaction. Refresh and review again.");
      }

      const transaction = Transaction.from(Buffer.from(payload.transactionBase64, "base64"));
      const minContextSlot = await wallet.connection.getSlot("confirmed").catch(() => 0);
      setTransactionStatus({
        state: "wallet",
        message: "Approve the LuckyMe ticket transaction in your wallet.",
      });
      const signature = await wallet.signAndSendTransactions(transaction, minContextSlot);
      setTransactionStatus({
        state: "confirming",
        message: "Wallet approved. Confirming on Solana and refreshing tickets.",
        signature,
      });

      await wallet.connection.confirmTransaction(signature, "confirmed").catch(() => undefined);

      let latestPools: LivePool[] = [];
      for (let attempt = 0; attempt < 8; attempt += 1) {
        latestPools = await refreshLivePools(player);
        if (poolHasUserEntry(latestPools, poolId)) {
          break;
        }
        await delay(900);
      }

      setTransactionStatus({
        state: "confirmed",
        message: poolHasUserEntry(latestPools, poolId)
          ? "Ticket entry is confirmed in the round ledger."
          : "Transaction confirmed. Pool state is still catching up.",
        signature,
      });
      setRequestedTab("activity");
      setScreen("success");
    } catch (error) {
      setTransactionStatus({
        state: "error",
        message: errorMessage(error),
      });
      setScreen("syncing");
    }
  }, [livePools, refreshLivePools, selectedPool, ticketCount, wallet]);

  const enableNotifications = useCallback(async () => {
    setNotificationBusy(true);
    setNotificationError(null);

    try {
      await configureNotificationChannel();
      const currentPermissions = await Notifications.getPermissionsAsync();

      const granted = currentPermissions.granted || await requestNativeNotificationPermission();
      if (!granted) {
        setNotificationOptInState("denied");
        setNotificationError(
          "Android did not grant notification permission. Tap Enable alerts to try the system prompt again.",
        );
        setNotificationPromptVisible(true);
        return;
      }

      setNotificationOptInState("enabled");
      setNotificationPromptVisible(false);
      await AsyncStorage.setItem(NOTIFICATION_PROMPT_KEY, "accepted");

      try {
        const token = await getExpoPushToken();
        await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
        await registerExpoPushToken(token, walletAddress);
      } catch {
        setNotificationError("Notifications are enabled, but backend registration is not available yet.");
      }
    } catch (error) {
      setNotificationOptInState("error");
      setNotificationError(
        error instanceof Error ? error.message : "Notification permission failed",
      );
      setNotificationPromptVisible(true);
    } finally {
      setNotificationBusy(false);
    }
  }, [walletAddress]);

  const declineNotifications = useCallback(async () => {
    setNotificationOptInState("declined");
    setNotificationPromptVisible(false);
    await AsyncStorage.setItem(NOTIFICATION_PROMPT_KEY, "declined");
  }, []);

  const openLegalLink = useCallback((link: LegalLinkKey) => {
    const url = LEGAL_LINKS[link];

    if (url && url.startsWith("https://")) {
      Linking.openURL(url).catch(() => {});
    }
  }, []);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    const message = parseStitchMessage(event.nativeEvent.data);

    if (message?.type === "refresh") {
      refreshFromBackend();
      return;
    }

    if (message?.type === "action") {
      if (message.pool) {
        setSelectedPool(message.pool);
      }

      if (message.action === "ticket-dec") {
        setTicketCount((current) => clampTicketCount(message.pool ?? selectedPool, current - 1));
      } else if (message.action === "ticket-inc") {
        setTicketCount((current) => clampTicketCount(message.pool ?? selectedPool, current + 1));
      } else if (message.action === "buy-entry") {
        buyEntry(message.pool ?? selectedPool);
      }
      return;
    }

    if (message?.type === "link") {
      openLegalLink(message.link);
      return;
    }

    if (message?.type === "external" && message.url.startsWith("https://")) {
      Linking.openURL(message.url).catch(() => {});
      return;
    }

    if (message?.type === "navigate") {
      navigateTo(message.screen, message.pool);
    }
  }, [buyEntry, navigateTo, openLegalLink, refreshFromBackend, selectedPool]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar backgroundColor="transparent" barStyle="light-content" hidden translucent />
      <WebView
        key={screen}
        allowsBackForwardNavigationGestures
        bounces={false}
        domStorageEnabled
        injectedJavaScript={injectedJavaScript}
        javaScriptEnabled
        onMessage={handleMessage}
        originWhitelist={["*"]}
        setSupportMultipleWindows={false}
        source={{
          baseUrl: "https://lucky-me.app/",
          html,
        }}
        style={styles.webView}
      />
      <NotificationOptInModal
        busy={notificationBusy}
        error={notificationError}
        onDecline={declineNotifications}
        onEnable={enableNotifications}
        state={notificationOptInState}
        visible={notificationPromptVisible}
      />
      {screen === "wallet" ? <WalletPreflightPanel wallet={wallet} /> : null}
      {screen !== WINNER_SCREEN ? (
        <View style={styles.nativeNavHitbox}>
          {NAV_ITEMS.map((item) => (
            <Pressable
              accessibilityLabel={`Open ${item}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === item }}
              key={item}
              onPress={() => navigateTo(item)}
              style={({ pressed }) => [
                styles.nativeNavItem,
                pressed ? styles.nativeNavItemPressed : null,
              ]}
            />
          ))}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

type WalletPreflightPanelProps = {
  wallet: ReturnType<typeof useMobileWallet>;
};

type NotificationOptInModalProps = {
  busy: boolean;
  error: string | null;
  onDecline: () => void;
  onEnable: () => void;
  state: NotificationOptInState;
  visible: boolean;
};

function NotificationOptInModal({
  busy,
  error,
  onDecline,
  onEnable,
  state,
  visible,
}: NotificationOptInModalProps) {
  return (
    <Modal animationType="fade" transparent visible={visible}>
      <View style={styles.notificationBackdrop}>
        <View style={styles.notificationPanel}>
          <Text style={styles.notificationKicker}>LuckyMe alerts</Text>
          <Text style={styles.notificationTitle}>Round notifications</Text>
          <Text style={styles.notificationBody}>
            LuckyMe can notify you only when a pool countdown starts and when the
            last 10 minutes remain. No seed phrases, no wallet approvals, no spam.
          </Text>
          <View style={styles.notificationRules}>
            <Text style={styles.notificationRule}>Max 2 alerts per active round</Text>
            <Text style={styles.notificationRule}>Tap opens the relevant pool</Text>
            <Text style={styles.notificationRule}>You can keep playing without alerts</Text>
          </View>
          {error ? <Text style={styles.notificationError}>{error}</Text> : null}
          {state === "error" && !error ? (
            <Text style={styles.notificationError}>Notifications are not available right now.</Text>
          ) : null}
          {state === "denied" && !error ? (
            <Text style={styles.notificationError}>Tap Enable alerts to show the Android permission prompt.</Text>
          ) : null}
          <View style={styles.notificationActions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onEnable}
              style={({ pressed }) => [
                styles.notificationPrimaryButton,
                pressed || busy ? styles.walletButtonPressed : null,
              ]}
            >
              {busy ? <ActivityIndicator color="#FFFFFF" /> : null}
              <Text style={styles.notificationPrimaryText}>
                Enable alerts
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onDecline}
              style={({ pressed }) => [
                styles.notificationSecondaryButton,
                pressed || busy ? styles.walletButtonPressed : null,
              ]}
            >
              <Text style={styles.notificationSecondaryText}>Not now</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function WalletPreflightPanel({ wallet }: WalletPreflightPanelProps) {
  const [pending, setPending] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const address = walletAddressToString(wallet.account?.address);
  const connectedLabel = address ? ellipsify(address) : "Not connected";

  const connect = useCallback(async () => {
    setPending(true);
    setLastError(null);

    try {
      await wallet.connect();
    } catch (error) {
      setLastError(
        error instanceof Error
          ? error.message
          : "Wallet request was rejected or unavailable",
      );
    } finally {
      setPending(false);
    }
  }, [wallet]);

  const disconnect = useCallback(async () => {
    setPending(true);
    setLastError(null);

    try {
      await wallet.disconnect();
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Wallet disconnect failed");
    } finally {
      setPending(false);
    }
  }, [wallet]);

  return (
    <View style={styles.walletPanel}>
      <View style={styles.walletPanelHeader}>
        <View>
          <Text style={styles.walletKicker}>Mobile Wallet Adapter</Text>
          <Text style={styles.walletTitle}>{address ? "Wallet connected" : "Wallet connection"}</Text>
        </View>
        <View style={[styles.walletStatusPill, address ? styles.walletStatusPillConnected : null]}>
          <Text style={[styles.walletStatusText, address ? styles.walletStatusTextConnected : null]}>
            {address ? "CONNECTED" : "NOT CONNECTED"}
          </Text>
        </View>
      </View>

      <View style={styles.walletAddressRow}>
        <Text style={styles.walletLabel}>Address</Text>
        <Text style={styles.walletAddress}>{connectedLabel}</Text>
      </View>

      {lastError ? <Text style={styles.walletError}>{lastError}</Text> : null}

      <Pressable
        accessibilityRole="button"
        disabled={pending}
        onPress={address ? disconnect : connect}
        style={({ pressed }) => [
          styles.walletButton,
          address ? styles.walletButtonSecondary : null,
          pending || pressed ? styles.walletButtonPressed : null,
        ]}
      >
        {pending ? <ActivityIndicator color={address ? "#CBB2FF" : "#FFFFFF"} /> : null}
        <Text style={[styles.walletButtonText, address ? styles.walletButtonTextSecondary : null]}>
          {address ? "Disconnect wallet" : "Connect wallet"}
        </Text>
      </Pressable>
    </View>
  );
}

function ellipsify(value: string) {
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-6)}` : value;
}

function walletAddressToString(address: unknown) {
  if (!address) {
    return undefined;
  }

  if (typeof address === "string") {
    return address;
  }

  if (typeof address === "object") {
    const candidate = address as {
      toBase58?: () => string;
      toString?: () => string;
    };

    if (typeof candidate.toBase58 === "function") {
      return candidate.toBase58();
    }

    if (typeof candidate.toString === "function") {
      const value = candidate.toString();
      return value === "[object Object]" ? undefined : value;
    }
  }

  return undefined;
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: "#05070C",
    flex: 1,
  },
  webView: {
    backgroundColor: "#05070C",
    flex: 1,
  },
  notificationBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(5, 7, 12, 0.72)",
    flex: 1,
    justifyContent: "center",
    padding: 18,
  },
  notificationPanel: {
    backgroundColor: "rgba(13, 18, 28, 0.98)",
    borderColor: "rgba(153, 69, 255, 0.34)",
    borderRadius: 18,
    borderWidth: 1,
    maxWidth: 430,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { height: 22, width: 0 },
    shadowOpacity: 0.42,
    shadowRadius: 28,
    width: "100%",
  },
  notificationKicker: {
    color: "rgba(20, 241, 149, 0.92)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  notificationTitle: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.2,
    lineHeight: 29,
    marginTop: 6,
  },
  notificationBody: {
    color: "rgba(203, 213, 225, 0.84)",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  notificationRules: {
    gap: 8,
    marginTop: 14,
  },
  notificationRule: {
    backgroundColor: "rgba(255, 255, 255, 0.055)",
    borderColor: "rgba(148, 163, 184, 0.14)",
    borderRadius: 10,
    borderWidth: 1,
    color: "rgba(226, 232, 240, 0.9)",
    fontSize: 13,
    fontWeight: "700",
    minHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  notificationError: {
    color: "#FBD38D",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 12,
  },
  notificationActions: {
    gap: 10,
    marginTop: 18,
  },
  notificationPrimaryButton: {
    alignItems: "center",
    backgroundColor: "#9945FF",
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 48,
  },
  notificationPrimaryText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
  notificationSecondaryButton: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.055)",
    borderColor: "rgba(148, 163, 184, 0.18)",
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 46,
  },
  notificationSecondaryText: {
    color: "rgba(203, 213, 225, 0.92)",
    fontSize: 15,
    fontWeight: "800",
  },
  walletPanel: {
    backgroundColor: "rgba(13, 18, 28, 0.96)",
    borderColor: "rgba(148, 163, 184, 0.18)",
    borderRadius: 16,
    borderWidth: 1,
    bottom: 104,
    left: 18,
    padding: 18,
    position: "absolute",
    right: 18,
    shadowColor: "#000",
    shadowOffset: { height: 18, width: 0 },
    shadowOpacity: 0.36,
    shadowRadius: 24,
  },
  nativeNavHitbox: {
    bottom: 12,
    flexDirection: "row",
    height: 72,
    left: 12,
    position: "absolute",
    right: 12,
    zIndex: 20,
  },
  nativeNavItem: {
    flex: 1,
  },
  nativeNavItemPressed: {
    backgroundColor: "rgba(153, 69, 255, 0.16)",
    borderRadius: 14,
  },
  walletPanelHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  walletKicker: {
    color: "rgba(148, 163, 184, 0.85)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  walletTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 25,
    marginTop: 4,
  },
  walletStatusPill: {
    borderColor: "rgba(245, 158, 11, 0.34)",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  walletStatusPillConnected: {
    borderColor: "rgba(20, 241, 149, 0.34)",
  },
  walletStatusText: {
    color: "#F59E0B",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  walletStatusTextConnected: {
    color: "#14F195",
  },
  walletAddressRow: {
    alignItems: "center",
    borderColor: "rgba(148, 163, 184, 0.14)",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  walletLabel: {
    color: "rgba(148, 163, 184, 0.9)",
    fontSize: 13,
    fontWeight: "600",
  },
  walletAddress: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  walletError: {
    color: "#FB7185",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 10,
  },
  walletButton: {
    alignItems: "center",
    backgroundColor: "#9945FF",
    borderRadius: 12,
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    marginTop: 14,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  walletButtonSecondary: {
    backgroundColor: "rgba(153, 69, 255, 0.10)",
    borderColor: "rgba(153, 69, 255, 0.36)",
    borderWidth: 1,
  },
  walletButtonPressed: {
    opacity: 0.72,
  },
  walletButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  walletButtonTextSecondary: {
    color: "#CBB2FF",
  },
});
