// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {exportProject,importProject,validateProject} from './cassette.js';

test('CPS2 cassette restores the selected script, PCM tuning, shared echo and pad assignments',async()=>{
  const project = {
    version:1,active:'/examples/test.js',selected:15,
    files:[{path:'/index.js',data:''},{path:'/examples/test.js',data:'// リズム\nqsound.trigger(3,1);'}],
    channels:Array.from({length:16},(_,i)=>({sample:1,end:480,loop:90,pan:i,volume:1024,
      send:-1200,rate:3211,referenceRate:3000,note:62,referenceNote:60})),
    echo:{delay:880,feedback:-7000},pads:[0,1,2].map(i=>({sample:2-i,pan:16*i,volume:1024+i})),
  };
  assert.deepEqual(await importProject(exportProject(project)),validateProject(project));
  assert.throws(()=>exportProject({...project,active:'/missing.js'}),/missing/);
  assert.throws(()=>exportProject({...project,echo:{delay:3000,feedback:0}}),/setting/);
});
