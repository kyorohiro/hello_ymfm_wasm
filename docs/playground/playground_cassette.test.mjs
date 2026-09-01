import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

import {
  loadPlaygroundCassette,
} from "./playground_cassette.js";

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
  }
);

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

function createDeflatedZip(entries) {
  return createZip(entries, true);
}

function createZip(entries, useDeflate) {
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
      uncompressed.length,
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
      uncompressed.length,
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
