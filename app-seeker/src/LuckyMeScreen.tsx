import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";
import { useMobileWallet } from "@wallet-ui/react-native-web3js";

import { renderStitchScreen, stitchDefaultTab, STITCH_SCREENS } from "./stitchScreens";
import type { StitchScreenId } from "./stitchScreens";

type LegalLinkKey = "terms" | "privacy" | "support";

type StitchMessage =
  | { type: "navigate"; screen: StitchScreenId }
  | { type: "refresh" }
  | { type: "link"; link: LegalLinkKey }
  | undefined;

const INITIAL_SCREEN: StitchScreenId = "home";
const UNAVAILABLE_SCREEN: StitchScreenId = "unavailable";
const API_URL =
  process.env.EXPO_PUBLIC_LUCKYME_API_URL ?? "https://api.lucky-me.app";
const UI_PREVIEW_ENABLED = process.env.EXPO_PUBLIC_LUCKYME_UI_PREVIEW === "true";

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
  pools: "pools",
  settings: "settings",
  wallet: "wallet",
};
const UNAVAILABLE_ALLOWED_SCREENS = new Set<StitchScreenId>([
  "settings",
  "wallet",
]);
const NAV_ITEMS: StitchScreenId[] = ["home", "pools", "activity", "wallet", "settings"];
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
    };

    if (message?.type === "refresh") {
      return { type: "refresh" };
    }

    if (message?.type === "link" && isLegalLinkKey(message.link)) {
      return { type: "link", link: message.link };
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

        if (dataRoute) {
          // The native wrapper applies availability gating authoritatively.
          return dataRoute;
        }

        // Fallback: legacy text matching for controls without metadata.
        const text = textOf(element);

        for (const label in labels) {
          if (text === label || text.endsWith(label)) {
            const route = labels[label];
            return canNavigateOnchainScreens || route === 'settings' || route === 'wallet' ? route : null;
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

export function LuckyMeScreen() {
  const [onchainAvailable, setOnchainAvailable] = useState(false);
  const [screen, setScreen] = useState<StitchScreenId>(UNAVAILABLE_SCREEN);
  const [requestedTab, setRequestedTab] = useState<StitchScreenId>(INITIAL_SCREEN);
  const wallet = useMobileWallet();

  const html = useMemo(
    () =>
      renderStitchScreen(screen, {
        onchainAvailable,
        activeTab: screen === UNAVAILABLE_SCREEN ? requestedTab : undefined,
      }),
    [onchainAvailable, requestedTab, screen],
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
      {screen === "wallet" ? <WalletPreflightPanel wallet={wallet} /> : null}
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
    </SafeAreaView>
  );
}

type WalletPreflightPanelProps = {
  wallet: ReturnType<typeof useMobileWallet>;
};

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
