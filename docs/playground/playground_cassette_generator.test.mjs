import test from "node:test";
import assert from "node:assert/strict";

import {
  createCassetteZip,
} from "./playground_cassette_generator.js";
import {
  loadPlaygroundCassette,
} from "./playground_cassette.js";

test(
  "generates a cassette zip the loader can read",
  async () => {
    const result = await createCassetteZip({
      name: "arcade-study",
      timbres: [
        createFile("bass.tfi", [1, 2, 3]),
      ],
      examples: [
        createFile(
          "demo.js",
          "await play('C4');"
        ),
      ],
      samples: [
        createFile("hit.wav", [4, 5]),
      ],
      readme: "# Arcade Study",
    });
    const cassette =
      await loadPlaygroundCassette(result.zip, {
        name: `${result.name}.cassette.zip`,
      });

    assert.equal(result.name, "arcade-study");
    assert.deepEqual(
      cassette.timbres.map((item) => item.name),
      ["bass"]
    );
    assert.equal(
      cassette.examples[0].source,
      "await play('C4');"
    );
    assert.deepEqual(
      cassette.samples.map((item) => item.name),
      ["hit"]
    );
  }
);

test(
  "rejects unsupported files before creating a cassette",
  async () => {
    await assert.rejects(
      () => createCassetteZip({
        name: "bad-cassette",
        timbres: [createFile("bass.txt", [1])],
      }),
      /not a supported timbres file/
    );
  }
);

function createFile(name, value) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : new Uint8Array(value);

  return {
    name,
    size: bytes.byteLength,
    async arrayBuffer() {
      return bytes.buffer.slice(0);
    },
  };
}
