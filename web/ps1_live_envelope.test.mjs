import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
test('actual PS1 core edits ADSR in each running stage without resetting sample phase or level',async t=>{
  const compiler=process.env.CXX||'c++',probe=spawnSync(compiler,['--version'],{encoding:'utf8'});
  if(probe.error?.code==='ENOENT'){t.skip('C++ compiler unavailable');return;}
  assert.equal(probe.status,0,probe.stderr||probe.error?.message);
  const temp=await mkdtemp(join(tmpdir(),'tetorica-ps1-live-envelope-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  const directory=join(root,'third_party/tetorica-soundchip-native/vendor/mame-ps1-spu'),binary=join(temp,'live-envelope');
  const sources=['ps1_spu.cpp','spu.cpp','spu_tables.cpp','spureverb.cpp'].map(file=>join(directory,file));
  const built=spawnSync(compiler,['-std=c++17','-O2','-fwrapv','-fno-strict-aliasing','-ffp-contract=off','-I'+directory,
    join(root,'test/helpers/ps1_live_envelope.cpp'),...sources,'-o',binary],{encoding:'utf8',maxBuffer:4*1024*1024});
  assert.equal(built.status,0,built.stderr||built.error?.message);
  const result=spawnSync(binary,[],{encoding:'utf8',maxBuffer:4*1024*1024});
  assert.equal(result.status,0,result.stderr||result.error?.message);
  const report=JSON.parse(result.stdout);for(const [key,value] of Object.entries(report))if(key!=='sweepFrames')assert.equal(value,true,key);
  assert.equal(report.sweepFrames,11072);t.diagnostic(JSON.stringify(report));
});
