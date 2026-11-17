// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assembleScspDsp} from '../docs/synth-scsp/dsp_assembler.js';
import {delayProgram} from '../docs/synth-scsp/dsp.js';

const root=fileURLToPath(new URL('../',import.meta.url)),
  cli=fileURLToPath(new URL('./scsp_dsp_assembler.mjs',import.meta.url)),
  fixture=join(root,'docs/synth-scsp/examples/delay.scspasm');
function run(args){
  const result=spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',timeout:15000});
  assert.equal(result.error,undefined);return result;
}
async function temporary(t){
  const dir=await mkdtemp(join(tmpdir(),'scsp-dsp-codec-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));return dir;
}

test('local CLI displays the existing Delay and losslessly assembles its editable fixture',async t=>{
  const dir=await temporary(t),words=join(dir,'words.json'),text=join(dir,'decoded.scspasm');
  const demo=run(['disassemble','--delay']);
  assert.equal(demo.status,0);assert.equal(demo.stderr,'');
  assert.match(demo.stdout,/003:.*EWT=1/);
  assert.deepEqual(assembleScspDsp(demo.stdout),delayProgram());

  const sourceBefore=await readFile(fixture),assembled=run(['assemble',fixture,'--out',words]);
  assert.equal(assembled.status,0);assert.equal(assembled.stdout,'');assert.equal(assembled.stderr,'');
  const bytesBefore=await readFile(words),data=JSON.parse(bytesBefore);
  assert.equal(data.length,512);assert.deepEqual(data,Array.from(delayProgram()));
  const decoded=run(['disassemble',words,'--out',text]);
  assert.equal(decoded.status,0);assert.equal(decoded.stdout,'');assert.equal(decoded.stderr,'');
  assert.deepEqual(assembleScspDsp(await readFile(text,'utf8')),delayProgram());
  assert.deepEqual(await readFile(words),bytesBefore);assert.deepEqual(await readFile(fixture),sourceBefore);
});

test('invalid input cannot create output, and existing or input files cannot be overwritten',async t=>{
  const dir=await temporary(t),badWords=join(dir,'bad.json'),badText=join(dir,'bad.scspasm'),output=join(dir,'output.json');
  await writeFile(badWords,JSON.stringify([65536]));
  await writeFile(badText,'000: UNKNOWN=1\n');
  for(const args of [['disassemble',badWords],['assemble',badText]]){
    const result=run([...args,'--out',output]);
    assert.notEqual(result.status,0);assert.equal(result.stdout,'');
    assert.match(result.stderr,/SCSP DSP assembler:/);
    await assert.rejects(stat(output),{code:'ENOENT'});
  }
  await writeFile(output,'keep existing bytes');
  const existing=run(['assemble',fixture,'--out',output]);
  assert.notEqual(existing.status,0);assert.equal(await readFile(output,'utf8'),'keep existing bytes');
  const source=await readFile(fixture),sameInput=join(dir,'input.scspasm');await writeFile(sameInput,source);
  const clobber=run(['assemble',sameInput,'--out',sameInput]);
  assert.notEqual(clobber.status,0);assert.deepEqual(await readFile(sameInput),source);
});

test('CLI help and malformed arguments stay bounded and do not guess an execution action',()=>{
  const help=run(['--help']);assert.equal(help.status,0);assert.match(help.stdout,/does not upload programs or start audio/);
  for(const args of [[],['upload','--delay'],['assemble','--delay'],['disassemble','--delay','--out'],
    ['disassemble','--delay','--force']]){
    const result=run(args);assert.notEqual(result.status,0);assert.equal(result.stdout,'');
    assert.match(result.stderr,/Usage:/);
  }
});
