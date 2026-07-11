export const SOLANA_MAINNET_CHAIN = "solana:mainnet";
export const STANDARD_CONNECT = "standard:connect";
export const STANDARD_DISCONNECT = "standard:disconnect";
export const STANDARD_EVENTS = "standard:events";
export const SOLANA_SIGN_TRANSACTION = "solana:signTransaction";
export const SOLANA_SIGN_AND_SEND_TRANSACTION = "solana:signAndSendTransaction";

export function base58Encode(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const input = new Uint8Array(bytes || []);
  if (!input.length) {
    return "";
  }
  const digits = [0];
  for (const byte of input) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let encoded = "";
  for (let index = 0; index < input.length - 1 && input[index] === 0; index += 1) {
    encoded += "1";
  }
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    encoded += alphabet[digits[index]];
  }
  return encoded;
}

function guard(callback) {
  try {
    callback();
  } catch (error) {
    console.error(error);
  }
}

function dispatchWalletStandardEvent(targetWindow, type, detail) {
  const EventConstructor = targetWindow?.Event || globalThis.Event;
  const event = new EventConstructor(type, {
    bubbles: false,
    cancelable: false,
    composed: false,
  });
  Object.defineProperty(event, "detail", {
    configurable: false,
    enumerable: true,
    value: detail,
  });
  targetWindow.dispatchEvent(event);
}

export function createWalletStandardRegistry(targetWindow = globalThis.window) {
  const registered = new Set();
  const listeners = {
    register: new Set(),
    unregister: new Set(),
  };
  let cachedWallets;

  const emit = (event, wallets) => {
    for (const listener of listeners[event]) {
      guard(() => listener(...wallets));
    }
  };

  const register = (...wallets) => {
    const fresh = wallets.filter((wallet) => wallet && !registered.has(wallet));
    if (!fresh.length) {
      return () => {};
    }

    fresh.forEach((wallet) => registered.add(wallet));
    cachedWallets = undefined;
    emit("register", fresh);

    return () => {
      const removed = fresh.filter((wallet) => registered.delete(wallet));
      if (!removed.length) {
        return;
      }
      cachedWallets = undefined;
      emit("unregister", removed);
    };
  };

  const registry = Object.freeze({
    get() {
      cachedWallets ||= Object.freeze([...registered]);
      return cachedWallets;
    },
    on(event, listener) {
      if (!listeners[event] || typeof listener !== "function") {
        throw new TypeError(`Unsupported Wallet Standard event: ${event}`);
      }
      listeners[event].add(listener);
      return () => listeners[event].delete(listener);
    },
    register,
  });

  if (!targetWindow?.addEventListener || !targetWindow?.dispatchEvent) {
    return registry;
  }

  const registrationApi = Object.freeze({ register });
  targetWindow.addEventListener("wallet-standard:register-wallet", (event) => {
    if (typeof event?.detail === "function") {
      guard(() => event.detail(registrationApi));
    }
  });
  dispatchWalletStandardEvent(targetWindow, "wallet-standard:app-ready", registrationApi);

  return registry;
}

function isLegacyTransactionSupported(feature) {
  return Array.isArray(feature?.supportedTransactionVersions)
    && feature.supportedTransactionVersions.includes("legacy");
}

export function walletSigningFeatureNames(wallet) {
  const features = wallet?.features || {};
  const supported = [];
  const signAndSend = features[SOLANA_SIGN_AND_SEND_TRANSACTION];
  const sign = features[SOLANA_SIGN_TRANSACTION];

  if (typeof signAndSend?.signAndSendTransaction === "function" && isLegacyTransactionSupported(signAndSend)) {
    supported.push(SOLANA_SIGN_AND_SEND_TRANSACTION);
  }
  if (typeof sign?.signTransaction === "function" && isLegacyTransactionSupported(sign)) {
    supported.push(SOLANA_SIGN_TRANSACTION);
  }
  return supported;
}

export function isCompatibleWalletStandardWallet(wallet) {
  return Boolean(
    wallet
      && wallet.version === "1.0.0"
      && typeof wallet.name === "string"
      && wallet.name.trim()
      && Array.isArray(wallet.chains)
      && wallet.chains.includes(SOLANA_MAINNET_CHAIN)
      && typeof wallet.features?.[STANDARD_CONNECT]?.connect === "function"
      && walletSigningFeatureNames(wallet).length,
  );
}

export function selectSolanaMainnetAccount(accounts, wallet) {
  const signingFeatures = walletSigningFeatureNames(wallet);
  return (Array.isArray(accounts) ? accounts : []).find((account) => {
    if (!account || typeof account.address !== "string" || !account.address.trim()) {
      return false;
    }
    if (!Array.isArray(account.chains) || !account.chains.includes(SOLANA_MAINNET_CHAIN)) {
      return false;
    }
    return Array.isArray(account.features)
      && signingFeatures.some((feature) => account.features.includes(feature));
  }) || null;
}

function normalizedWalletName(name) {
  return String(name || "wallet")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ");
}

function walletId(prefix, name) {
  const slug = normalizedWalletName(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "wallet";
  return `${prefix}:${slug}`;
}

export function compatibleWalletStandardOptions(wallets) {
  const seenObjects = new Set();
  const seenNames = new Set();
  const options = [];

  for (const wallet of Array.isArray(wallets) ? wallets : []) {
    const nameKey = normalizedWalletName(wallet?.name);
    if (!isCompatibleWalletStandardWallet(wallet) || seenObjects.has(wallet) || seenNames.has(nameKey)) {
      continue;
    }
    seenObjects.add(wallet);
    seenNames.add(nameKey);
    options.push({
      id: walletId("standard", wallet.name),
      name: wallet.name.trim(),
      icon: wallet.icon,
      type: "standard",
      standardWallet: wallet,
    });
  }

  return options;
}

export function isCompatibleInjectedProvider(provider) {
  return Boolean(
    provider
      && typeof provider.connect === "function"
      && (
        typeof provider.signTransaction === "function"
        || typeof provider.signAndSendTransaction === "function"
      ),
  );
}

export function mergeCompatibleWalletOptions(standardOptions, injectedCandidates) {
  const result = [];
  const seenObjects = new Set();
  const seenNames = new Set();

  for (const option of Array.isArray(standardOptions) ? standardOptions : []) {
    const walletObject = option.standardWallet;
    const nameKey = normalizedWalletName(option.name);
    if (!walletObject || seenObjects.has(walletObject) || seenNames.has(nameKey)) {
      continue;
    }
    seenObjects.add(walletObject);
    seenNames.add(nameKey);
    result.push(option);
  }

  for (const candidate of Array.isArray(injectedCandidates) ? injectedCandidates : []) {
    const provider = candidate?.provider;
    const name = String(candidate?.name || "Solana wallet").trim();
    const nameKey = normalizedWalletName(name);
    if (!isCompatibleInjectedProvider(provider) || seenObjects.has(provider) || seenNames.has(nameKey)) {
      continue;
    }
    seenObjects.add(provider);
    seenNames.add(nameKey);
    result.push({
      id: walletId("injected", candidate.id || name),
      name,
      icon: candidate.icon,
      provider,
      type: "injected",
    });
  }

  return result;
}
