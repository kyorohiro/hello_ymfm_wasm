// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {QSoundPcm} from '../js/qsoundpcm.js';
import {chipRomMap,intervals} from './rom-map.js';

test('ROM map retains released voices, rotated PCM banks and shared ADPCM intervals',()=>{
  const chip=new QSoundPcm(new Uint8Array(0x10400)),starts=new Uint16Array(16);
  assert.deepEqual(chipRomMap(chip,starts).voices,[]);
  starts[0]=0xff00;
  for(const [reg,word] of [[0x78,0x8001],[1,0xffa0],[4,64],[5,0],[6,0],
    [0xce,40],[0xcf,80],[0xd2,40],[0xd3,80]])chip.writeRegister(reg,word);
  assert.deepEqual(chipRomMap(chip,starts),{size:0x10400,voices:[
    {id:0,bank:1,start:0xff00,end:0,loop:64},
    {id:17,bank:0,start:40,end:80,loop:0},
    {id:18,bank:0,start:40,end:80,loop:0},
  ]});
  assert.deepEqual(intervals(0xff00,0),[[0xff00,0x10000]]);
  assert.deepEqual(intervals(65530,12),[[65530,65536],[0,12]]);
  assert.deepEqual(intervals(40,80),[[40,80]]);
  assert.deepEqual(intervals(40,40),[]);
});
