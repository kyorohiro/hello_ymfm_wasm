import test from 'node:test';
import assert from 'node:assert/strict';
import {createTetoricaSynth} from '../../web/tetorica_synth.js';
import {GameboyRuntimeSynth} from '../../web/gameboy_runtime_synth.js';
import {NativeRuntimeSynth} from '../../web/native_runtime_synth.js';
import {MegaSynth} from '../../web/megasynth.js';
import {YM2203RuntimeSynth} from '../../web/ym2203synth.js';
import {YM2608RuntimeSynth} from '../../web/ym2608synth.js';
import {NeoGeoSynth,YM2610BRuntimeSynth} from '../../web/ym2610bsynth.js';
import {SoundChipMixer} from '../../web/soundchip.js';

// npm exposes both factories and direct class subpaths. Browser cache versions
// must not split those canonical modules into separate constructor identities.
for(const [chip,Type]of[
  ['ym2612',MegaSynth],['ym2203',YM2203RuntimeSynth],['ym2608',YM2608RuntimeSynth],
  ['gameboy',GameboyRuntimeSynth],['ym2610',NeoGeoSynth],['ym2610b',YM2610BRuntimeSynth],
  ['nes',NativeRuntimeSynth],['snes',NativeRuntimeSynth],['scsp',NativeRuntimeSynth],['x68000',NativeRuntimeSynth],['huc6280',NativeRuntimeSynth],['segapsg',NativeRuntimeSynth],['dx7',NativeRuntimeSynth],
])test(`${chip}: canonical factory instances match direct public class and mixer exports`,()=>{
  const synth=createTetoricaSynth({chip});
  assert(synth instanceof Type);
  assert(synth.mixer instanceof SoundChipMixer);
  assert.equal(synth.audioContext,null);
});
