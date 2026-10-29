import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
test('actual PS1 core manual audition removes event steps with Gaussian register playback',async t=>{
  const compiler=process.env.CXX||'c++';
  const probe=spawnSync(compiler,['--version'],{encoding:'utf8'});
  assert.equal(probe.status,0,probe.stderr||probe.error?.message);
  const temp=await mkdtemp(join(tmpdir(),'tetorica-ps1-audition-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  const build=(directory,name,extra=[])=>{
    const binary=join(temp,name),sources=['ps1_spu.cpp','spu.cpp','spu_tables.cpp','spureverb.cpp'].map(file=>join(directory,file));
    const result=spawnSync(compiler,['-std=c++17','-O2','-fwrapv','-fno-strict-aliasing','-ffp-contract=off',...extra,'-I'+directory,
      join(root,'test/helpers/ps1_audition_continuity.cpp'),...sources,'-o',binary],{encoding:'utf8',maxBuffer:4*1024*1024});
    assert.equal(result.status,0,result.stderr||result.error?.message);return binary;
  };
  // The recorded reference was actually compiled from the public SDK 0.1.6
  // before import. No checkout, network, or legacy source copy is needed here.
  const baseline=JSON.parse(await readFile(join(root,'docs/issues/ps1_live_controls_baseline_01.json'),'utf8'));
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(baseline.referenceSdk.version,'0.1.6');
  assert.equal(baseline.referenceSdk.sourceCommit,'ba2a52943f0ac43b02b57f07b48ffb8b3ccb54f6');
  assert.equal(baseline.referenceSdk.manifestSha256,'e0a86268aaa3dbbb2bf0567bf2a11925bf8da785b846b58ea4b8f71d280adfeb');
  assert.equal(hash(await readFile(join(root,baseline.fixture.path))),baseline.fixture.sha256,'the independently captured raw fixture must remain unchanged');
  const current=build(join(root,'third_party/tetorica-soundchip-native/vendor/mame-ps1-spu'),'current');
  const run=(binary,args=[],encoding)=>{
    const result=spawnSync(binary,args,{encoding,maxBuffer:8*1024*1024});
    assert.equal(result.status,0,result.stderr?.toString()||result.error?.message);return result.stdout;
  };
  const report=JSON.parse(run(current,[],'utf8'));
  assert(report.rawReleaseMaximumStep>16*report.auditionReleaseMaximumStep);
  assert(report.rawRetriggerMaximumStep>16*report.auditionRetriggerMaximumStep);
  assert.equal(report.longAndInfiniteReleasePreserved,true);assert.equal(report.otherVoiceBitExact,true);
  assert.equal(report.partitionInvariant,true);assert.equal(report.resetCancelsPendingOn,true);
  const raw=run(current,['--raw']);
  assert.equal(raw.length,baseline.capture.bytes);assert.equal(raw.length,8*8*8985);
  // The immutable 0.1.6 capture used linear interpolation. Gaussian output is
  // intentionally different; specification-based sample oracles live in
  // ps1_spu.test.mjs and the SDK native fixture, rather than a replacement hash.
  assert.notEqual(hash(raw),baseline.capture.sha256,'Gaussian default changes the historical linear PCM');
  assert.deepEqual(run(current,['--raw']),raw,'raw register playback is deterministic');
  t.diagnostic(JSON.stringify({...report,gaussianRawStereoFrames:raw.length/8,gaussianRawSha256:hash(raw)}));
});
