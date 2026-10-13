import test from "node:test";
import assert from "node:assert/strict";

import {
  capturePlaygroundNativeIpc,
  executeWithPlaygroundGuards,
  installPlaygroundExecutionGuards,
} from "./playground_execution.js";

function createTauriRealm(endpoint = "ipc://localhost") {
  const realm = createFakeRealm();
  realm.URL = URL;
  realm.Headers = Headers;
  const requests = [];
  realm.fetch = function (input, init) {
    assert.equal(this, realm, "the trusted fetch keeps its original realm");
    requests.push({input, init});
    return Promise.resolve("native IPC result");
  };
  const ipcOptions = () => ({method: "POST", headers: new Headers({
    "Tauri-Invoke-Key": "private-test-key", "Tauri-Callback": "1", "Tauri-Error": "2",
  }), body: "{}"});
  realm.__TAURI_INTERNALS__ = {
    convertFileSrc: (command, protocol) => {
      assert.equal(protocol, "ipc");
      return `${endpoint}/${encodeURIComponent(command)}`;
    },
    // Like Tauri, invoke looks up fetch when the command is sent, not at startup.
    invoke(command) {
      return realm.fetch(this.convertFileSrc(command, "ipc"), ipcOptions());
    },
  };
  return {realm, requests, ipcOptions};
}

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

for (const endpoint of ["ipc://localhost", "http://ipc.localhost", "https://ipc.localhost"]) {
  test(`Tauri IPC remains available during guarded async callbacks at ${endpoint}`, async () => {
    const {realm, requests} = createTauriRealm(endpoint);
    const originalFetch = realm.fetch;
    const nativeIpc = capturePlaygroundNativeIpc(realm);
    assert.ok(nativeIpc);
    let finish;
    const pending = executeWithPlaygroundGuards(async () => {
      await new Promise(resolve => {finish = resolve;});
      assert.throws(() => realm.fetch("https://example.com"), /Network access is disabled/);
    }, realm, {nativeIpc});

    assert.equal(await realm.__TAURI_INTERNALS__.invoke("mcp_status"), "native IPC result");
    await executeWithPlaygroundGuards(async () => {
      assert.equal(await realm.__TAURI_INTERNALS__.invoke("window_top_get"), "native IPC result");
    }, realm, {nativeIpc});
    assert.throws(() => realm.fetch("https://example.com"), /Network access is disabled/);
    assert.deepEqual(requests.map(r => r.input), [`${endpoint}/mcp_status`, `${endpoint}/window_top_get`]);
    finish();
    await pending;
    assert.equal(realm.fetch, originalFetch);
  });
}

test("the native IPC exception rejects ordinary network, other origins and unauthenticated requests", async () => {
  const {realm, requests, ipcOptions} = createTauriRealm();
  const nativeIpc = capturePlaygroundNativeIpc(realm);
  const restore = installPlaygroundExecutionGuards(realm, {nativeIpc});
  try {
    for (const target of [
      "https://example.com/mcp_status", "http://localhost/mcp_status",
      "http://127.0.0.1:8888/mcp_status", "http://ipc.localhost/mcp_status",
      "ipc://localhost:8888/mcp_status", "ipc://localhost.example.com/mcp_status",
      "ipc://otherhost/mcp_status", "ipc://user@localhost/mcp_status",
      "ipc://localhost/mcp_status?target=https://example.com", "ipc://localhost/mcp_status#fragment",
      "ipc://localhost/", "ipc://localhost/a/b",
    ]) assert.throws(() => realm.fetch(target, ipcOptions()), /Network access is disabled/, target);
    for (const init of [undefined, {method:"GET"}, {method:"POST"},
      {method:"POST", headers:{"Tauri-Callback":"1", "Tauri-Error":"2"}},
      {method:"POST", headers:{"Tauri-Invoke-Key":"key"}}]) {
      assert.throws(() => realm.fetch("ipc://localhost/mcp_status", init), /Network access is disabled/);
    }
    assert.throws(() => new realm.WebSocket("ws://localhost"), /Network access is disabled/);
    assert.equal(requests.length, 0);
  } finally {
    restore();
  }
});

test("IPC transport is captured before execution and cannot be forged or shared with another realm", async () => {
  const {realm} = createTauriRealm();
  const nativeIpc = capturePlaygroundNativeIpc(realm);
  realm.__TAURI_INTERNALS__.convertFileSrc = () => "https://example.com/mcp_status";
  await executeWithPlaygroundGuards(async () => {
    assert.throws(() => realm.__TAURI_INTERNALS__.invoke("mcp_status"), /Network access is disabled/);
    assert.equal(capturePlaygroundNativeIpc(realm), null, "cannot capture a guarded fetch");
  }, realm, {nativeIpc});
  const other = createTauriRealm();
  for (const capability of [nativeIpc, {}]) await executeWithPlaygroundGuards(async () => {
    assert.throws(() => other.realm.__TAURI_INTERNALS__.invoke("mcp_status"), /Network access is disabled/);
  }, other.realm, {nativeIpc:capability});
});

test("browser guards never infer network permission from a native-looking URL", async () => {
  const {realm} = createTauriRealm();
  await executeWithPlaygroundGuards(async () => {
    assert.throws(() => realm.__TAURI_INTERNALS__.invoke("mcp_status"), /Network access is disabled/);
  }, realm);
  assert.equal(capturePlaygroundNativeIpc(createFakeRealm()), null);
  for (const endpoint of ["https://example.com", "http://localhost:8888", "ipc://otherhost"]) {
    assert.equal(capturePlaygroundNativeIpc(createTauriRealm(endpoint).realm), null);
  }
});
