import React, { useEffect, useState } from "react";
import { Linking } from "react-native";

import { LuckyMeScreen } from "./LuckyMeScreen";
import { SeekerReferralScreen } from "./SeekerReferralScreen";

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

export function LuckyMeApp({ disablePayments = false }: { disablePayments?: boolean } = {}) {
  const [referralVisible, setReferralVisible] = useState(false);
  const [incomingReferralUrl, setIncomingReferralUrl] = useState<string | null>(null);

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

  if (referralVisible) {
    return (
      <SeekerReferralScreen
        incomingReferralUrl={incomingReferralUrl}
        onClose={() => setReferralVisible(false)}
      />
    );
  }

  return (
    <LuckyMeScreen
      disablePayments={disablePayments}
      onOpenReferral={() => setReferralVisible(true)}
    />
  );
}

export function LuckyMeReferralTestApp() {
  return <LuckyMeApp disablePayments />;
}
