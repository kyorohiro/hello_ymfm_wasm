// Actual shipped Web Worklets/WASM. Measurement is muted at the listening
// output and observed before FX/master. No Native device or AGC is involved.
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium,webkit}=require('playwright');
const {captureWebMix}=require('./native_backend_extra_stability.cjs');
const root=path.resolve(__dirname,'..');
const arg=name=>{const value=process.argv.find(value=>value.startsWith(name+'='));return value?.slice(name.length+1);};
const docs=path.resolve(root,arg('--root')??'docs');
const out=path.resolve(arg('--out')??'/private/tmp/playground-chip-calibration.json');
const frequencies=(arg('--frequencies')??'220,440,880').split(',').map(Number);
const kinds=arg('--kinds')?.split(',');
const verify=process.argv.includes('--verify'),onlyExtra=process.argv.includes('--extra-only');
const engine=process.argv.includes('--webkit')?'webkit':'chromium';
const baselinePath=arg('--baseline');
const primary=[
  ['genesis','ym2612'],['genesis','segapsg'],['mega-cd','rf5c164'],['genesis-full','pwm'],
  ['genesis-full-nuked','ym2612'],['genesis-full-nuked','segapsg'],
  ['pc98-26','ym2203'],['pc98','ym2608'],['neogeo','ym2610'],['neogeo-b','ym2610','ym2610b'],
  ['x68000','ym2151'],['x68000','okim6258'],['master-system','segapsg'],['master-system','ym2413'],
  ['game-gear','segapsg'],['msx','ym2413'],['msx','ay8910'],['msx-audio','y8950'],['msx-audio','ym2413'],['msx-audio','ay8910'],
  ['ym3526','ym3526'],['ym3812','ym3812'],['ymf262','ymf262'],['gameboy','gameboy'],['nes','nes'],
  ['snes','snes'],['pc-engine','huc6280'],['dx7','dx7'],
];
const accessor='\nwindow.__nativeBackendTest={runtime,selectedMode};';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);let file=path.resolve(docs,'.'+pathname);
    if(!file.startsWith(docs+path.sep))throw Error('Invalid path');if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
    let body=await fs.readFile(file);if(pathname.endsWith('/playground.js'))body=Buffer.from(body.toString()+accessor);
    res.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');res.end(body);
  }catch(error){res.writeHead(404).end(String(error));}
});
async function main(){
  if(frequencies.some(v=>![220,440,880].includes(v))||!frequencies.length)throw Error('Use reference frequencies220/440/880Hz');
  const {FM_CALIBRATION_KINDS,buildFmCalibrationReference,buildYm2610bPrimaryCalibrationReference}=await import('./soundchip_calibration_fm.mjs');
  const {PCM_CALIBRATION_KINDS,buildPcmCalibrationReference}=await import('./soundchip_calibration_pcm.mjs');
  const {probeAmplitude,deriveCalibrationGains}=await import('./soundchip_calibration_metrics.mjs');
  const all=[...FM_CALIBRATION_KINDS,...PCM_CALIBRATION_KINDS];
  if(kinds?.some(k=>!all.includes(k)))throw Error('Unknown requested calibration kind');
  const builder=(kind,hz)=>FM_CALIBRATION_KINDS.includes(kind)?buildFmCalibrationReference(kind,hz):buildPcmCalibrationReference(kind,hz);
  const selected=all.filter(k=>!kinds||kinds.includes(k));
  const baseline=baselinePath?JSON.parse(await fs.readFile(path.resolve(baselinePath),'utf8')):null;
  if(verify&&(!baseline?.passed||baseline.verify||!baseline.calibration?.targetAmplitude))throw Error('--verify requires a successful uncalibrated --baseline report');
  const routes=[...selected.map(kind=>({kind,role:'extra',mode:'genesis'})),...(!onlyExtra?primary.filter(([,kind])=>selected.includes(kind)).map(([mode,kind,accessKind])=>({kind,role:'primary',mode,accessKind:accessKind??kind})):[])];
  const report={schemaVersion:1,passed:false,engine,verify,method:'half peak-to-peak; RMS/DC/AC-RMS recorded separately',
    frequencies,rows:[],limits:['Known single-voice waveforms; not perceived loudness or polyphony normalization.',
      'SPC uses an original synthetic single-voice file to measure output units; authored file contents are not normalized.',
      'Measurements use actual Web Worklets/WASM; this runner does not open a Native audio device.']};
  if(process.argv.includes('--resume')){
    if(verify)throw Error('Verification must measure every route afresh');
    const previous=JSON.parse(await fs.readFile(out,'utf8'));
    if(previous.engine!==engine||previous.verify!==verify||JSON.stringify(previous.frequencies)!==JSON.stringify(frequencies))throw Error('Resume configuration differs');
    report.rows=previous.rows;
  }
  await fs.mkdir(path.dirname(out),{recursive:true});
  const save=()=>fs.writeFile(out,JSON.stringify(report,null,2)+'\n');
  const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}:{} )});
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.addInitScript(()=>{const Type=window.AudioContext;window.AudioContext=new Proxy(Type,{construct(Type,args){return new Type({...args[0],sampleRate:48000});}});});
  try{
    for(const route of routes){
      if(frequencies.every(hz=>report.rows.some(r=>r.kind===route.kind&&r.role===route.role&&r.mode===route.mode&&r.frequencyHz===hz)))continue;
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.setDefaultTimeout(20000);
      await page.route('**/vs/loader*.js',r=>r.abort());
      try{
        const prefix=arg('--root')?'/index.html':'/playground/index.html';
        await page.goto(`http://127.0.0.1:${server.address().port}${prefix}?mode=${route.mode}`);
        await page.waitForFunction(()=>Boolean(window.__nativeBackendTest));await page.locator('#startupNotice').waitFor({state:'hidden'});
        await page.evaluate(()=>window.__nativeBackendTest.runtime.megaDrive.audio.setListeningVolume(0));
        for(const frequencyHz of frequencies){
          if(report.rows.some(r=>r.kind===route.kind&&r.role===route.role&&r.mode===route.mode&&r.frequencyHz===frequencyHz))continue;
          const reference=route.accessKind==='ym2610b'?buildYm2610bPrimaryCalibrationReference(frequencyHz):builder(route.kind,frequencyHz);
          let setup=reference.setup;
          if(route.role==='primary'&&route.accessKind!=='ym2610b'){
            const pattern=/createSoundChip\(\s*(['"])[^'"]+\1\s*,\s*\{[^}]*\bid\s*:\s*(['"])calibration-source\2[^}]*\}\s*\)/;
            if(!pattern.test(setup))throw Error('Reference factory cannot be adapted to primary: '+route.kind);
            const existing=route.mode==='pc98'&&route.kind==='ym2608'?'fm'
              :['genesis','genesis-full-nuked'].includes(route.mode)&&route.kind==='segapsg'?'psg'
              :route.mode==='genesis-full'&&route.kind==='pwm'?'window.__nativeBackendTest.runtime.megaDrive.pwm':null;
            setup=setup.replace(pattern,existing??`useSoundChip(${JSON.stringify(route.accessKind)})`);
          }
          const sourceId=route.role==='primary'?route.accessKind:'calibration-source';
          const authored=verify?'':',volume:1';
          const code=`${setup}\ncontext.calibrationSourceId=context.calibrationSource.id??${JSON.stringify(sourceId)};\nawait mixer.set(context.calibrationSourceId,{pan:0,muted:false,solo:true${authored}});\nlog('Calibration ready');`;
          await page.evaluate(code=>window.__nativeBackendTest.runtime.playSource(code,{execution:'main'}),code);
          const mix=await page.evaluate(()=>{const s=window.__nativeBackendTest.runtime;return {id:s.context.calibrationSourceId,settings:s.megaDrive.mixer.get(s.context.calibrationSourceId)};});
          if(mix.id!==sourceId)throw Error(`Reference used ${mix.id} instead of ${sourceId}`);
          const pcm=await captureWebMix(page,.4,.2),measuredAmplitude=probeAmplitude(pcm);
          const referencePeak=reference.decodedReference?.codecHeadroom??1,amplitude=measuredAmplitude/referencePeak;
          report.rows.push({...route,frequencyHz,waveform:reference.waveform,defaultCalibration:reference.defaultCalibration!==false,
            noteInfo:reference.noteInfo,limitations:reference.limitations,referencePeak,decodedReference:reference.decodedReference??null,
            mixer:mix,pcm,measuredAmplitude,amplitude});
          if(verify){
            const original=baseline.rows.find(r=>r.kind===route.kind&&r.role===route.role&&r.mode===route.mode&&r.frequencyHz===frequencyHz);
            if(!original)throw Error('Missing baseline route');
            const gain=baseline.calibration.routes.find(r=>r.kind===route.kind&&r.role===route.role&&r.mode===route.mode)?.volume;
            const expected=original.amplitude*gain,relativeError=Math.abs(amplitude/expected-1);
            const row=report.rows.at(-1);Object.assign(row,{expectedAmplitude:expected,relativeError});
            if(!Number.isFinite(relativeError)||relativeError>.025)throw Error(`Default gain mismatch ${route.role}/${route.mode}/${route.kind}/${frequencyHz}: ${amplitude} vs ${expected}`);
          }
          await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
          if(errors.length)throw Error(errors.join('\n'));
          const text=await page.locator('#consoleOutput').innerText();if(/\b(?:Error|TypeError|RangeError|ReferenceError):/.test(text))throw Error(text);
          await save();
        }
        console.log(`${engine}: ${route.role}/${route.mode}/${route.kind} measured`);
      }finally{await page.evaluate(()=>window.__nativeBackendTest?.runtime.finalize()).catch(()=>{});await page.close();}
    }
    const levelRows=report.rows.filter(r=>r.frequencyHz===440&&r.defaultCalibration);
    if(levelRows.length&&!verify){
      const reference=levelRows.find(r=>r.kind==='ym2612'&&r.role==='primary'&&r.mode==='genesis')??levelRows.find(r=>r.kind==='ym2612');
      if(!reference)throw Error('YM2612 reference is required to derive defaults');
      report.calibration=deriveCalibrationGains(levelRows.map(r=>({kind:r.kind,role:r.role,mode:r.mode,name:r.mixer.id,amplitude:r.amplitude})),{referenceAmplitude:reference.amplitude});
    }
    report.passed=true;await save();console.log(`PASS: ${report.rows.length} real ${engine} captures; ${out}`);
  }catch(error){report.error=String(error.stack??error);await save();throw error;}
  finally{await context.close();await browser.close();}
}
server.listen(0,'127.0.0.1',()=>main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close()));
