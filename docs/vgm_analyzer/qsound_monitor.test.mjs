import assert from 'node:assert/strict';
import test from 'node:test';
import {demoVgm,demoRom,noteWrites} from '../synth-cps2/demo.js';
import {createQSoundCursor} from './qsound_monitor.js';

test('PCM inspection follows the audible tick and maps the wrapped CH1 bank register',()=>{
  const bytes=demoVgm([{t:0,writes:noteWrites(0,60,0,16,1000)},
    {t:100,writes:noteWrites(0,60,0,16,1000,4096,0x8020,16,2,0x8000)},
    {t:200,writes:[]}]);
  const cursor=createQSoundCursor(bytes),voice=cursor.chip.voices[0];
  assert(cursor.seek(99,false));assert.equal(voice.end,256);
  assert.deepEqual(cursor.chip.rom,demoRom());
  assert(cursor.seek(100,false));
  assert.deepEqual([voice.bank,voice.address&65535,voice.end&65535,voice.loop],[2,0x8000,0x8020,16]);
  assert(cursor.seek(100,false));assert.equal(voice.address&65535,0x8000);
});
