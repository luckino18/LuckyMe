import React, { useEffect, useState } from "react";
import { BackHandler, StatusBar, StyleSheet, View } from "react-native";

import { LuckyMeScreen } from "./LuckyMeScreen";
import { recordDappStoreActivation } from "./appActivationAnalytics";
import { PromotionsScreen } from "./PromotionsScreen";
import { CommunityScreen } from "./CommunityScreen";

export function LuckyMeApp({
  disablePayments = false,
  initialSeekerPassDrawVisible = false,
}: {
  disablePayments?: boolean;
  initialSeekerPassDrawVisible?: boolean;
} = {}) {
  const [seekerPassDrawVisible, setSeekerPassDrawVisible] = useState(initialSeekerPassDrawVisible);
  const [selectedPromotionId, setSelectedPromotionId] = useState<string | undefined>();
  const [communitySection, setCommunitySection] = useState<"missions" | "profile" | null>(null);

  useEffect(() => {
    recordDappStoreActivation().catch(() => undefined);
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (seekerPassDrawVisible) {
        setSeekerPassDrawVisible(false);
        return true;
      }
      if (communitySection) {
        setCommunitySection(null);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [communitySection, seekerPassDrawVisible]);

  return (
    <View style={styles.root}>
      <StatusBar hidden translucent backgroundColor="transparent" barStyle="light-content" />
      <LuckyMeScreen
        disablePayments={disablePayments}
        onOpenSeekerPassDraw={(promotionId) => {
          setSelectedPromotionId(promotionId);
          setSeekerPassDrawVisible(true);
        }}
        onOpenCommunity={setCommunitySection}
      />
      {seekerPassDrawVisible ? (
        <View style={styles.overlay}>
          <PromotionsScreen
            initialPromotionId={selectedPromotionId}
            onClose={() => {
              setSelectedPromotionId(undefined);
              setSeekerPassDrawVisible(false);
            }}
          />
        </View>
      ) : null}
      {communitySection ? (
        <View style={styles.overlay}>
          <CommunityScreen
            initialTab={communitySection}
            onClose={() => setCommunitySection(null)}
          />
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
