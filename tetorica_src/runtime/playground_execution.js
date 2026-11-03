/**
 * @file playground_execution.js
 * 実行環境: Browser / Web Worker / Node.js（対象 realm に依存）
 * 依存: 注入された realm（既定は globalThis）の実行制限。存在するネットワーク・画面遷移 API を扱う。
 * DOM を必須としないが、インストール時に対象 realm の API を変更する。
 */
const NETWORK_DISABLED_MESSAGE =
  "Network access is disabled in Tetorica FM2612 Playground.";

const NAVIGATION_DISABLED_MESSAGE =
  "Navigation is disabled in Tetorica FM2612 Playground.";

const activeGuardStates = new WeakMap();
const nativeIpcTransports = new WeakMap();

/**
 * Snapshot Tauri's authenticated IPC endpoint before user code starts. The
 * returned capability does not expose fetch and accepts no ordinary network
 * URLs. Tauri still validates its private invoke key and command permissions.
 * @param {typeof globalThis} [realm=globalThis] Trusted application realm.
 * @returns {object | null} Opaque capability for the execution guard, or null outside Tauri.
 */
export function capturePlaygroundNativeIpc(realm = globalThis) {
  if (!realm || activeGuardStates.has(realm)) return null;
  const internals = realm.__TAURI_INTERNALS__;
  if (typeof internals?.invoke !== "function" ||
      typeof internals.convertFileSrc !== "function" ||
      typeof realm.fetch !== "function") return null;

  const NativeURL = realm.URL ?? globalThis.URL;
  const NativeHeaders = realm.Headers ?? globalThis.Headers;
  if (typeof NativeURL !== "function" || typeof NativeHeaders !== "function") return null;
  let endpoint;
  try {
    endpoint = new NativeURL(internals.convertFileSrc("tetorica-native-ipc-probe", "ipc"));
  } catch (_error) {
    return null;
  }
  const isNativeEndpoint = endpoint.protocol === "ipc:" && endpoint.hostname === "localhost" ||
    ["http:", "https:"].includes(endpoint.protocol) && endpoint.hostname === "ipc.localhost";
  if (!isNativeEndpoint || endpoint.port || endpoint.username || endpoint.password ||
      endpoint.search || endpoint.hash || endpoint.pathname !== "/tetorica-native-ipc-probe") return null;

  const nativeFetch = realm.fetch.bind(realm);
  const capability = Object.freeze({});
  nativeIpcTransports.set(capability, {
    realm,
    fetch(input, init) {
      // Tauri's custom-protocol transport uses a URL string and POST. Require
      // its authentication/callback headers as well as the exact captured host.
      if (typeof input !== "string" || init?.method !== "POST") return null;
      let target, headers;
      try {
        target = new NativeURL(input);
        headers = new NativeHeaders(init.headers);
      } catch (_error) {
        return null;
      }
      if (target.protocol !== endpoint.protocol || target.host !== endpoint.host ||
          target.username || target.password || target.search || target.hash ||
          !/^\/[^/]+$/.test(target.pathname) ||
          !headers.get("Tauri-Invoke-Key") || !headers.get("Tauri-Callback") ||
          !headers.get("Tauri-Error")) return null;
      return nativeFetch(target.href, {...init, method: "POST", headers});
    },
  });
  return capability;
}

/**
 * @typedef {{
 *   enabled?: boolean,
 *   nativeIpc?: object | null,
 * }} PlaygroundExecutionGuardOptions
 */

/**
 * Temporarily block network/navigation APIs in a realm; nested installations share guards.
 * @param {typeof globalThis} [realm=globalThis] Realm to patch.
 * @param {PlaygroundExecutionGuardOptions} [options={}] Whether guards are enabled.
 * @returns {() => void} Idempotent release function that restores APIs after the final owner releases.
 */
export function installPlaygroundExecutionGuards(
  realm = globalThis,
  options = {}
) {
  const {
    enabled = true,
    nativeIpc = null,
  } = options;

  if (!enabled) {
    return () => {};
  }

  if (
    !realm ||
    (typeof realm !== "object" &&
      typeof realm !== "function")
  ) {
    return () => {};
  }

  const existingState =
    activeGuardStates.get(realm);
  if (existingState) {
    existingState.count += 1;
    return createGuardRelease(
      realm,
      existingState
    );
  }

  const restoreSteps = [];
  const ipcTransport = nativeIpcTransports.get(nativeIpc);
  const blockedFunction = (
    message
  ) => {
    throw new Error(message);
  };

  patchProperty(
    realm,
    "fetch",
    (input, init) => {
      if (ipcTransport?.realm === realm) {
        const response = ipcTransport.fetch(input, init);
        if (response !== null) return response;
      }
      return blockedFunction(NETWORK_DISABLED_MESSAGE);
    },
    restoreSteps
  );
  patchProperty(
    realm,
    "XMLHttpRequest",
    function BlockedXMLHttpRequest() {
      blockedFunction(
        NETWORK_DISABLED_MESSAGE
      );
    },
    restoreSteps
  );
  patchProperty(
    realm,
    "WebSocket",
    function BlockedWebSocket() {
      blockedFunction(
        NETWORK_DISABLED_MESSAGE
      );
    },
    restoreSteps
  );
  patchProperty(
    realm,
    "EventSource",
    function BlockedEventSource() {
      blockedFunction(
        NETWORK_DISABLED_MESSAGE
      );
    },
    restoreSteps
  );

  if (
    realm.navigator &&
    typeof realm.navigator ===
      "object"
  ) {
    patchProperty(
      realm.navigator,
      "sendBeacon",
      () =>
        blockedFunction(
          NETWORK_DISABLED_MESSAGE
        ),
      restoreSteps
    );
  }

  if (
    realm.window &&
    typeof realm.window === "object"
  ) {
    patchProperty(
      realm.window,
      "open",
      () =>
        blockedFunction(
          NAVIGATION_DISABLED_MESSAGE
        ),
      restoreSteps
    );
  }

  patchProperty(
    realm,
    "open",
    () =>
      blockedFunction(
        NAVIGATION_DISABLED_MESSAGE
      ),
    restoreSteps
  );

  const locationTargets =
    collectLocationTargets(
      realm
    );
  for (const target of locationTargets) {
    patchProperty(
      target,
      "assign",
      () =>
        blockedFunction(
          NAVIGATION_DISABLED_MESSAGE
        ),
      restoreSteps
    );
    patchProperty(
      target,
      "replace",
      () =>
        blockedFunction(
          NAVIGATION_DISABLED_MESSAGE
        ),
      restoreSteps
    );
    patchProperty(
      target,
      "reload",
      () =>
        blockedFunction(
          NAVIGATION_DISABLED_MESSAGE
        ),
      restoreSteps
    );
  }

  const state = {
    count: 1,
    restoreSteps,
  };
  activeGuardStates.set(realm, state);
  return createGuardRelease(realm, state);
}

function createGuardRelease(realm, state) {
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    state.count -= 1;
    if (state.count > 0) {
      return;
    }
    for (
      let index =
        state.restoreSteps.length - 1;
      index >= 0;
      index -= 1
    ) {
      state.restoreSteps[index]();
    }
    activeGuardStates.delete(realm);
  };
}

/**
 * Run a callback with guards, restoring the realm even when the callback rejects.
 * @template T
 * @param {() => T | PromiseLike<T>} callback Work to execute.
 * @param {typeof globalThis} [realm=globalThis] Realm to patch.
 * @param {PlaygroundExecutionGuardOptions} [options={}] Guard settings.
 * @returns {Promise<Awaited<T>>} Callback result.
 */
export async function executeWithPlaygroundGuards(
  callback,
  realm = globalThis,
  options = {}
) {
  const restore =
    installPlaygroundExecutionGuards(
      realm,
      options
    );
  try {
    return await callback();
  } finally {
    restore();
  }
}

function patchProperty(
  target,
  propertyName,
  replacementValue,
  restoreSteps
) {
  if (
    !target ||
    (typeof target !== "object" &&
      typeof target !==
        "function")
  ) {
    return;
  }

  const hadOwnProperty =
    Object.prototype.hasOwnProperty.call(
      target,
      propertyName
    );
  const originalValue =
    target[propertyName];

  try {
    target[propertyName] =
      replacementValue;
  } catch (error) {
    return;
  }

  if (
    target[propertyName] !==
    replacementValue
  ) {
    return;
  }

  restoreSteps.push(() => {
    if (hadOwnProperty) {
      target[propertyName] =
        originalValue;
      return;
    }

    if (
      originalValue === undefined
    ) {
      delete target[propertyName];
      return;
    }

    target[propertyName] =
      originalValue;
  });
}

function collectLocationTargets(
  realm
) {
  const targets = [];
  const seen = new Set();

  if (realm.location) {
    targets.push(realm.location);
  }

  if (
    realm.window &&
    realm.window.location
  ) {
    targets.push(
      realm.window.location
    );
  }

  return targets.filter(
    (target) => {
      if (
        !target ||
        seen.has(target)
      ) {
        return false;
      }
      seen.add(target);
      return true;
    }
  );
}
