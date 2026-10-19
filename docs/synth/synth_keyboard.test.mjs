import test from "node:test";
import assert from "node:assert/strict";

import {
  createFretboardLayout,
  createFretboardState,
  getVisibleStrings,
  setInstrument,
  buildKeyboard,
} from "./synth_keyboard.js";
import { midiToOpnPitch } from "../js/soundchip_pitch.js";
import { bendPitch } from "./synth_pitch_bend.js";

test(
  "ukulele uses standard re-entrant G4-C4-E4-A4 tuning",
  () => {
    const state = createFretboardState();
    setInstrument(state, "ukulele");
    const layout = createFretboardLayout({
      state,
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

const pitchHz = (pitch, clock, divider = 144) =>
  pitch.fnum * clock * 2 ** (pitch.block - 1) / (divider * 2 ** 20);

test('UI E4/A4 use the same A4=440 pitch as Playground Run', () => {
  const state = createFretboardState();
  setInstrument(state, 'ukulele');
  const layout = createFretboardLayout({state});
  for (const [midi, hz] of [[64,329.6275569128699], [69,440]]) {
    const entry = layout.entries.find(entry => entry.midi === midi);
    assert(entry, `The layout must contain MIDI ${midi}`);
    assert.deepEqual(entry.pitch, midiToOpnPitch(midi));
    assert(Math.abs(pitchHz(entry.pitch,7670454) - hz) < .2,
      `${entry.noteName} should sound near ${hz} Hz`);
  }
});

test('pointer capture keeps releases on their original key and hidden FM details never compute OPN pitch', async t => {
  const previousDocument = globalThis.document;
  const elements = [];
  globalThis.document = {createElement() {
    const node = {dataset:{},children:[],listeners:new Map(),captured:new Set(),
      appendChild(child) {this.children.push(child);},
      addEventListener(name,listener) {this.listeners.set(name,listener);},
      setPointerCapture(id) {this.captured.add(id);},
      hasPointerCapture(id) {return this.captured.has(id);},
      releasePointerCapture(id) {this.captured.delete(id);this.listeners.get('lostpointercapture')?.({pointerId:id});},
    };
    elements.push(node); return node;
  }};
  t.after(() => {globalThis.document = previousDocument;});
  const root = globalThis.document.createElement(), events = [];
  const entry = {key:'a',label:'A',noteName:'C4',stringNumber:1,fret:0,
    get pitch() {throw new Error('custom instruments must not calculate OPN pitch');},
  };
  buildKeyboard({root,rowDefs:[{keys:'a',rowIndex:0,stringNumber:1}],layoutEntries:[entry],showPitch:false,
    onPointerDown:event => events.push(['on',event.pointerId]),
    onPointerUp:event => events.push(['off',event.pointerId]),
    onPointerCancel:event => events.push(['cancel',event.pointerId]),
  });
  const button = root.children[0].children[0];
  assert.doesNotMatch(button.innerHTML,/<small>/);
  await button.listeners.get('pointerdown')({pointerId:7,preventDefault() {}});
  assert.equal(button.hasPointerCapture(7),true,'a release outside the key is routed back to its captured button');
  button.listeners.get('pointerup')({pointerId:7});
  assert.equal(button.hasPointerCapture(7),false);
  await button.listeners.get('pointerdown')({pointerId:8,preventDefault() {}});
  button.listeners.get('lostpointercapture')({pointerId:8});
  assert.deepEqual(events,[['on',7],['off',7],['on',8],['cancel',8]],'a normal captured release must not also emit cancellation');
});

test('UI pitch follows changed chip clocks and YM2203 prescaling', () => {
  const state = createFretboardState();
  setInstrument(state, 'ukulele');
  let clock = 7670454;
  const layout = createFretboardLayout({state,getClock:()=>clock});
  const entry = layout.entries.find(entry => entry.midi === 69);
  const original = entry.pitch;
  clock = 8000000;
  assert.notDeepEqual(entry.pitch, original, 'An existing key reads the updated clock');
  assert.deepEqual(entry.pitch, midiToOpnPitch(69,clock));
  assert(Math.abs(pitchHz(entry.pitch,clock) - 440) < .2);
  const ym2203 = createFretboardLayout({state,clock:4000000,divider:72});
  const ym2203A = ym2203.entries.find(entry => entry.midi === 69);
  assert.deepEqual(ym2203A.pitch,midiToOpnPitch(69,4000000,72));
  assert(Math.abs(pitchHz(ym2203A.pitch,4000000,72) - 440) < .2);
  const bent = bendPitch(entry.pitch, 2);
  assert(Math.abs(pitchHz(bent,clock) / pitchHz(entry.pitch,clock) - 2 ** (2 / 12)) < .001,
    'Pitch bend keeps using the current raw BLOCK/FNUM units');
});
