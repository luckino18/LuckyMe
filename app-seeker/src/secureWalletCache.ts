import * as SecureStore from "expo-secure-store";
import { PublicKey } from "@solana/web3.js";

const WALLET_AUTH_KEY = "luckyme.seekerReferralTest.mwaAuthorization";

function reviveAccount(account: any) {
  if (!account) return account;
  const address = new PublicKey(account.address);
  return { ...account, address, publicKey: address };
}

export const secureWalletAuthorizationCache = {
  async clear() {
    await SecureStore.deleteItemAsync(WALLET_AUTH_KEY);
  },
  async get() {
    const stored = await SecureStore.getItemAsync(WALLET_AUTH_KEY);
    if (!stored) return undefined;
    try {
      const parsed = JSON.parse(stored);
      const accounts = Array.isArray(parsed.accounts) ? parsed.accounts.map(reviveAccount) : [];
      const selectedAddress = parsed.selectedAccount?.address;
      const selectedAccount = accounts.find((account: any) => account.address.toBase58() === selectedAddress) ??
        reviveAccount(parsed.selectedAccount);
      return { ...parsed, accounts, selectedAccount };
    } catch {
      await SecureStore.deleteItemAsync(WALLET_AUTH_KEY);
      return undefined;
    }
  },
  async set(value: any) {
    if (!value) {
      await SecureStore.deleteItemAsync(WALLET_AUTH_KEY);
      return;
    }
    const serializeAccount = (account: any) => ({
      ...account,
      address: account.address.toBase58(),
      publicKey: account.address.toBase58(),
    });
    await SecureStore.setItemAsync(WALLET_AUTH_KEY, JSON.stringify({
      ...value,
      accounts: value.accounts.map(serializeAccount),
      selectedAccount: serializeAccount(value.selectedAccount),
    }), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
};
