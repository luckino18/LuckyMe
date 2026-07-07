import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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

import { STITCH_SCREENS } from "./stitchScreens";
import type { StitchScreenId } from "./stitchScreens";

type StitchMessage =
  | {
      screen?: StitchScreenId;
      type?: "navigate" | "refresh";
    }
  | undefined;

const INITIAL_SCREEN: StitchScreenId = "home";
const UNAVAILABLE_SCREEN: StitchScreenId = "unavailable";
const API_URL =
  process.env.EXPO_PUBLIC_LUCKYME_API_URL ?? "https://api.lucky-me.app";
const UI_PREVIEW_ENABLED = process.env.EXPO_PUBLIC_LUCKYME_UI_PREVIEW === "true";

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

function parseStitchMessage(data: string): StitchMessage {
  try {
    const message = JSON.parse(data) as StitchMessage;

    if (message?.type === "refresh") {
      return message;
    }

    if (message?.type === "navigate" && message.screen && message.screen in STITCH_SCREENS) {
      return message;
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

      function send(screen) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'navigate',
          screen: screen
        }));
      }

      function refresh() {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'refresh'
        }));
      }

      function textOf(element) {
        return (element.textContent || '').trim().toLowerCase();
      }

      function routeFor(element) {
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

        if (text.includes('complete') || text.includes('success')) {
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
  const wallet = useMobileWallet();
  const html = STITCH_SCREENS[screen];

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
    if (onchainAvailable || UNAVAILABLE_ALLOWED_SCREENS.has(nextScreen)) {
      setScreen(nextScreen);
    } else {
      setScreen(UNAVAILABLE_SCREEN);
    }
  }, [onchainAvailable]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    const message = parseStitchMessage(event.nativeEvent.data);

    if (message?.type === "refresh") {
      refreshFromBackend();
      return;
    }

    if (message?.screen) {
      navigateTo(message.screen);
    }
  }, [navigateTo, refreshFromBackend]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar backgroundColor="#000000" barStyle="light-content" translucent={false} />
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
            key={item}
            onPress={() => navigateTo(item)}
            style={styles.nativeNavItem}
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
          <Text style={styles.walletTitle}>{address ? "Wallet connected" : "Test wallet connection"}</Text>
        </View>
        <View style={[styles.walletStatusPill, address ? styles.walletStatusPillConnected : null]}>
          <Text style={styles.walletStatusText}>{address ? "READY" : "NEEDED"}</Text>
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
        {pending ? <ActivityIndicator color={address ? "#d8b9ff" : "#240052"} /> : null}
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
    backgroundColor: "#000000",
    flex: 1,
    paddingTop: StatusBar.currentHeight ?? 0,
  },
  webView: {
    backgroundColor: "#000000",
    flex: 1,
  },
  walletPanel: {
    backgroundColor: "rgba(12, 15, 16, 0.94)",
    borderColor: "rgba(255, 255, 255, 0.14)",
    borderRadius: 8,
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
  walletPanelHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  walletKicker: {
    color: "rgba(206, 194, 216, 0.64)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  walletTitle: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 25,
    marginTop: 4,
  },
  walletStatusPill: {
    borderColor: "rgba(251, 191, 36, 0.28)",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  walletStatusPillConnected: {
    borderColor: "rgba(86, 255, 168, 0.32)",
  },
  walletStatusText: {
    color: "#d8b9ff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  walletAddressRow: {
    alignItems: "center",
    borderColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  walletLabel: {
    color: "rgba(206, 194, 216, 0.62)",
    fontSize: 13,
    fontWeight: "600",
  },
  walletAddress: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  walletError: {
    color: "#ffb4ab",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 10,
  },
  walletButton: {
    alignItems: "center",
    backgroundColor: "#d8b9ff",
    borderRadius: 8,
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    marginTop: 14,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  walletButtonSecondary: {
    backgroundColor: "rgba(216, 185, 255, 0.08)",
    borderColor: "rgba(216, 185, 255, 0.18)",
    borderWidth: 1,
  },
  walletButtonPressed: {
    opacity: 0.72,
  },
  walletButtonText: {
    color: "#240052",
    fontSize: 16,
    fontWeight: "800",
  },
  walletButtonTextSecondary: {
    color: "#d8b9ff",
  },
});
