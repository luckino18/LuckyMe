import React, { useCallback, useEffect, useMemo, useState } from "react";
import { SafeAreaView, StatusBar, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";

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

const SCREEN_BY_LABEL: Record<string, StitchScreenId> = {
  activity: "activity",
  home: "home",
  pools: "pools",
  settings: "settings",
  wallet: "wallet",
};

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

function injectedNavigation(screen: StitchScreenId) {
  const labels = JSON.stringify(SCREEN_BY_LABEL);
  const currentScreen = JSON.stringify(screen);

  return `
    (function () {
      const labels = ${labels};
      const currentScreen = ${currentScreen};

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
            return labels[label];
          }
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

async function loadInitialScreen() {
  const response = await fetch(`${API_URL}/config`, {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    return UNAVAILABLE_SCREEN;
  }

  const config = (await response.json()) as BackendConfig;
  const onchainAvailable =
    config.onchainAvailable === true || config.onchain?.available === true;

  return onchainAvailable ? INITIAL_SCREEN : UNAVAILABLE_SCREEN;
}

export function LuckyMeScreen() {
  const [screen, setScreen] = useState<StitchScreenId>(UNAVAILABLE_SCREEN);
  const html = STITCH_SCREENS[screen];

  const injectedJavaScript = useMemo(() => injectedNavigation(screen), [screen]);

  const refreshFromBackend = useCallback(() => {
    let active = true;

    loadInitialScreen()
      .then((nextScreen) => {
        if (active) {
          setScreen(nextScreen);
        }
      })
      .catch(() => {
        if (active) {
          setScreen(UNAVAILABLE_SCREEN);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => refreshFromBackend(), [refreshFromBackend]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    const message = parseStitchMessage(event.nativeEvent.data);

    if (message?.type === "refresh") {
      refreshFromBackend();
      return;
    }

    if (message?.screen) {
      setScreen(message.screen);
    }
  }, [refreshFromBackend]);

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
    </SafeAreaView>
  );
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
});
