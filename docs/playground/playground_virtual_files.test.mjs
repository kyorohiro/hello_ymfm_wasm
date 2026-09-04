import test from "node:test";
import assert from "node:assert/strict";

import {
  createVirtualFileSystem,
  normalizeVirtualPath,
  resolveVirtualDynamicImports,
} from "./playground_virtual_files.js";

test("resolves virtual paths relative to the current file", () => {
  assert.equal(
    normalizeVirtualPath("../lib/chord.js", "/songs/bass.js"),
    "/lib/chord.js"
  );
  assert.throws(
    () => normalizeVirtualPath("../../escape.js", "/bass.js"),
    /escapes the project/
  );
});

test("reads text, binary, and JSON virtual files", async () => {
  const files = createVirtualFileSystem([
    { path: "/index.js", data: "await play('C4');" },
    { path: "/presets.json", data: '{"name":"bass"}' },
    { path: "/samples/hit.bin", data: new Uint8Array([1, 2, 3]) },
  ]);
  const file = files.createFileReader("/index.js");

  assert.equal(await file("./index.js"), "await play('C4');");
  assert.deepEqual(await file("./presets.json", { type: "json" }), {
    name: "bass",
  });
  assert.deepEqual(
    new Uint8Array(await file("./samples/hit.bin", { type: "arrayBuffer" })),
    new Uint8Array([1, 2, 3])
  );
});

test("rewrites relative dynamic imports recursively", () => {
  const files = createVirtualFileSystem([
    { path: "/index.js", data: 'await import("./lib/hello.js");' },
    { path: "/lib/hello.js", data: 'export default await import("./note.js");' },
    { path: "/lib/note.js", data: "export const note = 'C4';" },
  ]);
  const modules = [];
  const source = resolveVirtualDynamicImports(
    files,
    files.get("/index.js").data,
    "/index.js",
    (moduleSource, path) => {
      modules.push({ path, moduleSource });
      return `blob:${path}`;
    }
  );

  assert.equal(source, 'await import("blob:/lib/hello.js");');
  assert.equal(modules[0].path, "/lib/note.js");
  assert.match(modules[1].moduleSource, /blob:\/lib\/note.js/);
});
