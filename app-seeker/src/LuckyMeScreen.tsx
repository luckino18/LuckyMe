import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
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

import { renderStitchScreen, stitchDefaultTab, STITCH_SCREENS } from "./stitchScreens";
import type { StitchScreenId, WinnerShareData } from "./stitchScreens";

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
  | { type: "navigate"; screen: StitchScreenId }
  | { type: "refresh" }
  | { type: "link"; link: LegalLinkKey }
  | { type: "external"; url: string }
  | undefined;

const INITIAL_SCREEN: StitchScreenId = "home";
const UNAVAILABLE_SCREEN: StitchScreenId = "unavailable";
const WINNER_SCREEN: StitchScreenId = "winner";
const API_URL =
  process.env.EXPO_PUBLIC_LUCKYME_API_URL ?? "https://api.lucky-me.app";
const UI_PREVIEW_ENABLED = process.env.EXPO_PUBLIC_LUCKYME_UI_PREVIEW === "true";
const NOTIFICATION_PROMPT_KEY = "luckyme.notifications.prompt.v2";
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
  links: "links",
  pools: "pools",
  settings: "links",
  wallet: "wallet",
};
const UNAVAILABLE_ALLOWED_SCREENS = new Set<StitchScreenId>([
  "links",
  "wallet",
  "winner",
]);
const NAV_ITEMS: StitchScreenId[] = ["home", "pools", "activity", "wallet", "links"];
const NAV_TABS = new Set<StitchScreenId>(NAV_ITEMS);

function isLegalLinkKey(value: unknown): value is LegalLinkKey {
  return value === "terms" || value === "privacy" || value === "support";
}

function parseStitchMessage(data: string): StitchMessage {
  try {
    const message = JSON.parse(data) as {
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

    if (message?.type === "navigate" && message.screen && message.screen in STITCH_SCREENS) {
      return { type: "navigate", screen: message.screen };
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
            return canNavigateOnchainScreens || route === 'links' || route === 'wallet' ? route : null;
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
          const route = routeFor(element);
          if (!route) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          send(route);
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

async function registerExpoPushToken(token: string) {
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
  | { screen: StitchScreenId; winner?: WinnerShareData }
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
      return { screen: "pools" };
    }

    if (
      screenName === "home" ||
      screenName === "activity" ||
      screenName === "wallet" ||
      screenName === "links" ||
      screenName === "settings"
    ) {
      return { screen: screenName === "settings" ? "links" : screenName };
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
  const wallet = useMobileWallet();

  const html = useMemo(
    () =>
      renderStitchScreen(screen, {
        onchainAvailable,
        activeTab: screen === UNAVAILABLE_SCREEN ? requestedTab : undefined,
        winner: winnerShare,
      }),
    [onchainAvailable, requestedTab, screen, winnerShare],
  );

  const activeTab =
    screen === UNAVAILABLE_SCREEN ? requestedTab : stitchDefaultTab(screen);

  const injectedJavaScript = useMemo(
    () => injectedNavigation(screen, onchainAvailable),
    [onchainAvailable, screen],
  );

  const refreshFromBackend = useCallback(() => {
    let active = true;

    loadInitialScreen()
      .then((next) => {
        if (active) {
          setOnchainAvailable(next.onchainAvailable);
          setScreen(next.screen);
        }
      })
      .catch(() => {
        if (active) {
          setOnchainAvailable(UI_PREVIEW_ENABLED);
          setScreen(UI_PREVIEW_ENABLED ? INITIAL_SCREEN : UNAVAILABLE_SCREEN);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => refreshFromBackend(), [refreshFromBackend]);

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
            await registerExpoPushToken(token);
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
  }, []);

  const navigateTo = useCallback((nextScreen: StitchScreenId) => {
    if (NAV_TABS.has(nextScreen)) {
      setRequestedTab(nextScreen);
    }

    if (onchainAvailable || UNAVAILABLE_ALLOWED_SCREENS.has(nextScreen)) {
      setScreen(nextScreen);
    } else {
      setScreen(UNAVAILABLE_SCREEN);
    }
  }, [onchainAvailable]);

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

    navigateTo(route.screen);
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

  const enableNotifications = useCallback(async () => {
    setNotificationBusy(true);
    setNotificationError(null);

    try {
      await configureNotificationChannel();
      const currentPermissions = await Notifications.getPermissionsAsync();

      if (currentPermissions.status === "denied" && !currentPermissions.granted) {
        setNotificationOptInState("denied");
        setNotificationPromptVisible(true);
        setNotificationError("Android has notifications blocked for LuckyMe. Enable them from App Info > Notifications, then reopen LuckyMe.");
        await Linking.openSettings();
        return;
      }

      const permissions = await Notifications.requestPermissionsAsync();

      if (!permissions.granted) {
        setNotificationOptInState("denied");
        setNotificationError("Android has notifications blocked for LuckyMe. Open App Info > Notifications to allow round alerts, or choose Not now.");
        setNotificationPromptVisible(true);
        return;
      }

      setNotificationOptInState("enabled");
      setNotificationPromptVisible(false);
      await AsyncStorage.setItem(NOTIFICATION_PROMPT_KEY, "accepted");

      try {
        const token = await getExpoPushToken();
        await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
        await registerExpoPushToken(token);
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
  }, []);

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

    if (message?.type === "link") {
      openLegalLink(message.link);
      return;
    }

    if (message?.type === "external" && message.url.startsWith("https://")) {
      Linking.openURL(message.url).catch(() => {});
      return;
    }

    if (message?.type === "navigate") {
      navigateTo(message.screen);
    }
  }, [navigateTo, openLegalLink, refreshFromBackend]);

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
            <Text style={styles.notificationError}>Notifications are blocked by Android for this app. Enable them in App Info to receive round alerts.</Text>
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
                {state === "denied" ? "Open Android permissions" : "Enable alerts"}
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
