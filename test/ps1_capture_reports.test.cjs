'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {REPORTS,ORACLE,validateReport,checkPs1CaptureReports}=require('../scripts/check_ps1_capture_reports.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const expected={checkerSha256:'a'.repeat(64),captureHelperSha256:'b'.repeat(64),archiveSha256:'c'.repeat(64)};
const spec=REPORTS[0];
function fixture(definition=spec,proof=expected){
  return {schemaVersion:definition.schemaVersion,passed:true,continuityOracle:ORACLE,physicalOutputMuted:true,listeningPerformed:false,
    checkerSha256:proof.checkerSha256,captureHelperSha256:proof.captureHelperSha256,archive:{sha256:proof.archiveSha256},clockContinuous:true,
    results:['chromium','webkit'].flatMap(browser=>['main','worker'].map(execution=>({browser,execution,physicalOutputMuted:true,
      captureContinuity:{captures:3,frames:12288,pcmContinuous:true,clockContinuous:true,clockAnomalies:[]}})))};
}

test('accepts all four browser/execution routes with current checker/helper/archive proofs',()=>{
  const result=validateReport(fixture(),spec,expected);
  assert.equal(result.pcmContinuous,true);assert.equal(result.captures,12);assert.equal(result.frames,49152);
  assert.deepEqual(result.routes,['chromium/main','chromium/worker','webkit/main','webkit/worker']);
});

test('records a renderer clock anomaly while accepting independently continuous PCM',()=>{
  const report=fixture();report.clockContinuous=false;
  report.results[2].captureContinuity.clockContinuous=false;
  report.results[2].captureContinuity.clockAnomalies=[{frames:4096,pilot:{continuous:true},clock:{continuous:false,gapCount:1}}];
  const result=validateReport(report,spec,expected);
  assert.equal(result.pcmContinuous,true);assert.equal(result.clockContinuous,false);
  assert.equal(result.clockAnomalies.length,1);assert.equal(result.clockAnomalies[0].browser,'webkit');
  assert.equal(result.clockAnomalies[0].clock.gapCount,1);
});

for(const [name,mutate,pattern]of [
  ['legacy schema',r=>r.schemaVersion=1,/legacy report schema/],
  ['failed browser test',r=>r.passed=false,/browser checks passed/],
  ['legacy clock oracle',r=>r.continuityOracle='currentFrame',/independent PCM continuity oracle/],
  ['unmuted report',r=>r.physicalOutputMuted=false,/physical output remains muted/],
  ['unmuted route',r=>r.results[0].physicalOutputMuted=false,/physical output remains muted/],
  ['listening claim',r=>r.listeningPerformed=true,/no listening is claimed/],
  ['changed checker',r=>r.checkerSha256='d'.repeat(64),/current checker SHA256/],
  ['changed capture helper',r=>r.captureHelperSha256='d'.repeat(64),/current capture helper SHA256/],
  ['different archive',r=>r.archive.sha256='d'.repeat(64),/exact packaged archive SHA256/],
  ['missing route',r=>r.results.pop(),/all four browser\/execution routes/],
  ['duplicate route',r=>r.results[1]=structuredClone(r.results[0]),/duplicate route/],
  ['unknown route',r=>r.results[0].browser='firefox',/supported route/],
  ['false PCM proof',r=>r.results[0].captureContinuity.pcmContinuous=false,/captured PCM remains continuous/],
  ['missing capture proof',r=>delete r.results[0].captureContinuity,/capture count is positive/],
  ['empty capture proof',r=>r.results[0].captureContinuity.captures=0,/capture count is positive/],
  ['empty frame proof',r=>r.results[0].captureContinuity.frames=0,/captured frame count is positive/],
  ['lost clock anomalies',r=>r.results[0].captureContinuity.clockContinuous=false,/clock anomaly summary agrees/],
  ['inconsistent top clock',r=>r.clockContinuous=false,/report and route clocks agree/],
])test('rejects '+name,()=>{const report=fixture();mutate(report);assert.throws(()=>validateReport(report,spec,expected),pattern);});

async function reportsFixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ps1-capture-reports-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const archive=path.join(directory,'playground-run.zip');await fs.writeFile(archive,'Exact archive fixture bytes');
  const archiveSha256=hash(await fs.readFile(archive));
  const captureHelperSha256=hash(await fs.readFile(path.join(__dirname,'../scripts/audio_clock_audit.cjs')));
  for(const definition of REPORTS){
    const checkerSha256=hash(await fs.readFile(path.join(__dirname,'../scripts',definition.checker)));
    await fs.writeFile(path.join(directory,definition.file),JSON.stringify(fixture(definition,{checkerSha256,captureHelperSha256,archiveSha256})));
  }
  return {directory,archive};
}

test('aggregates the four actual report paths and hashes the provided archive',async t=>{
  const {directory,archive}=await reportsFixture(t),report=await checkPs1CaptureReports({reportsDir:directory,archive});
  assert.equal(report.passed,true);assert.equal(report.reportCount,4);assert.equal(report.routeCount,16);
  assert.equal(report.captures,48);assert.equal(report.frames,196608);assert.deepEqual(report.failures,[]);
  assert(report.reports.every(value=>value.archiveSha256===report.archive.sha256));
});

test('aggregate accepts clock-only anomalies and preserves their route diagnostics',async t=>{
  const {directory,archive}=await reportsFixture(t),file=path.join(directory,REPORTS[0].file);
  const report=JSON.parse(await fs.readFile(file,'utf8'));report.clockContinuous=false;
  const proof=report.results[1].captureContinuity;proof.clockContinuous=false;
  proof.clockAnomalies=[{frames:4096,pilot:{continuous:true},clock:{continuous:false,gapCount:2}}];
  await fs.writeFile(file,JSON.stringify(report));
  const aggregate=await checkPs1CaptureReports({reportsDir:directory,archive});
  assert.equal(aggregate.passed,true);assert.equal(aggregate.pcmContinuous,true);assert.equal(aggregate.clockContinuous,false);
  assert.equal(aggregate.clockAnomalies.length,1);assert.equal(aggregate.clockAnomalies[0].report,REPORTS[0].file);
  assert.equal(aggregate.clockAnomalies[0].execution,'worker');assert.equal(aggregate.clockAnomalies[0].clock.gapCount,2);
});

test('missing reports and changed archive bytes fail aggregate proof',async t=>{
  const {directory,archive}=await reportsFixture(t);
  await fs.unlink(path.join(directory,REPORTS[0].file));await fs.appendFile(archive,' changed');
  const report=await checkPs1CaptureReports({reportsDir:directory,archive});
  assert.equal(report.passed,false);assert.equal(report.failures.length,4);
  assert(report.failures.some(failure=>failure.message.includes('ENOENT')));
  assert(report.failures.some(failure=>failure.message.includes('archive SHA256')));
});

test('CLI writes a failing diagnostic report and exits unsuccessfully',async t=>{
  const {directory,archive}=await reportsFixture(t),out=path.join(directory,'result.json');
  await fs.unlink(path.join(directory,REPORTS[3].file));
  const run=spawnSync(process.execPath,[path.join(__dirname,'../scripts/check_ps1_capture_reports.cjs'),'--reports-dir',directory,'--archive',archive,'--out',out],{encoding:'utf8'});
  assert.equal(run.status,1);const report=JSON.parse(await fs.readFile(out,'utf8'));
  assert.equal(report.passed,false);assert.equal(report.failures[0].report,REPORTS[3].file);
});

test('CLI retains a readable failure JSON when the archive is missing',async t=>{
  const {directory,archive}=await reportsFixture(t),out=path.join(directory,'missing-archive.json');await fs.unlink(archive);
  const run=spawnSync(process.execPath,[path.join(__dirname,'../scripts/check_ps1_capture_reports.cjs'),'--reports-dir',directory,'--archive',archive,'--out',out],{encoding:'utf8'});
  assert.equal(run.status,1);const report=JSON.parse(await fs.readFile(out,'utf8'));
  assert.equal(report.passed,false);assert.match(report.failures[0].message,/ENOENT/);
});
