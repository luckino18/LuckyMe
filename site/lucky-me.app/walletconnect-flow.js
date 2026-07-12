export const WALLETCONNECT_TIMEOUTS = Object.freeze({
  loadMs: 8_000,
  initMs: 10_000,
  uriMs: 12_000,
});

export class WalletConnectFlowError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "WalletConnectFlowError";
    this.code = code;
  }
}

function flowError(error, code, message) {
  if (error instanceof WalletConnectFlowError) {
    return error;
  }
  return new WalletConnectFlowError(code, message, { cause: error });
}

function phasePromise(promise, {
  timeoutMs,
  timeoutCode,
  timeoutMessage,
  failureCode,
  failureMessage,
}) {
  const source = Promise.resolve(promise);
  source.catch(() => {});

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new WalletConnectFlowError(timeoutCode, timeoutMessage));
    }, timeoutMs);

    source.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(flowError(error, failureCode, failureMessage));
      },
    );
  });
}

function removeProviderListener(provider, event, listener) {
  try {
    if (typeof provider?.off === "function") {
      provider.off(event, listener);
    } else if (typeof provider?.removeListener === "function") {
      provider.removeListener(event, listener);
    }
  } catch {
    // A partially initialized provider must not block cleanup.
  }
}

export function createWalletConnectFlow({
  loadDependencies,
  initializeProvider,
  createModal = () => null,
  connectOptions,
  onStatus = () => {},
  onUri = () => {},
  timeouts = {},
}) {
  if (typeof loadDependencies !== "function" || typeof initializeProvider !== "function") {
    throw new TypeError("WalletConnect flow requires dependency loader and provider initializer");
  }

  const limits = { ...WALLETCONNECT_TIMEOUTS, ...timeouts };
  let current = null;
  let sequence = 0;

  const isCurrent = (operation) => current === operation && !operation.cancelled;

  function emit(operation, phase, message, extra = {}) {
    if (!isCurrent(operation)) {
      return;
    }
    onStatus({ phase, message, busy: !["connected", "error", "cancelled"].includes(phase), ...extra });
  }

  async function cleanup(operation, { disconnect = true } = {}) {
    if (operation.cleaned) {
      return;
    }
    operation.cleaned = true;
    removeProviderListener(operation.provider, "display_uri", operation.onDisplayUri);
    try {
      operation.modal?.closeModal?.();
    } catch {
      // The local QR remains the fallback if the external modal cannot close.
    }
    if (disconnect && operation.provider) {
      try {
        const result = operation.provider.disconnect?.();
        Promise.resolve(result).catch(() => {});
      } catch {
        // A provider without a completed session may reject disconnect.
      }
    }
  }

  function start() {
    if (current) {
      return current.promise;
    }

    const operation = {
      id: ++sequence,
      cancelled: false,
      cleaned: false,
      provider: null,
      modal: null,
      onDisplayUri: null,
      cancelReject: null,
      uriResolve: null,
      promise: null,
    };
    operation.cancelPromise = new Promise((_, reject) => {
      operation.cancelReject = reject;
    });
    operation.cancelPromise.catch(() => {});
    current = operation;

    operation.promise = (async () => {
      try {
        emit(operation, "loading", "Loading secure WalletConnect components…");
        const dependencies = await Promise.race([
          phasePromise(loadDependencies(operation.id), {
            timeoutMs: limits.loadMs,
            timeoutCode: "load_timeout",
            timeoutMessage: "WalletConnect components took too long to load. Check privacy shields or content blockers, then try again.",
            failureCode: "load_failed",
            failureMessage: "WalletConnect components could not be loaded. Check your connection or content blocker, then try again.",
          }),
          operation.cancelPromise,
        ]);

        emit(operation, "initializing", "Initializing WalletConnect securely…");
        operation.provider = await Promise.race([
          phasePromise(initializeProvider(dependencies), {
            timeoutMs: limits.initMs,
            timeoutCode: "init_timeout",
            timeoutMessage: "WalletConnect could not initialize in time. Please cancel and try again.",
            failureCode: "init_failed",
            failureMessage: "WalletConnect could not initialize. Please try again.",
          }),
          operation.cancelPromise,
        ]);

        try {
          operation.modal = createModal(dependencies);
        } catch {
          operation.modal = null;
        }

        const uriPromise = new Promise((resolve) => {
          operation.uriResolve = resolve;
        });
        operation.onDisplayUri = (uri) => {
          if (!isCurrent(operation) || typeof uri !== "string" || !uri.startsWith("wc:") || uri.length > 4_096) {
            return;
          }
          onUri({ uri, dependencies });
          emit(operation, "awaiting_approval", "WalletConnect is ready. Scan the QR code or copy the session URI, then approve in your wallet.");
          try {
            operation.modal?.openModal?.({ uri });
          } catch {
            // The same-site QR remains visible when the optional modal fails.
          }
          operation.uriResolve?.();
        };
        operation.provider.on?.("display_uri", operation.onDisplayUri);

        emit(operation, "pairing", "Waiting for a WalletConnect pairing code…");
        const connectPromise = Promise.resolve().then(() => (
          operation.provider.session || operation.provider.connect(connectOptions)
        ));
        connectPromise.catch(() => {});

        let session = operation.provider.session || null;
        if (!session) {
          const firstResult = await Promise.race([
            connectPromise.then((connectedSession) => ({ type: "session", session: connectedSession })),
            phasePromise(uriPromise, {
              timeoutMs: limits.uriMs,
              timeoutCode: "uri_timeout",
              timeoutMessage: "WalletConnect did not produce a QR code in time. Check privacy shields or relay access, then try again.",
              failureCode: "uri_failed",
              failureMessage: "WalletConnect could not prepare a QR code. Please try again.",
            }).then(() => ({ type: "uri" })),
            operation.cancelPromise,
          ]);

          session = firstResult.type === "session"
            ? firstResult.session
            : await Promise.race([connectPromise, operation.cancelPromise]);
        }

        if (!isCurrent(operation)) {
          throw new WalletConnectFlowError("cancelled", "WalletConnect was cancelled.");
        }

        removeProviderListener(operation.provider, "display_uri", operation.onDisplayUri);
        operation.modal?.closeModal?.();
        emit(operation, "connected", "WalletConnect connected.");
        await cleanup(operation, { disconnect: false });
        return { provider: operation.provider, session, modal: operation.modal, dependencies };
      } catch (error) {
        const publicError = flowError(
          error,
          "connection_failed",
          "WalletConnect could not complete the connection. Please try again.",
        );
        if (publicError.code !== "cancelled") {
          emit(operation, "error", publicError.message, { code: publicError.code });
        }
        await cleanup(operation);
        throw publicError;
      } finally {
        if (current === operation) {
          current = null;
        }
      }
    })();
    operation.promise.catch(() => {});
    return operation.promise;
  }

  function cancel(message = "WalletConnect was cancelled. You can try again whenever you are ready.") {
    if (!current) {
      return false;
    }
    const operation = current;
    emit(operation, "cancelled", message);
    operation.cancelled = true;
    operation.cancelReject?.(new WalletConnectFlowError("cancelled", message));
    void cleanup(operation);
    return true;
  }

  return Object.freeze({
    start,
    cancel,
    get busy() {
      return Boolean(current);
    },
  });
}
