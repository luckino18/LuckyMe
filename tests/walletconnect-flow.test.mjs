import assert from "node:assert/strict";
import test from "node:test";
import {
  createWalletConnectFlow,
} from "../site/lucky-me.app/walletconnect-flow.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function providerMock(connect) {
  const listeners = new Map();
  return {
    connect,
    disconnectCalls: 0,
    on(event, listener) {
      listeners.set(event, listener);
    },
    off(event, listener) {
      if (listeners.get(event) === listener) {
        listeners.delete(event);
      }
    },
    emit(event, value) {
      listeners.get(event)?.(value);
    },
    disconnect() {
      this.disconnectCalls += 1;
    },
  };
}

function flowFor({ loader, initializer, statuses = [], uris = [], timeouts = {} }) {
  return createWalletConnectFlow({
    loadDependencies: loader,
    initializeProvider: initializer,
    createModal: () => ({ openModal() {}, closeModal() {} }),
    connectOptions: { optionalNamespaces: { solana: {} } },
    onStatus: (status) => statuses.push(status),
    onUri: ({ uri }) => uris.push(uri),
    timeouts: { loadMs: 20, initMs: 20, uriMs: 20, ...timeouts },
  });
}

test("rejected WalletConnect bundle import becomes an actionable recoverable error", async () => {
  const statuses = [];
  const flow = flowFor({
    loader: async () => { throw new Error("network detail must stay private"); },
    initializer: async () => null,
    statuses,
  });

  await assert.rejects(flow.start(), (error) => {
    assert.equal(error.code, "load_failed");
    assert.match(error.message, /could not be loaded/i);
    assert.doesNotMatch(error.message, /network detail/);
    return true;
  });
  assert.equal(flow.busy, false);
  assert.equal(statuses.at(-1).phase, "error");
});

test("provider initialization has its own timeout", async () => {
  const flow = flowFor({
    loader: async () => ({}),
    initializer: () => new Promise(() => {}),
  });

  await assert.rejects(flow.start(), (error) => error.code === "init_timeout");
  assert.equal(flow.busy, false);
});

test("pairing URI has a timeout independent from wallet approval", async () => {
  const provider = providerMock(() => new Promise(() => {}));
  const statuses = [];
  const flow = flowFor({
    loader: async () => ({}),
    initializer: async () => provider,
    statuses,
  });

  await assert.rejects(flow.start(), (error) => error.code === "uri_timeout");
  assert.equal(provider.disconnectCalls, 1);
  assert.equal(statuses.at(-1).busy, false);
  assert.ok(statuses.every(({ message }) => !/Opening WalletConnect/i.test(message)));
});

test("display_uri exposes the QR input and wallet approval may finish later", async () => {
  const connected = deferred();
  let provider;
  provider = providerMock(() => {
    queueMicrotask(() => provider.emit("display_uri", "wc:test-pairing"));
    return connected.promise;
  });
  const uris = [];
  const statuses = [];
  const flow = flowFor({
    loader: async () => ({ createWalletConnectQrDataUrl: async () => "data:image/png;base64,AA==" }),
    initializer: async () => provider,
    statuses,
    uris,
  });

  const connection = flow.start();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(uris, ["wc:test-pairing"]);
  assert.equal(statuses.at(-1).phase, "awaiting_approval");
  assert.equal(flow.busy, true);

  const session = { namespaces: { solana: {} } };
  connected.resolve(session);
  assert.equal((await connection).session, session);
  assert.equal(flow.busy, false);
});

test("timeout can be retried and cancel clears an active attempt", async () => {
  const first = providerMock(() => new Promise(() => {}));
  const secondConnection = deferred();
  const second = providerMock(() => secondConnection.promise);
  const providers = [first, second];
  const flow = flowFor({
    loader: async () => ({}),
    initializer: async () => providers.shift(),
  });

  await assert.rejects(flow.start(), (error) => error.code === "uri_timeout");
  const retry = flow.start();
  queueMicrotask(() => second.emit("display_uri", "wc:retry"));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(flow.cancel(), true);
  await assert.rejects(retry, (error) => error.code === "cancelled");
  assert.equal(flow.busy, false);
  assert.equal(second.disconnectCalls, 1);
});

test("double click reuses one operation and late rejection is handled", async () => {
  let connectCalls = 0;
  const late = deferred();
  const provider = providerMock(() => {
    connectCalls += 1;
    return late.promise;
  });
  const flow = flowFor({
    loader: async () => ({}),
    initializer: async () => provider,
  });
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);

  try {
    const first = flow.start();
    const second = flow.start();
    assert.equal(first, second);
    await assert.rejects(first, (error) => error.code === "uri_timeout");
    late.reject(new Error("late provider rejection"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(connectCalls, 1);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
