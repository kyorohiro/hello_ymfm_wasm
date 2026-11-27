// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {QSoundPcm} from '../js/qsoundpcm.js';
import {pcmRegisterAddresses} from './registers.js';

test('register inspector follows bank rotation and preserves the raw word',()=>{
  const chip=new QSoundPcm(new Uint8Array(),48000);
  for(let ch=0;ch<16;ch++){
    const [bank,...rest]=pcmRegisterAddresses(ch);
    assert.equal(chip.lastWrites[bank],-1);
    chip.writeRegister(bank,0x8000+ch);
    assert.equal(chip.voices[ch].bank,ch);
    assert.equal(chip.lastWrites[bank],0x8000+ch);
    assert.deepEqual(rest,[1,2,3,4,5,6].map(i=>8*ch+i).concat(0x80+ch,0xba+ch));
    chip.writeRegister(bank,0);
    assert.equal(chip.lastWrites[bank],0);
  }
});
