import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

import {
  createPlaygroundCassetteZip,
  loadPlaygroundCassette,
} from "./playground_cassette.js";
import { createVgiFromPreset } from '../js/vgi.js';

const encoder = new TextEncoder();

test(
  "loads supported cassette files by directory and basename",
  async () => {
    const archive = createStoredZip([
      ["timbres/arcade-bass.tfi", new Uint8Array([1, 2, 3])],
      ["examples/stage-loop.js", "await play('C4');"],
      ["samples/hit.wav", new Uint8Array([4, 5])],
      ["README.md", "Optional documentation"],
    ]);
    const cassette =
      await loadPlaygroundCassette(
        archive,
        {
          name:
            "street-fighter-study.cassette.zip",
        }
      );

    assert.equal(
      cassette.id,
      "street-fighter-study"
    );
    assert.deepEqual(
      cassette.timbres.map(
        (item) => item.name
      ),
      ["arcade-bass"]
    );
    assert.deepEqual(
      cassette.examples.map(
        (item) => item.name
      ),
      ["stage-loop"]
    );
    assert.equal(
      cassette.examples[0].source,
      "await play('C4');"
    );
    assert.deepEqual(
      cassette.samples.map(
        (item) => item.name
      ),
      ["hit"]
    );
    assert.equal(
      new TextDecoder().decode(
        cassette.files.get("README.md")
      ),
      "Optional documentation"
    );
  }
);

test(
  "keeps project files outside the legacy cassette categories",
  async () => {
    const cassette = await loadPlaygroundCassette(
      createStoredZip([
        ["index.js", "const bass = await import('./bass.js');"],
        ["bass.js", "export function playBass() {}"],
        ["lib/chord.js", "export const chord = [];"],
      ])
    );

    assert.deepEqual(
      Array.from(cassette.files.keys()),
      ["index.js", "bass.js", "lib/chord.js"]
    );
    assert.equal(cassette.examples.length, 0);
  }
);

test("round-trips Virtual FS files through a cassette zip", async () => {
  const zip = createPlaygroundCassetteZip([
    { path: "/index.js", type: "text", data: "await play('C4');" },
    { path: "/lib/hello.js", type: "text", data: "export const hi = 1;" },
    { path: "/samples/hit.bin", type: "binary", data: new Uint8Array([1, 2]) },
  ]);
  const cassette = await loadPlaygroundCassette(zip);

  assert.equal(
    new TextDecoder().decode(cassette.files.get("index.js")),
    "await play('C4');"
  );
  assert.deepEqual(
    cassette.files.get("samples/hit.bin"),
    new Uint8Array([1, 2])
  );
});

test('shared Synth cassette preserves nested VGI instruments, code, samples and Git files', async () => {
  const vgi = createVgiFromPreset({ algorithm: 4, feedback: 5, ams: 2, pms: 6 });
  const files = [
    { path: '/presets/game-a/YM2612_CH1.vgi', type: 'binary', data: vgi },
    { path: '/presets/game-b/YM2612_CH1.vgi', type: 'binary', data: vgi },
    { path: '/timbres/legacy.vgi', type: 'binary', data: vgi },
    { path: '/index.js', type: 'text', data: "play('C4');" },
    { path: '/samples/choir.wav', type: 'binary', data: new Uint8Array([0, 1, 2, 255]) },
    { path: '/.git/config', type: 'binary', data: encoder.encode('[core]\n') },
    { path: '/.git/objects/ab/cdef', type: 'binary', data: new Uint8Array([0, 255, 31]) },
  ];
  const cassette = await loadPlaygroundCassette(createPlaygroundCassetteZip(files, { directories: ['/presets/empty'] }));
  assert.equal(cassette.timbres[0].name, 'legacy');
  assert.equal(cassette.timbres[0].path, 'timbres/legacy.vgi');
  assert.deepEqual(cassette.timbres[0].bytes, vgi);
  assert.equal(cassette.files.size, files.length + 1);
  for (const file of files) {
    assert.deepEqual(cassette.files.get(file.path.slice(1)), file.type === 'text' ? encoder.encode(file.data) : file.data);
  }
  assert.deepEqual(cassette.directories, ['/presets/empty']);
});

test('legacy TFI and VGI public names share collision checks', async () => {
  await assert.rejects(loadPlaygroundCassette(createStoredZip([
    ['timbres/same.tfi', new Uint8Array([1])],
    ['timbres/same.vgi', new Uint8Array([2])],
  ])), /Duplicate cassette timbres name "same"/);
});

test('opt-in export preserves exact metadata files and unknown metadata fields', async () => {
  const json = '{ "version": 2, "title": "My voices", "tags": ["fm"], "license": "CC0-1.0", "custom": { "future": true } }\n';
  const module = '/** cassette notes */\nexport default {"version":2,"workType":"ORIGINAL","license":"NONE","author":"Ada"};\n';
  for (const [path, source] of [['/metadata.json', json], ['/cassette.metadata.js', module]]) {
    const cassette = await loadPlaygroundCassette(createPlaygroundCassetteZip([
      { path: '/index.js', type: 'text', data: 'original source' },
      { path, type: 'binary', data: encoder.encode(source) },
    ], { preserveMetadataFiles: true, license: 'PRIVATE' }));
    assert.equal(new TextDecoder().decode(cassette.files.get(path.slice(1))), source);
    assert.equal(cassette.files.size, 2);
    assert.notEqual(cassette.metadata.license, 'PRIVATE');
    assert.equal(cassette.metadata.version, 2);
  }
});

test('metadata preservation still rejects invalid JSON/modules and default exports keep reserved names', () => {
  const file = (path, data) => ({ path, type: 'text', data });
  assert.throws(() => createPlaygroundCassetteZip([file('/metadata.json', '{}')]), /reserved/);
  assert.throws(() => createPlaygroundCassetteZip([file('/metadata.json', '{oops')], { preserveMetadataFiles: true }), /Invalid cassette metadata.json/);
  assert.throws(() => createPlaygroundCassetteZip([file('/cassette.metadata.js', 'throw new Error()')], { preserveMetadataFiles: true }), /Invalid cassette cassette.metadata.js/);
});

test('metadata preservation without an existing metadata file creates normal cassette metadata', async () => {
  const cassette = await loadPlaygroundCassette(createPlaygroundCassetteZip([
    { path: '/index.js', type: 'text', data: 'source' },
  ], { preserveMetadataFiles: true, license: 'CC-BY-4.0', workType: 'ORIGINAL' }));
  assert.equal(cassette.metadata.license, 'CC-BY-4.0');
  assert.equal(cassette.metadata.workType, 'ORIGINAL');
});

test("round-trips cassette license metadata and defaults old archives to NONE", async () => {
  const archive = createPlaygroundCassetteZip([
    { path: "/index.js", type: "text", data: "await play('C4');" },
  ], { license: "CC-BY-4.0" });
  const cassette = await loadPlaygroundCassette(archive);
  assert.equal(cassette.metadata.license, "CC-BY-4.0");
  assert.equal(cassette.metadata.workType, "NONE");

  const oldArchive = createStoredZip([["examples/old.js", "await sleep(1);"]]);
  const oldCassette = await loadPlaygroundCassette(oldArchive);
  assert.equal(oldCassette.metadata.license, "NONE");
  assert.equal(oldCassette.metadata.workType, "NONE");
});

test("unknown cassette license values become NONE", async () => {
  const archive = createPlaygroundCassetteZip([
    { path: "/index.js", type: "text", data: "" },
  ], { license: "not-a-license" });
  const cassette = await loadPlaygroundCassette(archive);
  assert.equal(cassette.metadata.license, "NONE");
});

test("custom cassette license keeps the author supplied label", async () => {
  const cassette = await loadPlaygroundCassette(createPlaygroundCassetteZip([
    { path: "/index.js", type: "text", data: "" },
  ], { license: "CUSTOM", licenseName: "CC BY-NC 4.0 / see credits" }));
  assert.equal(cassette.metadata.license, "CUSTOM");
  assert.equal(cassette.metadata.licenseName, "CC BY-NC 4.0 / see credits");
});

test("export preserves custom metadata fields while updating license fields", async () => {
  const cassette = await loadPlaygroundCassette(createPlaygroundCassetteZip([
    { path: "/index.js", type: "text", data: "" },
  ], {
    workType: "ORIGINAL",
    license: "CC0-1.0",
    metadata: { title: "My study", author: "Tetorica", tags: ["fm", "demo"] },
  }));
  const metadata = cassette.metadata;
  assert.deepEqual(metadata.tags, ["fm", "demo"]);
  assert.equal(metadata.title, "My study");
  assert.equal(metadata.license, "CC0-1.0");
});

test(
  "rejects duplicate public sample names",
  async () => {
    const archive = createStoredZip([
      ["samples/hit.wav", new Uint8Array([1])],
      ["samples/hit.flac", new Uint8Array([2])],
    ]);

    await assert.rejects(
      () => loadPlaygroundCassette(archive),
      /Duplicate cassette samples name "hit"/
    );
  }
);

test(
  "loads deflated example source",
  async () => {
    const archive = createDeflatedZip([
      ["examples/deflated.js", "await play('E4');"],
    ]);
    const cassette =
      await loadPlaygroundCassette(archive);

    assert.equal(
      cassette.examples[0].source,
      "await play('E4');"
    );
  }
);

test(
  "rejects deflate data that exceeds the expanded size limit despite a small header",
  async () => {
    const expanded = new Uint8Array(
      16 * 1024 * 1024 + 1
    );
    const archive = createDeflatedZip(
      [["examples/oversized.js", expanded]],
      { reportedUncompressedSize: 1 }
    );

    await assert.rejects(
      () => loadPlaygroundCassette(archive),
      /expanded size limit/
    );
  }
);

test(
  "rejects paths that escape the cassette archive",
  async () => {
    const archive = createStoredZip([
      ["../examples/escape.js", "throw new Error();"],
    ]);

    await assert.rejects(
      () => loadPlaygroundCassette(archive),
      /unsafe path/
    );
  }
);

function createStoredZip(entries) {
  return createZip(entries, false);
}

function createDeflatedZip(entries, options) {
  return createZip(entries, true, options);
}

function createZip(
  entries,
  useDeflate,
  options = {}
) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const [path, value] of entries) {
    const pathBytes = encoder.encode(path);
    const uncompressed = typeof value === "string"
      ? encoder.encode(value)
      : value;
    const data = useDeflate
      ? new Uint8Array(
        deflateRawSync(uncompressed)
      )
      : uncompressed;
    const reportedUncompressedSize =
      options.reportedUncompressedSize ??
      uncompressed.length;
    const localHeader = new Uint8Array(
      30 + pathBytes.length
    );
    const localView = new DataView(
      localHeader.buffer
    );

    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(
      8,
      useDeflate ? 8 : 0,
      true
    );
    localView.setUint16(26, pathBytes.length, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(
      22,
      reportedUncompressedSize,
      true
    );
    localHeader.set(pathBytes, 30);
    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(
      46 + pathBytes.length
    );
    const centralView = new DataView(
      centralHeader.buffer
    );

    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(
      10,
      useDeflate ? 8 : 0,
      true
    );
    centralView.setUint16(28, pathBytes.length, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(
      24,
      reportedUncompressedSize,
      true
    );
    centralView.setUint32(42, localOffset, true);
    centralHeader.set(pathBytes, 46);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + data.length;
  }

  const centralDirectory = concatBytes(
    centralParts
  );
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);

  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(
    12,
    centralDirectory.length,
    true
  );
  endView.setUint32(16, localOffset, true);

  return concatBytes([
    ...localParts,
    centralDirectory,
    end,
  ]);
}

function concatBytes(parts) {
  const length = parts.reduce(
    (total, part) => total + part.length,
    0
  );
  const result = new Uint8Array(length);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

test('cassette preserves empty directories alongside files', async () => {
  const zip = createPlaygroundCassetteZip([{path:'/index.js',type:'text',data:'entry'}], {directories:['/','/empty','/deep/empty']});
  const cassette = await loadPlaygroundCassette(zip);
  assert.deepEqual(cassette.directories.sort(), ['/deep/empty','/empty']);
  assert.equal(new TextDecoder().decode(cassette.files.get('index.js')), 'entry');
});
