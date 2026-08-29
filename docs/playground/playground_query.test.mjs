import test from "node:test";
import assert from "node:assert/strict";

import { createTfiFromPreset } from "../js/tfi.js";
import {
  decodeBase64Source,
  loadTfiPresetsFromQuery,
  resolveInitialSourceFromQuery,
} from "./playground_query.js";

function encodeBytes(bytes) {
  return Buffer.from(bytes).toString(
    "base64"
  );
}

function encodeText(text) {
  return Buffer.from(
    text,
    "utf8"
  ).toString("base64");
}

function createSamplePreset(
  algorithm,
  feedback,
  tl4 = 22
) {
  return {
    algorithm,
    feedback,
    operators: {
      1: { dt: 0, multi: 1, tl: 127, rs: 0, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15, ssg: 0 },
      2: { dt: 0, multi: 2, tl: 36, rs: 0, ar: 24, d1r: 6, d2r: 2, sl: 3, rr: 7, ssg: 0 },
      3: { dt: 0, multi: 3, tl: 48, rs: 1, ar: 18, d1r: 5, d2r: 2, sl: 4, rr: 7, ssg: 0 },
      4: { dt: 0, multi: 1, tl: tl4, rs: 0, ar: 22, d1r: 6, d2r: 3, sl: 3, rr: 8, ssg: 0 },
    },
  };
}

test(
  "loads one valid TFI from URL params",
  () => {
    const bytes =
      createTfiFromPreset(
        createSamplePreset(
          7,
          2
        )
      );
    const result =
      loadTfiPresetsFromQuery(
        `?tfi=${encodeBytes(bytes)}&tfi-id=bass`
      );

    assert.deepEqual(
      result.loadedIds,
      ["bass"]
    );
    assert.equal(
      result.errors.length,
      0
    );
    assert.equal(
      result.presets.bass.algorithm,
      7
    );
    assert.equal(
      result.presets.bass.feedback,
      2
    );
  }
);

test(
  "loads multiple TFIs and maps ids by index",
  () => {
    const bass =
      createTfiFromPreset(
        createSamplePreset(
          7,
          1,
          18
        )
      );
    const bell =
      createTfiFromPreset(
        createSamplePreset(
          4,
          3,
          12
        )
      );
    const result =
      loadTfiPresetsFromQuery(
        `?tfi=${encodeBytes(bass)},${encodeBytes(bell)}&tfi-id=bass,bell`
      );

    assert.deepEqual(
      result.loadedIds,
      ["bass", "bell"]
    );
    assert.equal(
      result.presets.bass.algorithm,
      7
    );
    assert.equal(
      result.presets.bell.algorithm,
      4
    );
  }
);

test(
  "invalid Base64 fails safely",
  () => {
    const result =
      loadTfiPresetsFromQuery(
        "?tfi=%%%&tfi-id=bass"
      );

    assert.deepEqual(
      result.loadedIds,
      []
    );
    assert.equal(
      Object.keys(
        result.presets
      ).length,
      0
    );
    assert.equal(
      result.errors.length,
      1
    );
  }
);

test(
  "invalid TFI byte length fails safely",
  () => {
    const bytes =
      new Uint8Array(10);
    const result =
      loadTfiPresetsFromQuery(
        `?tfi=${encodeBytes(bytes)}&tfi-id=short`
      );

    assert.deepEqual(
      result.loadedIds,
      []
    );
    assert.equal(
      result.errors.length,
      1
    );
  }
);

test(
  "invalid id is ignored safely",
  () => {
    const bytes =
      createTfiFromPreset(
        createSamplePreset(
          7,
          0
        )
      );
    const result =
      loadTfiPresetsFromQuery(
        `?tfi=${encodeBytes(bytes)}&tfi-id=bad.id`
      );

    assert.deepEqual(
      result.loadedIds,
      []
    );
    assert.equal(
      result.errors.length,
      1
    );
  }
);

test(
  "mismatched TFI and id counts still load matching pairs safely",
  () => {
    const bytes1 =
      createTfiFromPreset(
        createSamplePreset(
          7,
          0
        )
      );
    const bytes2 =
      createTfiFromPreset(
        createSamplePreset(
          4,
          1
        )
      );
    const result =
      loadTfiPresetsFromQuery(
        `?tfi=${encodeBytes(bytes1)},${encodeBytes(bytes2)}&tfi-id=lead`
      );

    assert.deepEqual(
      result.loadedIds,
      ["lead"]
    );
    assert.equal(
      result.presets.lead.algorithm,
      7
    );
    assert.equal(
      result.errors.length,
      1
    );
  }
);

test(
  "no TFI params keeps startup unchanged",
  () => {
    const result =
      loadTfiPresetsFromQuery(
        "?src=abc&ex=single"
      );

    assert.deepEqual(
      result.loadedIds,
      []
    );
    assert.deepEqual(
      result.errors,
      []
    );
  }
);

test(
  "src query still wins over ex",
  () => {
    const examples = {
      single: "example-single",
      "live-loop":
        "example-live-loop",
    };
    const src =
      encodeText(
        'console.log("hello");'
      );
    const result =
      resolveInitialSourceFromQuery(
        `?src=${src}&ex=single`,
        examples
      );

    assert.equal(
      result.source,
      'console.log("hello");'
    );
    assert.equal(
      result.exampleName,
      null
    );
    assert.equal(
      result.status,
      "Loaded code from ?src=..."
    );
  }
);

test(
  "ex query still loads existing examples",
  () => {
    const examples = {
      single: "example-single",
      "live-loop":
        "example-live-loop",
    };
    const result =
      resolveInitialSourceFromQuery(
        "?ex=single",
        examples
      );

    assert.equal(
      result.source,
      "example-single"
    );
    assert.equal(
      result.exampleName,
      "single"
    );
  }
);

test(
  "decodeBase64Source returns null on invalid source",
  () => {
    assert.equal(
      decodeBase64Source("%%%"),
      null
    );
  }
);
