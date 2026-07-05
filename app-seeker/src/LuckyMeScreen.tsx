import React, { useCallback, useMemo, useState } from "react";
import { SafeAreaView, StatusBar, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";

import { STITCH_SCREENS } from "./stitchScreens";
import type { StitchScreenId } from "./stitchScreens";

type StitchMessage =
  | {
      screen?: StitchScreenId;
      type?: "navigate";
    }
  | undefined;

const INITIAL_SCREEN: StitchScreenId = "home";

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

    if (
      message?.type === "navigate" &&
      message.screen &&
      message.screen in STITCH_SCREENS
    ) {
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

export function LuckyMeScreen() {
  const [screen, setScreen] = useState<StitchScreenId>(INITIAL_SCREEN);
  const html = STITCH_SCREENS[screen];

  const injectedJavaScript = useMemo(() => injectedNavigation(screen), [screen]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    const message = parseStitchMessage(event.nativeEvent.data);

    if (message?.screen) {
      setScreen(message.screen);
    }
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
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
          baseUrl: "https://stitch.withgoogle.com/",
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
  },
  webView: {
    backgroundColor: "#000000",
    flex: 1,
  },
});
