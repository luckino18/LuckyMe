import React, { useEffect, useState } from "react";
import { BackHandler, Linking, StatusBar, StyleSheet, View } from "react-native";

import { LuckyMeScreen } from "./LuckyMeScreen";
import { SeekerReferralScreen } from "./SeekerReferralScreen";
import { recordDappStoreActivation } from "./appActivationAnalytics";
import { SeekerPassDrawScreen } from "./SeekerPassDrawScreen";
import Constants from "expo-constants";

function isReferralUrl(value: string | null) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "luckyme:" ||
      url.protocol === "luckyme-seeker-referral-test:" ||
      (url.protocol === "https:" &&
        url.hostname === "www.lucky-me.app" &&
        (url.pathname.startsWith("/referral/") || url.pathname.startsWith("/referral-test/")));
  } catch {
    return false;
  }
}

export function LuckyMeApp({
  disablePayments = false,
  initialSeekerPassDrawVisible = false,
}: {
  disablePayments?: boolean;
  initialSeekerPassDrawVisible?: boolean;
} = {}) {
  const [referralVisible, setReferralVisible] = useState(false);
  const [incomingReferralUrl, setIncomingReferralUrl] = useState<string | null>(null);
  const [seekerPassDrawVisible, setSeekerPassDrawVisible] = useState(initialSeekerPassDrawVisible);
  const seekerPassPromotionEnabled = Constants.expoConfig?.extra?.seekerPassPromotionEnabled === true;

  useEffect(() => {
    recordDappStoreActivation().catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    Linking.getInitialURL().then((url) => {
      if (active && isReferralUrl(url)) {
        setIncomingReferralUrl(url);
        setReferralVisible(true);
      }
    }).catch(() => undefined);
    const subscription = Linking.addEventListener("url", ({ url }) => {
      if (isReferralUrl(url)) {
        setIncomingReferralUrl(url);
        setReferralVisible(true);
      }
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (seekerPassDrawVisible) {
        setSeekerPassDrawVisible(false);
        return true;
      }
      if (referralVisible) {
        setReferralVisible(false);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [referralVisible, seekerPassDrawVisible]);

  return (
    <View style={styles.root}>
      <StatusBar hidden translucent backgroundColor="transparent" barStyle="light-content" />
      <LuckyMeScreen
        disablePayments={disablePayments}
        onOpenReferral={() => setReferralVisible(true)}
        onOpenSeekerPassDraw={seekerPassPromotionEnabled ? () => setSeekerPassDrawVisible(true) : undefined}
      />
      {referralVisible ? (
        <View style={styles.overlay}>
      <SeekerReferralScreen
        incomingReferralUrl={incomingReferralUrl}
        onClose={() => setReferralVisible(false)}
      />
        </View>
      ) : null}
      {seekerPassDrawVisible && seekerPassPromotionEnabled ? (
        <View style={styles.overlay}>
          <SeekerPassDrawScreen onClose={() => setSeekerPassDrawVisible(false)} />
        </View>
      ) : null}
    </View>
  );
}

export function LuckyMeReferralTestApp() {
  return <LuckyMeApp disablePayments />;
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: "#00251B",
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#00251B",
    zIndex: 10,
  },
});
