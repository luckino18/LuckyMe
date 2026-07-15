import { MobileWalletProvider } from "@wallet-ui/react-native-web3js";
import Constants from "expo-constants";
import type {
  AppIdentity,
  Chain,
} from "@solana-mobile/mobile-wallet-adapter-protocol";

import { LuckyMeApp } from "./src/LuckyMeReferralTestApp";
import { secureWalletAuthorizationCache } from "./src/secureWalletCache";

const appExtra = Constants.expoConfig?.extra ?? {};
const isReferralTestBuild = appExtra.referralTestBuild === true;
const walletChain = (appExtra.referralWalletChain ?? "solana:mainnet") as Chain;
const walletEndpoint = String(
  appExtra.referralWalletRpcUrl ?? "https://api.mainnet-beta.solana.com",
);
const identity: AppIdentity = {
  name: isReferralTestBuild ? "LuckyMe Seeker Referral Test" : "LuckyMe",
  uri: isReferralTestBuild ? "https://www.lucky-me.app" : "https://lucky-me.app",
};

export default function App() {
  return (
    <MobileWalletProvider
      chain={walletChain}
      endpoint={walletEndpoint}
      identity={identity}
      cache={secureWalletAuthorizationCache}
    >
      <LuckyMeApp disablePayments={isReferralTestBuild} />
    </MobileWalletProvider>
  );
}
