import test from "node:test";
import assert from "node:assert/strict";

import {
  createFretboardLayout,
  createFretboardState,
  getVisibleStrings,
  setInstrument,
} from "./synth_keyboard.js";

test(
  "ukulele uses standard re-entrant G4-C4-E4-A4 tuning",
  () => {
    const state = createFretboardState();
    setInstrument(state, "ukulele");
    const layout = createFretboardLayout({
      state,
      referenceMidi: 62,
      referenceBlock: 4,
      referenceFnum: 553,
    });

    assert.deepEqual(
      getVisibleStrings(state),
      [1, 2, 3, 4]
    );
    assert.deepEqual(
      layout.rowDefs.map(
        (row) => row.stringBaseMidi
      ),
      [69, 64, 60, 67]
    );
    assert.deepEqual(
      layout.entries.filter(
        (entry) => entry.fret === 0
      ).map((entry) => entry.noteName),
      ["A4", "E4", "C4", "G4"]
    );
  }
);
