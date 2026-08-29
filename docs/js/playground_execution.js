const NETWORK_DISABLED_MESSAGE =
  "Network access is disabled in Tetorica FM2612 Playground.";

const NAVIGATION_DISABLED_MESSAGE =
  "Navigation is disabled in Tetorica FM2612 Playground.";

/**
 * @typedef {{
 *   enabled?: boolean,
 * }} PlaygroundExecutionGuardOptions
 */

export function installPlaygroundExecutionGuards(
  realm = globalThis,
  options = {}
) {
  const {
    enabled = true,
  } = options;

  if (!enabled) {
    return () => {};
  }

  const restoreSteps = [];
  const blockedFunction = (
    message
  ) => {
    throw new Error(message);
  };

  patchProperty(
    realm,
    "fetch",
    () =>
      blockedFunction(
        NETWORK_DISABLED_MESSAGE
      ),
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

  return () => {
    for (
      let index =
        restoreSteps.length - 1;
      index >= 0;
      index -= 1
    ) {
      restoreSteps[index]();
    }
  };
}

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
