import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {selectFm2608CodeDeclarations} from './code_declarations.js';

test('OPNA Code completion exposes the borrowed four-section API and rejects absent chip factories', async () => {
  const source = await readFile(new URL('../playground/tetorica-playground-globals.d.ts', import.meta.url), 'utf8');
  const declarations = selectFm2608CodeDeclarations(source);
  assert.doesNotMatch(declarations, /declare (?:function|const) (?:fm|play|createSoundChip)\b/);
  const work = await mkdtemp(join(tmpdir(), 'fm2608-code-types-'));
  try {
    await writeFile(join(work, 'globals.d.ts'), declarations);
    await writeFile(join(work, 'entry.ts'), `export {};
const opna = await useSoundChip('ym2608');
opna.noteOn(CH1,'E3');await beat(.5);opna.noteOff(CH1);
opna.setFrequency(CH2,440);opna.setFrequency(CH2,4,700);
opna.setNote(CH2,69);opna.setBlockFnum(CH3,4,700);
opna.setOperator(CH1,OP1,{ar:31,rr:10});
opna.keyOn(CH3,[OP1,OP3]);
opna.setChannel3Mode('special',{timerA:512,running:false});
opna.setChannel3SpecialFrequency(OP2,4,1000);
opna.setCsm(true,{timerA:900,running:false});opna.keyOn(CH3);opna.keyOff(CH3);
opna.setTimerA(800);const ch3=opna.getChannel3State();
const captured=opna.capturePreset();captured.adpcm.start;captured.fm[0].keyMask;
opna.ssg.setMixer(0,{tone:true,noise:true});
opna.ssg.setEnvelope({period:512,shape:10});
opna.ssg.noteOn(0,'C4');opna.ssg.keyOff(0);
opna.rhythm.keyOn(['bassDrum','snare']);
opna.adpcm.setSample({start:0,end:32});
opna.adpcm.setPlaybackRate(16000);opna.adpcm.keyOn({repeat:true});
await opna.adpcm.loadSample({channels:[new Float32Array(64)],sampleRate:16000});
await opna.adpcm.loadMemory(new Uint8Array(64),256);
await livePrepare('opna',async api => api.useSoundChip('ym2608'));
await pg.useSoundChip('ym2608');opna.allNotesOff();opna.dispose();
// @ts-expect-error a different chip belongs to another Synth
await useSoundChip('ym2612');
// @ts-expect-error no seventh physical FM channel
opna.noteOn(6,'C4');
// @ts-expect-error named hardware CH3 modes only
opna.setChannel3Mode('ring');
// @ts-expect-error the SSG has three channels
opna.ssg.noteOn(3,'C4');
// @ts-expect-error Code uses local sample data
await opna.adpcm.loadSample('https://example.invalid/sample.wav');
// @ts-expect-error the borrowed chip clock is fixed by the editor
await opna.setClock(9000000);
// @ts-expect-error no independent factory in this Code host
createSoundChip('ym2608');
`);
    const compiler = fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url));
    try {
      execFileSync(process.execPath, [compiler, '--strict', '--noEmit', '--skipLibCheck', 'false',
        '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--lib', 'ES2022',
        join(work, 'globals.d.ts'), join(work, 'entry.ts')], {stdio:'pipe'});
    } catch (error) {
      throw new Error(error.stdout?.toString() || error.message);
    }
  } finally {
    await rm(work, {recursive:true, force:true});
  }
});
