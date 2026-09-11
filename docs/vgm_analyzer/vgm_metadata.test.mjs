import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { parseVgmMetadata, maybeDecodeVgmFile } from "../js/vgm_file.js";
import { parseVgmMetadata as parseSourceMetadata } from "../../web/vgm_file.js";

function fixture() {
  const fields = ["Neo-Geo Logo", "ネオジオロゴ", "Fatal Fury - King of Fighters", "餓狼伝説 - 宿命の闘い",
    "Neo Geo", "ネオジオ", "Shinsekai Gakkyoku Zatsugidan", "新世界楽曲雑技団", "1991", "Recorder", "Line 1\nLine 2 <tag>"];
  const payload = Buffer.from(fields.join("\0") + "\0", "utf16le");
  const bytes = new Uint8Array(0x51 + payload.length);
  bytes.set([86, 103, 109, 32]);
  const view = new DataView(bytes.buffer);
  view.setUint32(0x14, 0x45 - 0x14, true);
  bytes.set([71, 100, 51, 32], 0x45);
  view.setUint32(0x49, 0x100, true);
  view.setUint32(0x4d, payload.length, true);
  bytes.set(payload, 0x51);
  return bytes;
}

test("reads bilingual GD3 fields at an unaligned relative offset and supports sliced buffers", () => {
  const bytes = fixture();
  const padded = new Uint8Array(bytes.length + 7);
  padded.set(bytes, 7);
  const tag = parseVgmMetadata(padded.subarray(7));
  assert.equal(tag.trackName, "Neo-Geo Logo");
  assert.equal(tag.gameNameOriginal, "餓狼伝説 - 宿命の闘い");
  assert.equal(tag.authorOriginal, "新世界楽曲雑技団");
  assert.equal(tag.releaseDate, "1991");
  assert.equal(tag.notes, "Line 1\nLine 2 <tag>");
  assert.deepEqual(parseSourceMetadata(bytes.buffer), tag);
});

test("reads GD3 from gzip-compressed VGZ", async () => {
  assert.deepEqual(parseVgmMetadata(await maybeDecodeVgmFile(gzipSync(fixture()))), parseVgmMetadata(fixture()));
});

test("missing, truncated, invalid and unsupported GD3 tags are ignored safely", () => {
  assert.equal(parseVgmMetadata(new ArrayBuffer(0)), null);
  for (const [offset, value] of [[0, 0], [0x14, 0], [0x14, 0xffffffff], [0x45, 0], [0x49, 0x200], [0x4d, 0xffffffff], [0x4d, 2]]) {
    const bytes = fixture();
    new DataView(bytes.buffer).setUint32(offset, value, true);
    assert.equal(parseVgmMetadata(bytes), null);
  }
  const bytes = fixture();
  assert.equal(parseVgmMetadata(bytes.subarray(0, bytes.length - 2)), null);
  bytes[bytes.length - 2] = 65;
  assert.equal(parseVgmMetadata(bytes), null);
});

test("empty fields remain empty without shifting later fields", () => {
  const bytes = fixture();
  bytes.fill(0, 0x51);
  assert.equal(parseVgmMetadata(bytes).author, "");
});
