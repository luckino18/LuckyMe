import assert from "node:assert/strict";
import test from "node:test";
import {
  SOLANA_MAINNET_CHAIN,
  SOLANA_SIGN_AND_SEND_TRANSACTION,
  SOLANA_SIGN_TRANSACTION,
  base58Encode,
  compatibleWalletStandardOptions,
  connectWalletStandardOption,
  createWalletStandardRegistry,
  isCompatibleInjectedProvider,
  isCompatibleWalletStandardWallet,
  mergeCompatibleWalletOptions,
  selectSolanaMainnetAccount,
} from "../site/lucky-me.app/wallet-standard.js";

function account(overrides = {}) {
  return {
    address: "11111111111111111111111111111111",
    publicKey: new Uint8Array(32),
    chains: [SOLANA_MAINNET_CHAIN],
    features: [SOLANA_SIGN_TRANSACTION],
    ...overrides,
  };
}

function standardWallet(name = "Test Wallet", overrides = {}) {
  const accounts = overrides.accounts ?? [account()];
  return {
    version: "1.0.0",
    name,
    icon: "data:image/png;base64,AA==",
    chains: [SOLANA_MAINNET_CHAIN],
    accounts,
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => ({ accounts }),
      },
      [SOLANA_SIGN_TRANSACTION]: {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy"],
        signTransaction: async () => [],
      },
    },
    ...overrides,
  };
}

function dispatchWithDetail(target, type, detail) {
  const event = new Event(type);
  Object.defineProperty(event, "detail", { value: detail });
  target.dispatchEvent(event);
}

test("Wallet Standard registry discovers wallets loaded before and after the app", () => {
  const target = new EventTarget();
  target.Event = Event;
  const early = standardWallet("Early Wallet");
  const late = standardWallet("Late Wallet");
  target.addEventListener("wallet-standard:app-ready", (event) => {
    event.detail.register(early);
  });

  const registry = createWalletStandardRegistry(target);
  assert.deepEqual(registry.get(), [early]);

  const registrations = [];
  registry.on("register", (...wallets) => registrations.push(...wallets));
  let unregisterLate;
  dispatchWithDetail(target, "wallet-standard:register-wallet", ({ register }) => {
    unregisterLate = register(late);
  });

  assert.deepEqual(registry.get(), [early, late]);
  assert.deepEqual(registrations, [late]);
  unregisterLate();
  assert.deepEqual(registry.get(), [early]);
});

test("only mainnet Wallet Standard wallets with connect and legacy signing are compatible", () => {
  const compatible = standardWallet();
  const wrongChain = standardWallet("Devnet", { chains: ["solana:devnet"] });
  const noConnect = standardWallet("No Connect", { features: {} });
  const noLegacy = standardWallet("Versioned Only", {
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [] }) },
      [SOLANA_SIGN_TRANSACTION]: {
        version: "1.0.0",
        supportedTransactionVersions: [0],
        signTransaction: async () => [],
      },
    },
  });

  assert.equal(isCompatibleWalletStandardWallet(compatible), true);
  assert.equal(isCompatibleWalletStandardWallet(wrongChain), false);
  assert.equal(isCompatibleWalletStandardWallet(noConnect), false);
  assert.equal(isCompatibleWalletStandardWallet(noLegacy), false);
  assert.deepEqual(
    compatibleWalletStandardOptions([wrongChain, compatible, compatible, noLegacy]).map(({ name }) => name),
    ["Test Wallet"],
  );
});

test("mainnet account selection requires a transaction feature shared with the wallet", () => {
  const wallet = standardWallet("Signer", {
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [] }) },
      [SOLANA_SIGN_AND_SEND_TRANSACTION]: {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy"],
        signAndSendTransaction: async () => [],
      },
    },
  });
  const devnet = account({ chains: ["solana:devnet"], features: [SOLANA_SIGN_AND_SEND_TRANSACTION] });
  const wrongFeature = account({ features: [SOLANA_SIGN_TRANSACTION] });
  const expected = account({ features: [SOLANA_SIGN_AND_SEND_TRANSACTION] });

  assert.equal(selectSolanaMainnetAccount([devnet, wrongFeature, expected], wallet), expected);
  assert.equal(selectSolanaMainnetAccount([devnet, wrongFeature], wallet), null);
});

test("legacy injected fallbacks must expose connect and a signing method", () => {
  assert.equal(isCompatibleInjectedProvider({ connect() {}, signTransaction() {} }), true);
  assert.equal(isCompatibleInjectedProvider({ connect() {}, signAndSendTransaction() {} }), true);
  assert.equal(isCompatibleInjectedProvider({ connect() {} }), false);
  assert.equal(isCompatibleInjectedProvider({ signTransaction() {} }), false);
});

test("Wallet Standard entries win deduplication over injected aliases", () => {
  const standard = compatibleWalletStandardOptions([standardWallet("Phantom")]);
  const injected = {
    id: "phantom",
    name: "Phantom",
    provider: { connect() {}, signTransaction() {} },
  };
  const unique = {
    id: "backpack",
    name: "Backpack",
    provider: { connect() {}, signAndSendTransaction() {} },
  };
  const readOnly = {
    id: "fake",
    name: "Fake Wallet",
    provider: { connect() {} },
  };

  assert.deepEqual(
    mergeCompatibleWalletOptions(standard, [injected, unique, readOnly]).map(({ name, type }) => [name, type]),
    [["Phantom", "standard"], ["Backpack", "injected"]],
  );
});

test("Wallet Standard raw signatures are encoded as Solana base58 strings", () => {
  assert.equal(base58Encode(new Uint8Array()), "");
  assert.equal(base58Encode(new Uint8Array([0, 0])), "11");
  assert.equal(base58Encode(new TextEncoder().encode("Hello World")), "JxF12TrwUP45BMd");
});

test("detected Wallet Standard wallet connects directly without WalletConnect", async () => {
  let connectCalls = 0;
  const expectedAccount = account();
  const wallet = standardWallet("Direct Wallet", {
    accounts: [],
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async ({ silent }) => {
          connectCalls += 1;
          assert.equal(silent, false);
          return { accounts: [expectedAccount] };
        },
      },
      [SOLANA_SIGN_TRANSACTION]: {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy"],
        signTransaction: async () => [],
      },
    },
  });
  const [option] = compatibleWalletStandardOptions([wallet]);

  const connected = await connectWalletStandardOption(option);
  assert.equal(connectCalls, 1);
  assert.equal(connected.standardWallet, wallet);
  assert.equal(connected.account, expectedAccount);
});
