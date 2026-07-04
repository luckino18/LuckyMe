import { MobileWalletProvider } from "@wallet-ui/react-native-web3js";
import type {
  AppIdentity,
  Chain,
} from "@solana-mobile/mobile-wallet-adapter-protocol";

import { LuckyMeScreen } from "./src/LuckyMeScreen";

declare const process:
  | {
      env?: {
        EXPO_PUBLIC_LUCKYME_WALLET_CHAIN?: string;
        EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL?: string;
      };
    }
  | undefined;

const walletChain = (process?.env?.EXPO_PUBLIC_LUCKYME_WALLET_CHAIN ??
  "solana:mainnet") as Chain;
const walletEndpoint =
  process?.env?.EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL ??
  "https://api.mainnet-beta.solana.com";
const identity: AppIdentity = {
  name: "LuckyMe",
  uri: "https://github.com/luckino18/LuckyMe",
};

export default function App() {
  return (
    <MobileWalletProvider
      chain={walletChain}
      endpoint={walletEndpoint}
      identity={identity}
    >
      <LuckyMeScreen />
    </MobileWalletProvider>
  );
}
