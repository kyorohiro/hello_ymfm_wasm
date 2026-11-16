// SPDX-License-Identifier: BSD-3-Clause
// Actual VGM, compressed YM and SNDH replay with every speaker route muted.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http');
const path=require('node:path'),os=require('node:os'),{pathToFileURL}=require('node:url'),{gzipSync}=require('node:zlib');
const {chromium,webkit}=require('playwright');
const root=path.resolve(__dirname,'..');
const config={root:path.join(root,'docs'),entry:'/synth-ym2149-st/index.html',engines:'chromium,webkit',out:path.join(os.tmpdir(),'ym2149-st-reference.json'),screenshots:path.join(os.tmpdir(),'ym2149-st-reference')};
for(const argument of process.argv.slice(2)){const m=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(argument);assert(m,argument);config[m[1]]=m[2];}
config.root=path.resolve(config.root);
const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.ts':'text/plain'};
const server=http.createServer(async(req,res)=>{
  try {let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name.endsWith('/'))name+='index.html';
    const file=path.resolve(config.root,'.'+name);if(!file.startsWith(config.root+path.sep)){res.writeHead(403).end();return;}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(await fs.readFile(file));
  }catch{res.writeHead(404).end();}
});
function installSilentAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,connect=AudioNode.prototype.connect,NativeWorker=window.Worker;
  const audit=window.__referenceAudit={contexts:[],meters:[],workers:[]};
  window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.Worker=class extends NativeWorker{constructor(...args){super(...args);this.auditRecord={url:String(args[0]),closed:false};audit.workers.push(this.auditRecord);}terminate(){this.auditRecord.closed=true;return super.terminate();}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser);connect.call(analyser,mute);connect.call(mute,destination);audit.meters.push({analyser,mute});return destination;
  };
  audit.level=()=>{let peak=0,sum=0,total=0,count=0;for(const {analyser}of audit.meters){const pcm=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(pcm);for(const v of pcm){peak=Math.max(peak,Math.abs(v));sum+=v*v;total+=v;count++;}}const dc=total/Math.max(1,count),rms=Math.sqrt(sum/Math.max(1,count));return{peak,rms,dc,acRms:Math.sqrt(Math.max(0,rms*rms-dc*dc))};};
}
async function main(){
  const {createYmVgmFixture,ayWrite,ayWait}=await import(pathToFileURL(path.join(root,'docs/synth-ym2149-st/vgm_test_helpers.mjs')));
  const {makeYm5Fixture,makeSndhFixture,packLhaFixture,packIceFixture}=await import(pathToFileURL(path.join(root,'docs/synth-ym2149-st/atari_test_fixtures.mjs')));
  const commands=[];for(const [r,v]of [[0,100],[1,0],[2,200],[3,0],[4,44],[5,1],[6,8],[7,0x38],[8,9],[9,7],[10,6],[11,80],[12,0],[13,10]])commands.push(...ayWrite(r,v));
  for(let n=0;n<6;n++)commands.push(...ayWait(44100));commands.push(0x66);
  const vgm=createYmVgmFixture(commands),ym=packLhaFixture(makeYm5Fixture({ticks:400}));
  const sndh=makeSndhFixture(),frms=Buffer.from(sndh).indexOf('FRMS');
  const view=new DataView(sndh.buffer);view.setUint32(frms+4,5000);view.setUint32(frms+8,6000);
  const single=createYmVgmFixture(commands,{flags:2});
  const files=[{name:'reference.vgm',bytes:vgm},{name:'reference.vgz',bytes:gzipSync(vgm)},{name:'reference.ym',bytes:ym},{name:'reference.sndh',bytes:packIceFixture(sndh)},{name:'single-output.vgm',bytes:single}];
  await fs.mkdir(config.screenshots,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,results=[];
  try{for(const engine of config.engines.split(',')){
    assert(['chromium','webkit'].includes(engine));const browser=await({chromium,webkit}[engine]).launch({headless:true});
    try{
      const context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage(),errors=[],missing=[];
      await context.addInitScript(installSilentAudit);
      await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
      page.on('pageerror',e=>errors.push(e.message));page.on('response',res=>{if(res.url().startsWith(origin)&&res.status()>=400)missing.push(res.url());});
      await page.goto(origin+config.entry);await page.waitForFunction(()=>Boolean(window.tetoricaYm2149StSynth));
      await page.waitForFunction(()=>!document.getElementById('ymFileNewButton').disabled);
      const state=()=>page.evaluate(()=>tetoricaYm2149StSynth.getSongState());
      const settings=()=>page.evaluate(()=>tetoricaYm2149StSynth.getSettings());
      const original=await settings();
      await page.locator('#ymMusicInput').setInputFiles(files.map(file=>({name:file.name,mimeType:'application/octet-stream',buffer:Buffer.from(file.bytes)})));
      await page.waitForFunction(()=>tetoricaYm2149StSynth.getSongState().loaded&&!tetoricaYm2149StSynth.getSongState().busy);
      assert.equal((await state()).format,'vgm');assert.equal(await page.evaluate(()=>__referenceAudit.contexts.length),0,'import does not request audio');
      assert.deepEqual(await settings(),original,'import keeps edited sound');
      const paths=await page.locator('#ymSongSelect option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean));
      assert.deepEqual(paths.sort(),['/music/reference.sndh','/music/reference.ym','/vgm/reference.vgm','/vgm/reference.vgz','/vgm/single-output.vgm']);
      await page.locator('#ymSongPlay').click();
      await page.waitForFunction(()=>tetoricaYm2149StSynth.getSongState().playing&&tetoricaYm2149StSynth.getSongState().positionFrames>4410,{},{timeout:8000}).catch(async error=>{
        console.error(JSON.stringify({stage:'first VGM play',state:await state(),status:await page.locator('#audioStatus').textContent(),errors,missing}));throw error;
      });
      await page.waitForFunction(()=>__referenceAudit.level().rms>0.0001);
      const vgmPCM=await page.evaluate(()=>__referenceAudit.level());
      assert.equal(await page.locator('#tonePeriod').inputValue(),'100');assert.equal(await page.locator('#tonePeriod').isDisabled(),true);
      await page.locator('#ymSongPause').click();await page.waitForFunction(()=>tetoricaYm2149StSynth.getSongState().paused);
      const paused=(await state()).positionFrames;await page.waitForTimeout(160);assert.equal((await state()).positionFrames,paused);
      await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.down('z');
      await page.waitForFunction(()=>tetoricaYm2149StSynth.getState().activeChannels.length>0);
      await page.waitForFunction(()=>__referenceAudit.level().rms>0.0001);
      assert.deepEqual(await settings(),original,'paused audition is temporary');assert.equal((await state()).positionFrames,paused);
      await page.keyboard.up('z');await page.waitForFunction(()=>tetoricaYm2149StSynth.getState().activeChannels.length===0);
      await page.locator('#ymSongCapture').click();
      await page.waitForFunction(()=>document.getElementById('ymPresetSelect').options.length>1&&!document.getElementById('ymFileNewButton').disabled);
      assert.equal((await state()).paused,true);assert.equal((await state()).positionFrames,paused);
      const captured=await settings();assert(captured.voices.every(v=>v.period===100&&v.volume===9));
      assert.equal(await page.locator('[data-channel="auto"]').getAttribute('aria-selected'),'true');
      await page.locator('[data-channel="1"]').click();
      assert.equal(await page.locator('#tonePeriod').inputValue(),'200','paused CH switch shows song, not captured patch');
      assert.deepEqual(await settings(),captured);
      await page.locator('#ymSongPause').click();await page.waitForFunction(frame=>tetoricaYm2149StSynth.getSongState().positionFrames>frame,paused);
      await page.locator('#ymSongStop').click();
      await page.locator('#ymSongSelect').selectOption('/vgm/reference.vgz');await page.waitForFunction(()=>tetoricaYm2149StSynth.getSongState().name==='reference.vgz'&&!tetoricaYm2149StSynth.getSongState().busy);
      await page.locator('#ymSongPlay').click();await page.waitForFunction(()=>tetoricaYm2149StSynth.getSongState().positionFrames>1024);
      await page.locator('#ymSongStop').click();
      await page.locator('#ymSongSelect').selectOption('/vgm/single-output.vgm');await page.waitForFunction(()=>tetoricaYm2149StSynth.getSongState().name==='single-output.vgm'&&!tetoricaYm2149StSynth.getSongState().busy);
      await page.locator('#ymSongPlay').click();await page.waitForFunction(()=>tetoricaYm2149StSynth.getSongState().positionFrames>4410);
      await page.waitForFunction(()=>__referenceAudit.level().acRms>0.0001);
      const singleOutputPCM=await page.evaluate(()=>__referenceAudit.level());assert.equal((await state()).liveState.flags,2);
      await page.locator('#ymSongPause').click();await page.waitForFunction(()=>tetoricaYm2149StSynth.getSongState().paused);
      const singlePaused=(await state()).positionFrames;await page.waitForTimeout(80);assert.equal((await state()).positionFrames,singlePaused);
      await page.locator('#ymSongPause').click();await page.waitForFunction(n=>tetoricaYm2149StSynth.getSongState().positionFrames>n,singlePaused);
      await page.locator('#ymSongStop').click();
      await page.locator('#ymSongSelect').selectOption('/music/reference.ym');await page.waitForFunction(()=>tetoricaYm2149StSynth.getSongState().format==='ym'&&!tetoricaYm2149StSynth.getSongState().busy);
      await page.locator('#ymSongPlay').click();await page.waitForFunction(()=>tetoricaYm2149StSynth.getSongState().positionFrames>4410);
      await page.waitForFunction(()=>__referenceAudit.level().rms>0.0001);const ymPCM=await page.evaluate(()=>__referenceAudit.level());
      await page.locator('#ymSongPause').click();
      await page.locator('#ymSongSeek').evaluate(input=>{input.value='.5';input.dispatchEvent(new Event('change',{bubbles:true}));});
      await page.waitForFunction(()=>tetoricaYm2149StSynth.getSongState().paused&&!tetoricaYm2149StSynth.getSongState().busy&&tetoricaYm2149StSynth.getSongState().positionFrames===22050);
      await page.locator('#ymSongSelect').selectOption('/music/reference.sndh');await page.waitForFunction(()=>tetoricaYm2149StSynth.getSongState().format==='sndh'&&!tetoricaYm2149StSynth.getSongState().busy);
      assert.equal((await state()).subsong,2);assert.equal((await state()).subsongCount,2);
      const durations=(await state()).metadata.subsongDurationFrames;
      assert.equal((await state()).durationFrames,durations[1]);
      await page.locator('#ymSubsong').selectOption('1');assert.equal((await state()).durationFrames,durations[0]);
      assert(durations[1]>durations[0]);
      await page.locator('#ymSongPlay').click();await page.waitForFunction(()=>tetoricaYm2149StSynth.getSongState().positionFrames>4410);
      await page.waitForFunction(()=>__referenceAudit.level().rms>0.0001);const sndhPCM=await page.evaluate(()=>__referenceAudit.level());
      const beforeBad=await settings(),goodName=(await state()).name;
      await page.locator('#ymMusicInput').setInputFiles({name:'broken.sndh',mimeType:'application/octet-stream',buffer:Buffer.alloc(40,0x71)});
      await page.waitForFunction(()=>document.getElementById('ymSongPanel').dataset.error==='true');
      await page.waitForTimeout(100);assert.equal((await state()).name,goodName);assert.equal((await state()).playing,true);assert.deepEqual(await settings(),beforeBad);
      assert.match(await page.locator('#ymSongStatus').textContent(),/Previous song and instrument kept/);
      await page.locator('#ymFilesPanel [data-file-path="/index.js"]').click();
      await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeRunButton').click();
      await page.waitForFunction(()=>tetoricaYm2149StSynth.getCodeState().running);
      assert.equal((await state()).playing,false,'Code stops reference playback');
      await page.locator('#ymSongPlay').click();await page.waitForFunction(()=>tetoricaYm2149StSynth.getSongState().playing);
      assert.equal(await page.evaluate(()=>tetoricaYm2149StSynth.getCodeState().running),false,'reference stops Code');
      await page.locator('#ymSongPause').click();
      await page.locator('#ymSongLive').uncheck();await page.waitForFunction(()=>!document.getElementById('tonePeriod').disabled);
      await page.locator('#ymSongLive').check();await page.waitForFunction(()=>document.getElementById('tonePeriod').disabled);
      await page.locator('#ymSongStop').click();await page.waitForTimeout(160);
      await page.waitForFunction(()=>__referenceAudit.workers.every(worker=>worker.closed));
      assert((await page.evaluate(()=>__referenceAudit.level())).rms<1e-6);
      for(const width of [1280,390,320]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(30);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${engine} ${width}`);await page.screenshot({path:path.join(config.screenshots,`${engine}-${width}.png`),fullPage:true});}
      const audit=await page.evaluate(()=>({contexts:__referenceAudit.contexts.length,speakerRoutes:__referenceAudit.meters.length,allPhysicalOutputsMuted:__referenceAudit.meters.every(m=>m.mute.gain.value===0),workers:__referenceAudit.workers}));
      assert.equal(audit.contexts,1);assert.equal(audit.speakerRoutes,1);assert(audit.allPhysicalOutputsMuted);
      assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
      results.push({engine,passed:true,vgmPCM,singleOutputPCM,singleOutputPauseResume:true,ymPCM,sndhPCM,pausedFrame:paused,pausedAudition:true,capturePreservesPause:true,subsongDurations:true,seek:true,codeExclusive:true,invalidImportKeepsSong:true,audit,errors,missing});
      await context.close();
    }finally{await browser.close();}
  }
    const result={passed:true,entry:config.entry,physicalOutputMuted:true,fixtures:'original generated VGM/VGZ including Single Output flags0x2, LHA YM5, ICE SNDH with 68000 init/play',results};
    await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
  }finally{await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
