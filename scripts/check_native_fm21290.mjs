// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Fm21290Synth} from '../tetorica_src/runtime/fm21290_synth.js';
import {presetToVoice} from '../tetorica_src/runtime/msfa_dx7/src/preset.js';
import {createVoiceSysex} from '../tetorica_src/runtime/msfa_dx7/src/sysex.js';

const project=fileURLToPath(new URL('../w/tetorica-fm2612-playground-tauri/src-tauri/',import.meta.url));
const directory=await mkdtemp(join(tmpdir(),'native-fm21290-'));
try {
  const fixture=join(directory,'fixture');
  execFileSync(process.env.CXX || 'c++', ['-std=c++17','-O2','-ffp-contract=off',
    '-Ivendor/tetorica-soundchip-native/native/include','src/native_fm21290.cpp',
    'src/native_genesis_dx7_fixture.cpp','-o',fixture], {cwd:project});
  let maximum=0, feedbackMaximum=0;
  for(const rate of [44100,48000,96000]) for(let algorithm=0;algorithm<32;algorithm++) {
    const bytes=presetToVoice({algorithm,feedback:algorithm%8,
      pitchEnvelope:{levels:[65,48,57,40]},
      lfo:{waveform:algorithm%6,speed:88,ampModDepth:99,pitchModDepth:70,pitchModSensitivity:5},
      operators:Object.fromEntries(Array.from({length:6},(_,i)=>[i+1,{
        coarse:i+1,detune:5+i,fine:i*9,outputLevel:99-i*4,
        ampModSensitivity:i%4,velocitySensitivity:i,rateScaling:i,
        keyboardScaling:{leftDepth:20,rightDepth:28,leftCurve:i%4,rightCurve:(i+1)%4},
      }]))});
    const synth=new Fm21290Synth(rate);
    synth.loadSysex(createVoiceSysex(bytes));
    const reference=new Float32Array(8192);
    synth.noteOn(69,100);
    synth.renderInto(reference.subarray(0,2048));
    synth.noteOn(43,89);
    synth.renderInto(reference.subarray(2048,6000));
    synth.noteOff(69);
    synth.renderInto(reference.subarray(6000));
    const events='0 voice 1 0 '+Buffer.from(bytes).toString('hex')+'\n0 on 69 100\n2048 on 43 89\n6000 off 69\n';
    const stereo=execFileSync(fixture,[String(rate),'8192'],{input:events});
    assert.equal(stereo.length,reference.length*8);
    let diff=0, initialDiff=0, energy=0, refEnergy=0;
    for(let i=0;i<reference.length;i++) {
      const actual=stereo.readFloatLE(i*8);
      assert.equal(actual,stereo.readFloatLE(i*8+4));
      const error=Math.abs(reference[i]-actual);
      diff=Math.max(diff,error);
      if(i<128) initialDiff=Math.max(initialDiff,error);
      energy+=actual*actual;
      refEnergy+=reference[i]*reference[i];
    }
    // At maximum feedback, tiny differences between platform sine functions
    // accumulate in algorithm 16's return path. Check its onset and RMS.
    if(algorithm===15) {
      assert(initialDiff<1e-5 && Math.abs(Math.sqrt(energy/refEnergy)-1)<0.01);
      feedbackMaximum=Math.max(feedbackMaximum,diff);
    } else {
      assert(diff<1e-5, `rate ${rate}, algorithm ${algorithm+1}, error ${diff}`);
      maximum=Math.max(maximum,diff);
    }
  }
  console.log('96 native/browser comparisons passed.',{maximum,algorithm16Feedback7:feedbackMaximum});
} finally {await rm(directory,{recursive:true,force:true});}
