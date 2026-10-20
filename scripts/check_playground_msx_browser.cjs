// Real MSX / MSX-AUDIO Playground, two/three Worklets, Keyboard and PCM.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const docs=path.resolve(__dirname,'../docs');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    let file=path.resolve(docs,'.'+pathname);if(!file.startsWith(docs+path.sep))throw Error('Outside docs');
    if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
    let body=await fs.readFile(file);
    if(pathname.endsWith('/playground.js'))body=Buffer.from(body+'\nwindow.__msxCheck={runtime,megaDrive,operatorKeyboard,setBottomTab,editorAdapter};');
    res.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');res.end(body);
  }catch(e){res.writeHead(404).end(e.message);}
});
const panel='#ay8910Panel',control=name=>`${panel} [data-chip-control="ay-${name}"]`,action=name=>`${panel} [data-chip-action="ay-${name}"]`;
const read=(page,chip='ay8910')=>page.evaluate(chip=>window.__msxCheck.runtime.chipInspector.read(chip),chip);
async function until(page,chip,test,label){
  const end=Date.now()+8000;let state;
  while(Date.now()<end){state=await read(page,chip);if(test(state))return state;await page.waitForTimeout(40);}
  throw Error(label+': '+JSON.stringify(state));
}
async function field(page,selector,value){await page.locator(selector).evaluate((node,value)=>{
  if(node.type==='checkbox')node.checked=Boolean(value);else node.value=String(value);
  node.dispatchEvent(new Event('change',{bubbles:true}));
},value);}
async function meters(page){await page.evaluate(()=>{
  const {megaDrive}=window.__msxCheck,context=megaDrive.audioContext,split=context.createChannelSplitter(2),silent=context.createGain();
  silent.gain.value=0;silent.connect(context.destination);
  const meters=[context.createAnalyser(),context.createAnalyser()];
  meters.forEach((meter,i)=>{meter.fftSize=8192;split.connect(meter,i);meter.connect(silent);});
  megaDrive.audio.connectOutputMonitor(split);
  window.__msxCheck.measure=()=>meters.map(meter=>{
    const pcm=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(pcm);
    const mean=pcm.reduce((s,x)=>s+x,0)/pcm.length,crossings=[];
    for(let i=1;i<pcm.length;i++)if(pcm[i-1]<mean&&pcm[i]>=mean)crossings.push(i-1+(mean-pcm[i-1])/(pcm[i]-pcm[i-1]));
    return {rms:Math.sqrt(pcm.reduce((s,x)=>s+(x-mean)**2,0)/pcm.length),peak:Math.max(...pcm.map(Math.abs)),finite:pcm.every(Number.isFinite),hz:crossings.length>2?(crossings.length-1)*context.sampleRate/(crossings.at(-1)-crossings[0]):0};
  });
});}
const measure=page=>page.evaluate(()=>window.__msxCheck.measure());
async function audible(page){await page.waitForFunction(()=>window.__msxCheck.measure().every(v=>v.rms>.0002),null,{timeout:6000});const pcm=await measure(page);assert(pcm.every(v=>v.finite&&v.peak<.99));return pcm;}
async function pitch(page,hz=440){
  await page.waitForTimeout(350);let pcm;const end=Date.now()+5000;
  do{pcm=await measure(page);if(pcm.every(v=>v.rms>.0002&&Math.abs(v.hz-hz)<3))break;await page.waitForTimeout(80);}while(Date.now()<end);
  assert(pcm.every(v=>v.finite&&v.peak<.99&&v.rms>.0002&&Math.abs(v.hz-hz)<3),JSON.stringify(pcm));
  assert(Math.abs(pcm[0].rms-pcm[1].rms)<Math.max(pcm[0].rms,pcm[1].rms)*.05,'Each MSX chip reaches both mono outputs');return pcm[0].hz;
}
async function silent(page){await page.waitForTimeout(260);await page.waitForFunction(()=>window.__msxCheck.measure().every(v=>v.peak<.0001),null,{timeout:6000});}
async function stop(page){await page.click('#stopButton');await page.waitForFunction(()=>window.__msxCheck.runtime.getState().playback==='stopped');await silent(page);}
const play=(page,source,execution)=>page.evaluate(({source,execution})=>window.__msxCheck.runtime.playSource(source,{execution}),{source,execution});
async function keyboard(page,chip,ch){
  await page.evaluate(()=>window.__msxCheck.setBottomTab('keyboard'));
  await page.locator('#operatorKeyboardRoot button').filter({hasText:/^Ukulele$/}).click();
  await page.selectOption('#playgroundKeyboardChip',`chip:${chip}`);await page.selectOption('#playgroundKeyboardTargetChannel',String(ch));
}
async function key(page,type){await page.evaluate(type=>{
  const button=[...document.querySelectorAll('#operatorKeyboardRoot .key')].find(node=>node.querySelector('span')?.textContent==='A4');
  if(!button)throw Error('A4 is absent from Ukulele Keyboard');const key=button.dataset.key,code=/^\d$/.test(key)?`Digit${key}`:`Key${key.toUpperCase()}`;
  document.body.dispatchEvent(new KeyboardEvent(type,{key,code,bubbles:true,cancelable:true}));
},type);}
async function isolate(page,id){await page.evaluate(id=>{for(const entry of window.__msxCheck.megaDrive.mixer.list())window.__msxCheck.megaDrive.mixer.set(entry.id,{muted:entry.id!==id});},id);}
const quiet='ay.allNotesOff();opll.allNotesOff();opl.allNotesOff();opll.setRhythm({enabled:false});';
const setup=`ay.setVoice(0,{tone:true,noise:false,volume:9,envelope:false});ay.setVoice(2,{tone:true,noise:false,volume:9,envelope:false});opll.setUserPatch(OPLL_USER_PRESETS.sine);for(const ch of [0,8])opll.setVoice(ch,{instrument:0,attenuation:4,sustain:false});for(const ch of [0,8])opl.setPreset(ch,OPL_PRESETS.sine);`;
async function checkMsx(page,base,name){
  await page.goto(base+'?mode=msx&no-sw=1');await page.waitForFunction(()=>window.__msxCheck&&window.monaco?.editor?.getEditors().length);
  assert.equal(await page.evaluate(()=>window.__msxCheck.megaDrive.audioContext),null,'Opening MSX is lazy');
  for(const kind of ['ay8910','ym2413'])assert(await page.locator(`#${kind}Tab`).isVisible(),kind+' tab');
  assert(!await page.locator('#y8950Tab').isVisible(),'MSX has no MSX-AUDIO FM tab');
  assert(!await page.locator('#operatorTab').isVisible(),'MSX has no hidden Genesis FM');
  assert.equal(await page.locator('#playgroundMode').inputValue(),'msx');
  const starter=await page.evaluate(()=>window.__msxCheck.editorAdapter.getValue());
  assert.match(starter,/ay\./);assert.match(starter,/opll\./);assert.doesNotMatch(starter,/\bopl\./,'MSX starter does not require the audio expansion');
  await page.click('#runButton');await page.waitForFunction(()=>window.__msxCheck.megaDrive.isReady());await meters(page);await audible(page);await stop(page);
  const chips=await page.evaluate(()=>window.__msxCheck.runtime.chipInspector.list().map(c=>c.kind).sort());
  const strips=await page.evaluate(()=>window.__msxCheck.megaDrive.mixer.list().map(e=>e.id).sort());
  assert.deepEqual(chips,['ay8910','ym2413']);assert.deepEqual(strips,['ay8910','ym2413']);
  const results=[];
  for(const execution of ['main','worker']){
    await play(page,`ay.allNotesOff();opll.allNotesOff();opll.setRhythm({enabled:false});if(typeof opl!=='undefined'||typeof fm!=='undefined')throw Error('MSX has an implicit OPL/OPN');const a=await useSoundChip('ay8910'),b=await useSoundChip('ym2413');if(a.id!=='ay8910'||b.id!=='ym2413'||a.dispose||b.dispose)throw Error('MSX primary borrowing');if(OPLL_INSTRUMENTS.length!==16)throw Error('OPLL metadata');await livePrepare('msx-dual-prepare',({ay,opll,opl,fm})=>{if(!ay||!opll||opl||fm)throw Error('MSX livePrepare device set');});ay.setVoice(0,{tone:true,noise:false,volume:9,envelope:false});ay.setVoice(2,{tone:true,noise:false,volume:9,envelope:false});opll.setUserPatch(OPLL_USER_PRESETS.sine);for(const ch of [0,8])opll.setVoice(ch,{instrument:0,attenuation:4,sustain:false});console.log('MSX_DUAL_GLOBALS_OK');liveLoop('msx-dual-browser',async()=>{ay.noteOn(0,'A4');opll.noteOn(0,'A4');await sleep(60);});`,execution);
    for(const chip of strips)await until(page,chip,s=>s.channels[0].active,execution+' MSX '+chip);
    const frequencies={};for(const chip of strips){await isolate(page,chip);frequencies[chip]=await pitch(page);}
    assert.deepEqual((await page.evaluate(()=>window.__msxCheck.runtime.chipInspector.list())).map(c=>c.kind).sort(),chips,'Borrowing keeps exactly two physical chips');
    await stop(page);
    for(const[chip,ch]of[['ay8910',2],['ym2413',8]]){
      await isolate(page,chip);await keyboard(page,chip,ch);await key(page,'keydown');await until(page,chip,s=>s.channels[ch].active,execution+' MSX Keyboard '+chip);await pitch(page);await key(page,'keyup');await silent(page);
    }
    assert.equal(await page.locator('#playgroundKeyboardChip option[value="chip:y8950"]').count(),0,'MSX Keyboard does not offer an absent Y8950');
    assert.match(await page.locator('#consoleOutput').textContent(),/MSX_DUAL_GLOBALS_OK/);results.push({execution,frequencies});
  }
  await page.click('#ay8910Tab');await page.locator(control('volume')).waitFor();
  await page.screenshot({path:`/private/tmp/msx-${name}-panel.png`,fullPage:true});
  return{chips:strips,results,noImplicitOpl:true,keyboard:true};
}
async function checkMsxAudio(page,base,name){
  await page.goto(base+'?mode=msx-audio&no-sw=1');await page.waitForFunction(()=>window.__msxCheck&&window.monaco?.editor?.getEditors().length);
  assert.equal(await page.evaluate(()=>window.__msxCheck.megaDrive.audioContext),null,'Opening MSX-AUDIO is lazy');
  assert.equal(await page.locator('#playgroundMode').inputValue(),'msx-audio');
  for(const kind of ['ay8910','ym2413','y8950'])assert(await page.locator(`#${kind}Tab`).isVisible(),kind+' tab');
  assert(!await page.locator('#operatorTab').isVisible(),'MSX has no hidden Genesis FM');
  assert.match(await page.evaluate(()=>window.__msxCheck.editorAdapter.getValue()),/ay\./,'Fresh MSX starter');
  await page.click('#runButton');await page.waitForFunction(()=>window.__msxCheck.megaDrive.isReady());await meters(page);await audible(page);await stop(page);
  const chips=await page.evaluate(()=>window.__msxCheck.runtime.chipInspector.list());
  assert.deepEqual(chips.map(c=>c.kind).sort(),['ay8910','y8950','ym2413']);
  const strips=await page.evaluate(()=>window.__msxCheck.megaDrive.mixer.list().map(e=>e.id).sort());assert.deepEqual(strips,['ay8910','y8950','ym2413']);
  const results=[];
  for(const execution of ['main','worker']){
    await play(page,quiet+setup+`const a=await useSoundChip('ay8910'),b=await useSoundChip('ym2413'),c=await useSoundChip('y8950');if(a.id!=='ay8910'||b.id!=='ym2413'||c.id!=='y8950'||a.dispose||b.dispose||c.dispose)throw Error('MSX primary borrowing');if(OPLL_INSTRUMENTS.length!==16)throw Error('OPLL metadata');await livePrepare('msx-native',({ay,opll,opl})=>{if(!ay||!opll||!opl)throw Error('MSX livePrepare');});console.log('MSX_GLOBALS_OK');liveLoop('msx-trio',async()=>{ay.noteOn(0,'A4');opll.noteOn(0,'A4');opl.noteOn(0,'A4');await sleep(60);});`,execution);
    for(const chip of ['ay8910','ym2413','y8950'])await until(page,chip,s=>s.channels[0].active,execution+' '+chip);
    const frequencies={};for(const chip of strips){await isolate(page,chip);frequencies[chip]=await pitch(page);}
    await stop(page);
    for(const [chip,ch]of [['ay8910',2],['ym2413',8],['y8950',8]]){
      await isolate(page,chip);await keyboard(page,chip,ch);await key(page,'keydown');await until(page,chip,s=>s.channels[ch].active,execution+' Keyboard '+chip);await pitch(page);
      await key(page,'keyup');await silent(page);
    }
    assert.match(await page.locator('#consoleOutput').textContent(),/MSX_GLOBALS_OK/);results.push({execution,frequencies});
  }
  await page.evaluate(()=>{for(const entry of window.__msxCheck.megaDrive.mixer.list())window.__msxCheck.megaDrive.mixer.set(entry.id,{muted:false});});
  await page.click('#ay8910Tab');await page.click(`${panel} [data-chip-channel="0"]`);await page.click(action('basic'));
  await field(page,control('volume'),9);await field(page,control('frequency'),440);await field(page,control('noise'),true);await field(page,control('noise-period'),8);
  await until(page,'ay8910',s=>s.channels[0].toneEnabled&&s.channels[0].noiseEnabled&&s.noise.period===8,'AY shared noise and mixed gates');
  await field(page,control('envelope-period'),2000);await field(page,control('envelope-shape'),10);await field(page,control('envelope'),true);
  await until(page,'ay8910',s=>s.channels[0].configuredEnvelope&&s.envelope.period===2000&&s.envelope.shape===10,'AY hardware envelope');
  await page.click(action('envelope-retrigger'));await page.click(action('play'));await audible(page);await silent(page);
  const saved=await read(page);await stop(page);const stopped=await read(page);
  assert.deepEqual(stopped.noise,saved.noise);assert.deepEqual(stopped.envelope,saved.envelope);assert.equal(stopped.channels[0].configuredEnvelope,true);
  await page.screenshot({path:`/private/tmp/msx-audio-${name}-panel.png`,fullPage:true});
  await page.goto(base+'?mode=master-system&no-sw=1');await page.waitForFunction(()=>window.__msxCheck&&window.monaco?.editor?.getEditors().length);
  assert(!await page.locator('#ay8910Tab').isVisible(),'Master System does not acquire AY');
  await page.click('#ym2413Tab');await page.click('#ym2413Panel [data-chip-action="prepare"]');
  await page.waitForFunction(()=>window.__msxCheck.megaDrive.isReady()&&window.__msxCheck.runtime.chipInspector.list().length===2);
  assert.deepEqual((await page.evaluate(()=>window.__msxCheck.runtime.chipInspector.list())).map(c=>c.kind).sort(),['segapsg','ym2413']);
  return {chips:strips,results,ayPanel:true,masterSystemUnchanged:true};
}
async function checkLegacyAudioAlias(page,base){
  await page.goto(base+'?mode=y8950&no-sw=1');await page.waitForFunction(()=>window.__msxCheck&&window.monaco?.editor?.getEditors().length);
  assert.equal(await page.locator('#playgroundMode').inputValue(),'msx-audio','Legacy Y8950 mode links resolve to MSX-AUDIO');
  for(const kind of ['ay8910','ym2413','y8950'])assert(await page.locator(`#${kind}Tab`).isVisible());
  await page.click('#ay8910Tab');await page.click(`${panel} [data-chip-action="prepare"]`);
  await page.waitForFunction(()=>window.__msxCheck.megaDrive.isReady()&&window.__msxCheck.runtime.chipInspector.list().length===3);
  assert.deepEqual((await page.evaluate(()=>window.__msxCheck.runtime.chipInspector.list())).map(c=>c.kind).sort(),['ay8910','y8950','ym2413']);
  return true;
}
(async()=>{
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base=`http://127.0.0.1:${server.address().port}/playground/index.html`,engines=process.argv.includes('--chromium')?{chromium}:process.argv.includes('--webkit')?{webkit}:{chromium,webkit};
    for(const[name,type]of Object.entries(engines)){
      const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}:{})});
      try{
        const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1600,height:1100}}),errors=[],missing=[];
        page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()===404)missing.push(r.url());});page.setDefaultTimeout(15000);
        const msx=await checkMsx(page,base,name),msxAudio=await checkMsxAudio(page,base,name),legacyAudioAlias=await checkLegacyAudioAlias(page,base);
        assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);console.log(JSON.stringify({browser:name,passed:true,msx,msxAudio,legacyAudioAlias}));
      }finally{await browser.close();}
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
