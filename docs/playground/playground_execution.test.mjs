import test from "node:test";
import assert from "node:assert/strict";

import {
  executeWithPlaygroundGuards,
  installPlaygroundExecutionGuards,
} from "./playground_execution.js";

function createFakeRealm() {
  const realm = {
    fetch() {
      return "fetch";
    },
    XMLHttpRequest:
      function FakeXHR() {},
    WebSocket:
      function FakeWebSocket() {},
    EventSource:
      function FakeEventSource() {},
    open() {
      return "open";
    },
    navigator: {
      sendBeacon() {
        return true;
      },
    },
    location: {
      assign() {
        return "assign";
      },
      replace() {
        return "replace";
      },
      reload() {
        return "reload";
      },
    },
  };

  realm.window = realm;
  return realm;
}

test(
  "fetch is blocked during execution",
  async () => {
    const realm = createFakeRealm();

    await assert.rejects(
      () =>
        executeWithPlaygroundGuards(
          async () => realm.fetch(),
          realm
        ),
      /Network access is disabled/
    );
  }
);

test(
  "XMLHttpRequest is blocked during execution",
  async () => {
    const realm = createFakeRealm();

    await assert.rejects(
      () =>
        executeWithPlaygroundGuards(
          async () =>
            new realm.XMLHttpRequest(),
          realm
        ),
      /Network access is disabled/
    );
  }
);

test(
  "WebSocket is blocked during execution",
  async () => {
    const realm = createFakeRealm();

    await assert.rejects(
      () =>
        executeWithPlaygroundGuards(
          async () =>
            new realm.WebSocket(
              "wss://example.com"
            ),
          realm
        ),
      /Network access is disabled/
    );
  }
);

test(
  "EventSource is blocked during execution",
  async () => {
    const realm = createFakeRealm();

    await assert.rejects(
      () =>
        executeWithPlaygroundGuards(
          async () =>
            new realm.EventSource(
              "https://example.com"
            ),
          realm
        ),
      /Network access is disabled/
    );
  }
);

test(
  "navigator.sendBeacon is blocked during execution",
  async () => {
    const realm = createFakeRealm();

    await assert.rejects(
      () =>
        executeWithPlaygroundGuards(
          async () =>
            realm.navigator.sendBeacon(
              "https://example.com",
              "data"
            ),
          realm
        ),
      /Network access is disabled/
    );
  }
);

test(
  "window.open is blocked during execution",
  async () => {
    const realm = createFakeRealm();

    await assert.rejects(
      () =>
        executeWithPlaygroundGuards(
          async () =>
            realm.window.open(
              "https://example.com"
            ),
          realm
        ),
      /Navigation is disabled/
    );
  }
);

test(
  "blocked APIs are restored after user code finishes",
  async () => {
    const realm = createFakeRealm();
    const originalFetch =
      realm.fetch;
    const originalSendBeacon =
      realm.navigator.sendBeacon;

    await executeWithPlaygroundGuards(
      async () => {},
      realm
    );

    assert.equal(
      realm.fetch,
      originalFetch
    );
    assert.equal(
      realm.navigator.sendBeacon,
      originalSendBeacon
    );
  }
);

test(
  "blocked APIs are restored after user code throws",
  async () => {
    const realm = createFakeRealm();
    const originalFetch =
      realm.fetch;

    await assert.rejects(
      () =>
        executeWithPlaygroundGuards(
          async () => {
            throw new Error("boom");
          },
          realm
        ),
      /boom/
    );

    assert.equal(
      realm.fetch,
      originalFetch
    );
  }
);

test(
  "existing playground-style callbacks still work",
  async () => {
    const realm = createFakeRealm();
    const result =
      await executeWithPlaygroundGuards(
        async () => {
          const api = {
            setBpm(value) {
              return value;
            },
          };
          return api.setBpm(120);
        },
        realm
      );

    assert.equal(result, 120);
  }
);

test(
  "guard installer can be restored manually",
  () => {
    const realm = createFakeRealm();
    const originalOpen =
      realm.open;
    const restore =
      installPlaygroundExecutionGuards(
        realm
      );

    assert.throws(
      () => realm.open("x"),
      /Navigation is disabled/
    );

    restore();

    assert.equal(
      realm.open,
      originalOpen
    );
  }
);

test(
  "overlapping guards stay active until every callback finishes",
  () => {
    const realm = createFakeRealm();
    const originalFetch = realm.fetch;
    const firstRestore =
      installPlaygroundExecutionGuards(realm);
    const secondRestore =
      installPlaygroundExecutionGuards(realm);

    firstRestore();
    assert.throws(
      () => realm.fetch(),
      /Network access is disabled/
    );

    secondRestore();
    assert.equal(realm.fetch, originalFetch);
  }
);

test(
  "guards can be disabled explicitly for self-hosted use",
  async () => {
    const realm = createFakeRealm();
    const originalFetch =
      realm.fetch;
    const originalOpen =
      realm.open;

    const result =
      await executeWithPlaygroundGuards(
        async () => {
          assert.equal(
            realm.fetch,
            originalFetch
          );
          assert.equal(
            realm.open,
            originalOpen
          );
          return realm.fetch();
        },
        realm,
        { enabled: false }
      );

    assert.equal(result, "fetch");
    assert.equal(
      realm.fetch,
      originalFetch
    );
    assert.equal(
      realm.open,
      originalOpen
    );
  }
);
