import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

import {
  createVirtualFileSystem,
  createVirtualFileRuntimeSource,
  normalizeVirtualPath,
  isCheckpointVirtualPath,
  resolveVirtualDynamicImports,
} from "./playground_virtual_files.js";

test('checkpoint display filtering only recognizes the root metadata folder and does not mutate files', async () => {
  const files = createVirtualFileSystem([
    {path:'/index.js', data:'current'},
    {path:'/.tet.ss/index.js', data:'original'},
    {path:'/nested/.tet.ss/song.js', data:'ordinary nested folder'},
    {path:'/.tet.ss-copy/song.js', data:'ordinary sibling folder'},
  ]);
  const before = files.snapshot();
  assert.equal(isCheckpointVirtualPath('/.tet.ss'), true);
  assert.deepEqual(files.list().filter(file => !isCheckpointVirtualPath(file.path)).map(file => file.path), [
    '/index.js', '/nested/.tet.ss/song.js', '/.tet.ss-copy/song.js',
  ]);
  assert.deepEqual(files.snapshot(), before, 'Hidden checkpoint files stay in snapshots');
  assert.equal(await files.createFileReader('/index.js')('/.tet.ss/index.js'), 'original');
});

test('Playground hides checkpoint files in Files and Run while preserving them in autosave', () => {
  const source = readFileSync(new URL('./playground.js', import.meta.url), 'utf8');
  const files = createVirtualFileSystem([
    {path:'/index.js', data:'current source'},
    {path:'/.tet.ss/index.js', data:'previous source'},
    {path:'/.tet.ss/opaque.bin', data:new Uint8Array([0,255])},
    {path:'/sys/builtin.js', data:'system source'},
  ]);
  let treeEntries;
  const element = () => ({children:[], appendChild(child) {this.children.push(child);}});
  const runSelect = {...element(), replaceChildren() {this.children=[];}};
  const context = vm.createContext({
    virtualFiles:files, isCheckpointVirtualPath,
    runVirtualPath:'/.tet.ss/index.js', activeVirtualPath:'/index.js', activeTfiFilePath:null,
    fileExplorerList:{}, expandedFileFolders:new Map(),
    renderFileTree(_root, entries) {treeEntries=entries;},
    openVirtualFile() {}, transferExplorerFiles() {}, importDroppedFiles() {},
    renameFileButton:{}, deleteFileButton:{},
    runFileSelect:runSelect, document:{createElement:element},
    currentCassetteMetadata:null, currentCassetteHasMetadataFile:false,
    getEditorValue:()=>'latest editor source',
  });
  const policies = source.slice(source.indexOf('function isSystemVirtualPath('), source.indexOf('\nfunction restoreBundledExampleFiles('));
  const runOptions = source.slice(source.indexOf('function renderRunFileOptions('), source.indexOf('\nconst expandedFileFolders'));
  const explorer = source.slice(source.indexOf('function renderVirtualFileExplorer('), source.indexOf('\nfunction openVirtualFile('));
  vm.runInContext(`${policies}\n${runOptions}\n${explorer}\nrenderRunFileOptions();renderVirtualFileExplorer();`, context);
  assert.deepEqual(runSelect.children.flatMap(group=>group.children.map(option=>option.value)), ['/index.js']);
  assert.equal(context.runVirtualPath, '/index.js', 'A stored checkpoint run target falls back to current');
  assert.deepEqual(Array.from(treeEntries, entry=>entry.path).filter(path=>path.endsWith('.js')), ['/index.js']);
  assert.ok(treeEntries.every(entry=>!isCheckpointVirtualPath(entry.path)));
  const captureStart = source.indexOf('function captureProjectSnapshot()');
  const captureEnd = source.indexOf('\nasync function restoreProjectSnapshot', captureStart);
  vm.runInContext(source.slice(captureStart, captureEnd), context);
  const snapshot = context.captureProjectSnapshot();
  assert.equal(snapshot.files.find(file=>file.path==='/index.js').data, 'latest editor source');
  assert.equal(snapshot.files.find(file=>file.path==='/.tet.ss/index.js').data, 'previous source');
  assert.deepEqual(snapshot.files.find(file=>file.path==='/.tet.ss/opaque.bin').data, new Uint8Array([0,255]));
  assert.ok(snapshot.directories.includes('/.tet.ss'));
  assert.equal(snapshot.files.some(file=>file.path.startsWith('/sys/')), false, 'Existing built-in persistence policy stays unchanged');
});

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

test("runtime file API reads relative text, binary, and JSON files", async () => {
  const files = createVirtualFileSystem([
    { path: "/index.js", data: "" },
    { path: "/config.json", data: '{"tempo":120}' },
    { path: "/samples/hit.bin", data: new Uint8Array([4, 5]) },
  ]);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const read = new AsyncFunction(
    `${createVirtualFileRuntimeSource(files, "/index.js", { install: true })}
     return {
       config: await file("./config.json", { type: "json" }),
       bytes: Array.from(new Uint8Array(await file("./samples/hit.bin", { type: "arrayBuffer" }))),
     };`
  );

  assert.deepEqual(await read(), {
    config: { tempo: 120 },
    bytes: [4, 5],
  });
});

test("runtime sample.load reads a virtual binary without format filtering", async () => {
  const files = createVirtualFileSystem([
    { path: "/index.js", data: "" },
    { path: "/samples/hit.mp3", data: new Uint8Array([6, 7, 8]) },
  ]);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const load = new AsyncFunction(
    "sample",
    `${createVirtualFileRuntimeSource(files, "/index.js", { install: true })}
     await sample.loadFile("/samples/hit.mp3");
     await sample.load("hit-alias", "/samples/hit.mp3");
     return sample.calls;`
  );
  const sample = {
    calls: [],
    async load(name, bytes) {
      this.calls.push({ name, bytes: Array.from(new Uint8Array(bytes)) });
    },
  };

  assert.deepEqual(await load(sample), [
    { name: "/samples/hit.mp3", bytes: [6, 7, 8] },
    { name: "hit-alias", bytes: [6, 7, 8] },
  ]);
});
