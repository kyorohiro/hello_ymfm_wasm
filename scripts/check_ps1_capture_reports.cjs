'use strict';

// Aggregate the four packaged PS1 checks without conflating renderer clocks
// with the independently captured PCM sample sequence.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');

const REPORTS=Object.freeze([
  {file:'ps1-mode-browser.json',checker:'check_playground_ps1_browser.cjs',schemaVersion:2},
  {file:'ps1-adpcm-browser.json',checker:'check_ps1_adpcm_encoder_browser.cjs',schemaVersion:2},
  {file:'ps1-voice-editor-browser.json',checker:'check_ps1_voice_editor_browser.cjs',schemaVersion:3},
  {file:'ps1-sample-editor-browser.json',checker:'check_ps1_sample_editor_browser.cjs',schemaVersion:2},
]);
const ORACLE='independent-24-bit-pilot-PCM';
const ROUTES=['chromium/main','chromium/worker','webkit/main','webkit/worker'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

function validateReport(report,spec,expected){
  const label=spec.file;
  assert(Number.isSafeInteger(report.schemaVersion)&&report.schemaVersion>=spec.schemaVersion,label+': legacy report schema');
  assert.equal(report.passed,true,label+': browser checks passed');
  assert.equal(report.continuityOracle,ORACLE,label+': independent PCM continuity oracle');
  assert.equal(report.physicalOutputMuted,true,label+': physical output remains muted');
  assert.equal(report.listeningPerformed,false,label+': no listening is claimed');
  assert.equal(report.checkerSha256,expected.checkerSha256,label+': current checker SHA256');
  assert.equal(report.captureHelperSha256,expected.captureHelperSha256,label+': current capture helper SHA256');
  assert.equal(report.archive?.sha256,expected.archiveSha256,label+': exact packaged archive SHA256');
  assert(Array.isArray(report.results),label+': route results are required');
  assert.equal(report.results.length,ROUTES.length,label+': all four browser/execution routes');
  const routes=[],clockAnomalies=[];
  let captures=0,frames=0;
  for(const result of report.results){
    const route=result.browser+'/'+result.execution,proof=result.captureContinuity;
    assert(ROUTES.includes(route),label+': supported route '+route);
    assert(!routes.includes(route),label+': duplicate route '+route);routes.push(route);
    assert.equal(result.physicalOutputMuted,true,label+'/'+route+': physical output remains muted');
    assert(proof&&Number.isSafeInteger(proof.captures)&&proof.captures>0,label+'/'+route+': capture count is positive');
    assert(Number.isSafeInteger(proof.frames)&&proof.frames>0,label+'/'+route+': captured frame count is positive');
    assert.equal(proof.pcmContinuous,true,label+'/'+route+': captured PCM remains continuous');
    assert.equal(typeof proof.clockContinuous,'boolean',label+'/'+route+': clock continuity is recorded separately');
    assert(Array.isArray(proof.clockAnomalies),label+'/'+route+': clock anomalies are retained');
    assert.equal(proof.clockAnomalies.length===0,proof.clockContinuous,label+'/'+route+': clock anomaly summary agrees');
    captures+=proof.captures;frames+=proof.frames;
    for(const anomaly of proof.clockAnomalies)clockAnomalies.push({...anomaly,report:label,browser:result.browser,execution:result.execution});
  }
  const clockContinuous=report.results.every(result=>result.captureContinuity.clockContinuous);
  assert.equal(report.clockContinuous,clockContinuous,label+': report and route clocks agree');
  return {file:label,schemaVersion:report.schemaVersion,checker:spec.checker,checkerSha256:report.checkerSha256,
    captureHelperSha256:report.captureHelperSha256,archiveSha256:report.archive.sha256,
    routes:routes.sort(),captures,frames,pcmContinuous:true,clockContinuous,clockAnomalies};
}

async function checkPs1CaptureReports({reportsDir,archive}){
  const failures=[],reports=[];
  const archiveBytes=await fs.readFile(archive),archiveSha256=hash(archiveBytes);
  const captureHelperSha256=hash(await fs.readFile(path.join(__dirname,'audio_clock_audit.cjs')));
  for(const spec of REPORTS){
    try{
      const report=JSON.parse(await fs.readFile(path.join(reportsDir,spec.file),'utf8'));
      const checkerSha256=hash(await fs.readFile(path.join(__dirname,spec.checker)));
      reports.push(validateReport(report,spec,{archiveSha256,captureHelperSha256,checkerSha256}));
    }catch(error){failures.push({report:spec.file,message:error.message});}
  }
  return {schemaVersion:1,kind:'packaged-ps1-capture-checks',passed:failures.length===0,
    continuityOracle:ORACLE,pcmContinuous:failures.length===0,
    clockContinuous:failures.length===0&&reports.every(report=>report.clockContinuous),
    physicalOutputMuted:failures.length===0,listeningPerformed:false,
    archive:{path:path.resolve(archive),bytes:archiveBytes.length,sha256:archiveSha256},captureHelperSha256,
    reportCount:reports.length,routeCount:reports.reduce((sum,report)=>sum+report.routes.length,0),
    captures:reports.reduce((sum,report)=>sum+report.captures,0),frames:reports.reduce((sum,report)=>sum+report.frames,0),
    clockAnomalies:reports.flatMap(report=>report.clockAnomalies),reports,failures};
}

async function main(args){
  const options={},usage='Usage: node scripts/check_ps1_capture_reports.cjs --reports-dir DIR --archive ZIP --out JSON';
  for(let index=0;index<args.length;index++){
    if(args[index]==='--help'){console.log(usage);return;}
    const match=args[index].match(/^--(reports-dir|archive|out)(?:=(.*))?$/);assert(match,usage);
    const value=match[2]??args[++index];assert(value&&!value.startsWith('--'),usage);
    assert(!options[match[1]],'Duplicate '+match[1]);options[match[1]]=path.resolve(value);
  }
  assert(options['reports-dir']&&options.archive&&options.out,usage);
  let report;
  try{report=await checkPs1CaptureReports({reportsDir:options['reports-dir'],archive:options.archive});}
  catch(error){report={schemaVersion:1,kind:'packaged-ps1-capture-checks',passed:false,failures:[{message:error.message}]};}
  await fs.mkdir(path.dirname(options.out),{recursive:true});await fs.writeFile(options.out,JSON.stringify(report,null,2)+'\n');
  if(!report.passed){console.error('PS1 capture report validation failed: '+JSON.stringify(report.failures));process.exitCode=1;return;}
  console.log(`PS1 capture reports passed: ${report.reportCount} reports, ${report.routeCount} routes, ${report.captures} captures / ${report.frames} frames; clock anomalies: ${report.clockAnomalies.length}.`);
}

module.exports={REPORTS,ORACLE,validateReport,checkPs1CaptureReports};
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(error.stack??error);process.exitCode=1;});
