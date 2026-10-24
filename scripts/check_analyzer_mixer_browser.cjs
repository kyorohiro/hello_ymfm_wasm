// Full Analyzer UI with real playback engines/AudioWorklet; final output muted.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const repository=path.resolve(__dirname,'..');
const argumentsList=process.argv.slice(2);
if(argumentsList.includes('--help')) {
  console.log('Usage: node scripts/check_analyzer_mixer_browser.cjs [--root=docs-or-packaged-analyzer] [--chromium-only]');
  process.exit(0);
}
for(const argument of argumentsList)if(!argument.startsWith('--root=')&&argument!=='--chromium-only')throw Error(`Unknown argument: ${argument}`);
const docs=path.resolve(repository,argumentsList.find(value=>value.startsWith('--root='))?.slice(7)??'docs');
const preferencesKey='tetorica-vgm-analyzer.audio.v1';
let analyzerPath;
const hook=`
// Test-only observation and output sink, appended by the local test server.
let __mixerConfiguration=null,__mixerFrames=0,__mixerWorkletStarts=0;
const __mixerObserved=new WeakSet(),__mixerSilentOutputs=new WeakMap();
const __mixerLoad=mixerUi.load;
mixerUi.load=configuration=>{__mixerConfiguration=configuration;return __mixerLoad(configuration);};
const __mixerAttach=mixerUi.attach;
mixerUi.attach=mixer=>{
  if(engine&&!__mixerObserved.has(engine)) {
    __mixerObserved.add(engine);const render=engine.processFrames.bind(engine);
    engine.processFrames=frames=>{const pcm=render(frames);__mixerFrames+=frames;return pcm;};
  }
  return __mixerAttach(mixer);
};
const __mixerRewire=rewireAudioGraph;
rewireAudioGraph=()=>{
  __mixerRewire();
  const node=effectSettings.enabled?effectsChain?.output:activeStream?.node;
  if(!node||!audioContext)return;
  let sink=__mixerSilentOutputs.get(audioContext);
  if(!sink){sink=audioContext.createGain();sink.gain.value=0;sink.connect(audioContext.destination);__mixerSilentOutputs.set(audioContext,sink);}
  node.disconnect();node.connect(sink);
};
const __mixerStartWorklet=startWorkletStream;
startWorkletStream=async(...args)=>{const result=await __mixerStartWorklet(...args);if(result)__mixerWorkletStarts++;return result;};
window.__analyzerMixerTest={mixerUi,audioPreferences,getEngine:()=>engine,getConfig:()=>__mixerConfiguration,
  snapshot:()=>({file:lastLoadedFileName,configuration:__mixerConfiguration,
    preferences:Object.fromEntries((__mixerConfiguration?.chips??[]).map(({id})=>[id,audioPreferences.getChip(id,__mixerConfiguration)])),
    mixer:engine?.playbackMixer?Object.fromEntries([...engine.playbackMixer.strips.keys()].map(id=>[id,engine.playbackMixer.get(id)])):null,
    master:masterVolume,effect:audioPreferences.getEffect(),renderedFrames:__mixerFrames,workletStarts:__mixerWorkletStarts,
    saved:localStorage.getItem('${preferencesKey}'),writes:window.__analyzerAudioWrites??[]})};
`;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm'};
const server=http.createServer(async(request,response)=>{
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://local').pathname);
    if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    let filename=path.resolve(docs,'.'+pathname);
    if(filename!==docs&&!filename.startsWith(docs+path.sep))throw Error('Outside test root');
    if((await fs.stat(filename)).isDirectory())filename=path.join(filename,'index.html');
    let body=await fs.readFile(filename);
    if(filename===path.join(docs,analyzerPath,'vgm_analyzer.js'))body=Buffer.concat([body,Buffer.from(hook)]);
    response.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');response.end(body);
  } catch(error){response.writeHead(404).end(error.message);}
});

const expected={
  'genesis-pcm.vgz':{ym2612:.862153,psg:1.840254,rf5c164:.280286},
  'gameboy-tone.vgm':{gameBoyDmg:.515271},
  'nes-tone.vgm':{nesApu:1.981272},
  'y8950-psg.vgz':{y8950:1.03357,psg:.644089},
};
const snapshot=page=>page.evaluate(()=>window.__analyzerMixerTest.snapshot());
const saved=state=>state.saved===null?null:JSON.parse(state.saved);
function checkValues(values,gains,label) {
  for(const [id,gain] of Object.entries(gains)) {
    assert(values?.[id],`${label}: missing ${id}`);
    assert.equal(values[id].gain,gain,`${label}/${id}: gain`);
  }
}
async function checkSliders(page,gains) {
  for(const [id,gain] of Object.entries(gains))assert.equal(await page.locator(`#mixerStrips [data-chip="${id}"] input[type=range]`).first().inputValue(),String(Math.round(gain*100)),`${id}: displayed gain`);
}
async function range(page,selector,value) {
  await page.locator(selector).evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},value);
}
async function chipRange(page,id,index,value) {
  await page.locator(`#mixerStrips [data-chip="${id}"] input[type=range]`).nth(index).evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},value);
}
async function load(page,name) {
  await page.locator('#fileInput').setInputFiles({name,mimeType:'application/octet-stream',buffer:await fs.readFile(path.join(repository,'test/fixtures',name))});
  await page.waitForFunction(name=>window.__analyzerMixerTest?.snapshot().file===name&&document.getElementById('status').textContent.startsWith(`Parsed ${name} `)&&!document.getElementById('inlinePlayButton').disabled,name);
  await page.locator('#dockMixerTab').click();
}
async function play(page) {
  const before=await snapshot(page);
  await page.locator('#inlinePlayButton').click();
  await page.waitForFunction(before=>{
    const state=window.__analyzerMixerTest.snapshot();
    return state.renderedFrames>before.renderedFrames&&state.workletStarts>before.workletStarts;
  },{renderedFrames:before.renderedFrames,workletStarts:before.workletStarts});
}
async function stop(page) {
  // Short synthetic fixtures may finish between a separate enabled check and
  // Playwright's actionability check. An already finished track needs no Stop.
  await page.locator('#inlineStopButton').evaluate(button=>{if(!button.disabled)button.click();});
}

async function checkBrowser(name,type,origin) {
  const browser=await type.launch({headless:true,args:name==='chromium'?['--autoplay-policy=no-user-gesture-required']:[]});
  try {
    const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
    page.setDefaultTimeout(35_000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(key=>{
      window.__analyzerAudioWrites=[];
      const set=Storage.prototype.setItem;
      Storage.prototype.setItem=function(name,value){if(name===key)window.__analyzerAudioWrites.push(String(value));return set.call(this,name,value);};
    },preferencesKey);
    const open=async()=>{await page.goto(origin+analyzerPath+'/index.html');await page.waitForFunction(()=>window.__analyzerMixerTest);};
    await open();
    // Merely parsing files and showing calibrated defaults must not author them.
    for(const filename of ['genesis-pcm.vgz','gameboy-tone.vgm','nes-tone.vgm']) {
      await load(page,filename);const state=await snapshot(page);
      checkValues(state.preferences,expected[filename],filename);await checkSliders(page,expected[filename]);
      assert.equal(state.saved,null,`${filename}: loading wrote preferences`);
      assert.equal(state.writes.length,0,`${filename}: loading wrote audio storage`);
    }
    // First playback must attach calibrated values before any slider is changed.
    await load(page,'genesis-pcm.vgz');await play(page);
    let state=await snapshot(page);checkValues(state.mixer,expected['genesis-pcm.vgz'],'first Genesis Play');
    assert.deepEqual(saved(state)?.chips??{},{});await stop(page);
    // Explicit gain before Play, and a later adjustment, are absolute and saved.
    await load(page,'gameboy-tone.vgm');await chipRange(page,'gameBoyDmg',0,75);
    assert.deepEqual(saved(await snapshot(page)).chips.gameBoyDmg,{gain:.75});
    await play(page);checkValues((await snapshot(page)).mixer,{gameBoyDmg:.75},'pre-Play override');
    await chipRange(page,'gameBoyDmg',0,62);await chipRange(page,'gameBoyDmg',1,-40);
    state=await snapshot(page);checkValues(state.mixer,{gameBoyDmg:.62},'post-Play override');
    assert.equal(state.mixer.gameBoyDmg.pan,-.4);const persisted=state.saved;
    await stop(page);await open();await load(page,'gameboy-tone.vgm');
    state=await snapshot(page);assert.equal(state.saved,persisted,'Reload/load rewrote explicit saved values');
    checkValues(state.preferences,{gameBoyDmg:.62},'reloaded explicit gain');
    assert.equal(state.preferences.gameBoyDmg.pan,-.4);await checkSliders(page,{gameBoyDmg:.62});
    await play(page);checkValues((await snapshot(page)).mixer,{gameBoyDmg:.62},'reloaded Play');await stop(page);
    // Pan-only authorship must leave gain lazy across differing Genesis PSG trim.
    await page.locator('#mixerReset').click();await load(page,'y8950-psg.vgz');
    await chipRange(page,'psg',1,37);state=await snapshot(page);
    assert.deepEqual(saved(state).chips.psg,{pan:.37});
    for(const filename of ['genesis-pcm.vgz','y8950-psg.vgz','genesis-pcm.vgz']) {
      await load(page,filename);state=await snapshot(page);
      checkValues(state.preferences,expected[filename],`${filename} lazy defaults`);
      assert.equal(state.preferences.psg.pan,.37);assert.deepEqual(saved(state).chips.psg,{pan:.37});
      await checkSliders(page,expected[filename]);await play(page);state=await snapshot(page);
      checkValues(state.mixer,expected[filename],`${filename} contextual Play`);
      assert.equal(state.mixer.psg.pan,.37);assert.deepEqual(saved(state).chips.psg,{pan:.37});await stop(page);
    }
    // Mixer Reset restores defaults/mute/pan/master, preserving authored FX.
    await chipRange(page,'ym2612',0,50);await chipRange(page,'psg',1,-25);
    await page.locator('#mixerStrips [data-chip="rf5c164"] button').click();
    await range(page,'#mixerMaster',23);
    await page.locator('#dockEffectTab').click();
    if(await page.locator('#effectEnabled').getAttribute('aria-pressed')==='false')await page.locator('#effectEnabled').click();
    await range(page,'#effectGain',83);await range(page,'#effectBass',6);
    const effects=(await snapshot(page)).effect;
    await page.locator('#dockMixerTab').click();await page.locator('#mixerReset').click();
    state=await snapshot(page);checkValues(state.preferences,expected['genesis-pcm.vgz'],'Reset defaults');
    checkValues(state.mixer,expected['genesis-pcm.vgz'],'Reset attached engine');
    assert.equal(state.master,1);assert.equal(saved(state).master,1);assert.deepEqual(saved(state).chips,{});
    assert.deepEqual(state.effect,effects,'Mixer Reset changed FX');
    for(const id of Object.keys(expected['genesis-pcm.vgz'])) {
      assert.equal(state.preferences[id].pan,0);assert.equal(state.preferences[id].muted,false);
      assert.equal(state.mixer[id].pan,0);assert.equal(state.mixer[id].muted,false);
    }
    assert.equal(await page.locator('#mixerMaster').inputValue(),'100');await checkSliders(page,expected['genesis-pcm.vgz']);
    const resetSaved=state.saved;
    await open();await load(page,'genesis-pcm.vgz');state=await snapshot(page);
    assert.equal(state.saved,resetSaved,'Loading after Reset wrote factory values');assert.equal(state.writes.length,0);
    checkValues(state.preferences,expected['genesis-pcm.vgz'],'reloaded Reset defaults');assert.deepEqual(state.effect,effects);
    assert.deepEqual(errors,[],`${name}: page errors`);
    console.log(JSON.stringify({browser:name,passed:true,root:docs,defaultGains:expected,
      checked:['load-without-storage-writes','first-Play-calibration','before-and-after-Play-explicit-gain','reload-persistence','pan-only-contextual-PSG','Reset-empty-overrides-master-and-mute','Reset-preserves-FX','real-WASM-AudioWorklet-muted-output']}));
    await context.close();
  } catch(error) {
    throw new Error(`${name}: ${error.message}`,{cause:error});
  } finally {await browser.close();}
}

(async()=>{
  try {await fs.access(path.join(docs,'vgm_analyzer/index.html'));analyzerPath='/vgm_analyzer';}
  catch {await fs.access(path.join(docs,'index.html'));analyzerPath='';}
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try {
    const origin=`http://127.0.0.1:${server.address().port}`;
    await checkBrowser('chromium',chromium,origin);
    if(!argumentsList.includes('--chromium-only'))await checkBrowser('webkit',webkit,origin);
  } finally {await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
