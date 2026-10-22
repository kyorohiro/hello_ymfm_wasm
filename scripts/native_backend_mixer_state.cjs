// Actual Playground Mixer/storage/Cassette UI; Native IPC is the only mocked boundary.
// This helper must be entered directly in Native mode, before any Web Audio prelude.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const STATE_PATH='/mixer/state.json',DEFAULTS_KEY='tetorica.playground.mixer.defaults.v1';

async function runMixerState({page,native,artifacts,name,ready,nativeRun,source,assertNoLiveAudio}) {
  const phases=[];
  const observe=async label=>{
    await assertNoLiveAudio(page);
    const values=await page.evaluate(({statePath,defaultsKey})=>{
      const t=window.__nativeBackendTest;
      return {audio:{...window.__audioConstructions},project:t.runtime.megaDrive.mixer.exportState(),
        common:JSON.parse(localStorage.getItem(defaultsKey)??'{"version":1,"kinds":[]}'),
        file:t.virtualFiles.get(statePath)?.data??null};
    },{statePath:STATE_PATH,defaultsKey:DEFAULTS_KEY});
    assert.deepEqual(values.audio,{contexts:0,offline:0,worklets:[]},label+' must not construct any Web Audio context or worklet');
    phases.push({label,...values});return values;
  };
  const openMixer=async()=>{await page.click('#mixerTab');await page.locator('#mixerPanel').waitFor({state:'visible'});};
  const row=()=>page.locator('#mixerPanel [data-chip-id="ym2612"]');
  const slider=async(key,value)=>{
    await row().locator(`[data-setting="${key}"]`).evaluate((input,value)=>{
      input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));
    },value);
  };
  const project=()=>page.evaluate(()=>window.__nativeBackendTest.runtime.megaDrive.mixer.exportState());
  const expected=(volume,pan,muted=true,solo=true)=>({version:1,entries:[{id:'ym2612',name:'ym2612',settings:{volume,pan,muted,solo}}]});
  const newCassette=async()=>{
    await page.locator('#mainMenu > summary').click();await page.click('#newCassetteButton');
    await page.locator('#newCassetteDialog').waitFor({state:'visible'});
    await page.locator('#newCassetteDialog button[value="new"]').click();
    await page.waitForFunction(()=>window.__nativeBackendTest.runtime.getState().playback==='stopped'&&
      window.__nativeBackendTest.runtime.megaDrive.mixer.exportState().entries.length===0&&
      !window.__nativeBackendTest.virtualFiles.get('/mixer/state.json'));
  };

  await observe('native-before-run');
  await page.evaluate(source=>{
    window.__nativeBackendTest.editor.setValue(source);document.getElementById('workerExecution').checked=false;
  },source);
  await nativeRun(page,native);await openMixer();await row().waitFor({state:'visible'});
  await slider('volume',65);await slider('pan',-35);
  await row().getByRole('button',{name:'ym2612 mute',exact:true}).click();
  await row().getByRole('button',{name:'ym2612 solo',exact:true}).click();
  await page.waitForFunction(()=>{
    const file=window.__nativeBackendTest.virtualFiles.get('/mixer/state.json');if(!file)return false;
    const settings=JSON.parse(file.data).entries.find(entry=>entry.id==='ym2612')?.settings;
    return settings?.volume===.65&&settings.pan===-.35&&settings.muted===true&&settings.solo===true;
  });
  assert.deepEqual(await project(),expected(.65,-.35));
  await observe('project-controls-debounced');

  await row().getByRole('button',{name:'ym2612 set common default',exact:true}).click();
  const common={version:1,kinds:[{name:'ym2612',volume:.65,pan:-.35}]};
  assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),DEFAULTS_KEY),common);
  assert.deepEqual(await project(),expected(.65,-.35),'Saving common defaults must keep authored project Mute/Solo');
  await observe('common-volume-pan-only');

  await slider('volume',73);await slider('pan',20);
  const snapshot=await page.evaluate(()=>window.__nativeBackendTest.captureProjectSnapshot());
  const saved=expected(.73,.2);
  assert.deepEqual(JSON.parse(snapshot.files.find(file=>file.path===STATE_PATH).data),saved,'Snapshot flush must include the latest slider edits');
  await page.evaluate(()=>window.__tetoricaAutosaveFlush());
  await observe('project-flushed-to-indexeddb');
  await page.reload();await ready(page);await observe('same-app-reloaded-before-run');
  assert.match(await page.locator('#autosaveStatus').textContent(),/Autosave restored/);
  assert.deepEqual(await project(),saved);
  assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),DEFAULTS_KEY),common);
  await nativeRun(page,native);await openMixer();
  assert.equal(await row().locator('[data-setting="volume"]').inputValue(),'73');
  assert.equal(await row().locator('[data-setting="pan"]').inputValue(),'20');
  assert.equal(await row().getByRole('button',{name:'ym2612 mute',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await row().getByRole('button',{name:'ym2612 solo',exact:true}).getAttribute('aria-pressed'),'true');
  await page.screenshot({path:path.join(artifacts,name+'-mixer-project-restored.png')});

  const downloading=page.waitForEvent('download');
  page.once('dialog',dialog=>dialog.accept('mixer-state-regression'));
  await page.evaluate(()=>window.__nativeBackendTest.exportCassette());
  const download=await downloading,bytes=await fs.readFile(await download.path());
  assert.equal(bytes.readUInt32LE(0),0x04034b50,'Export must be an actual ZIP archive');
  await fs.writeFile(path.join(artifacts,name+'-mixer-state.cassette.zip'),bytes);
  await observe('actual-cassette-zip-exported');

  await newCassette();
  const fresh=await observe('actual-new-cassette');
  assert.deepEqual(fresh.project,{version:1,entries:[]});assert.deepEqual(fresh.common,common);assert.equal(fresh.file,null);
  const inherited=await page.evaluate(()=>window.__nativeBackendTest.runtime.megaDrive.mixer.get('ym2612'));
  assert.deepEqual(inherited,{volume:.65,pan:-.35,muted:false,solo:false});

  await page.evaluate(async base64=>{
    const archive=Uint8Array.from(atob(base64),value=>value.charCodeAt(0));
    await window.__nativeBackendTest.loadCassetteSource(archive,'mixer-state-regression.cassette.zip');
  },bytes.toString('base64'));
  assert.deepEqual(await project(),saved,'Actual Cassette loader must restore the project overrides');
  const imported=await observe('actual-cassette-zip-imported');assert.deepEqual(imported.common,common);
  assert.deepEqual(JSON.parse(imported.file),saved);
  await openMixer();await page.screenshot({path:path.join(artifacts,name+'-mixer-cassette-imported.png')});

  const broken='{ "version":1, "entries": [ malformed project';
  await page.evaluate(broken=>window.__nativeBackendTest.virtualFiles.writeText('/mixer/state.json',broken),broken);
  await slider('volume',45);
  await page.waitForFunction(()=>document.body.textContent.includes('Fix /mixer/state.json before saving Mixer changes'));
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.mixerState.flush()),false);
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.virtualFiles.get('/mixer/state.json').data),broken,'Blocked autosave must not overwrite malformed source');
  await observe('malformed-json-preserved');
  await page.screenshot({path:path.join(artifacts,name+'-mixer-malformed-preserved.png')});

  await page.evaluate(saved=>window.__nativeBackendTest.virtualFiles.writeText('/mixer/state.json',JSON.stringify(saved,null,2)+'\n'),saved);
  await slider('pan',-10);
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.mixerState.flush()),true);
  assert.deepEqual(await project(),expected(.73,-.1));
  const final=await observe('valid-json-recovery');assert.deepEqual(JSON.parse(final.file),expected(.73,-.1));
  await page.evaluate(()=>window.__tetoricaAutosaveFlush());

  // A damaged common preference must not prevent the actual app from starting
  // or be overwritten while recovering its independent project draft.
  const priorCommon=await page.evaluate(key=>localStorage.getItem(key),DEFAULTS_KEY);
  const priorSource=await page.evaluate(()=>window.__nativeBackendTest.editor.getValue());
  const startupErrors=[],onStartupError=error=>startupErrors.push(error.message);
  page.on('pageerror',onStartupError);
  try {
    const brokenCommon='{ "version":1, "kinds": [ malformed common defaults';
    await page.evaluate(({key,text})=>localStorage.setItem(key,text),{key:DEFAULTS_KEY,text:brokenCommon});
    await page.reload();await ready(page);await assertNoLiveAudio(page);
    const malformed=await page.evaluate(({key,statePath})=>({
      audio:{...window.__audioConstructions},commonSource:localStorage.getItem(key),
      project:window.__nativeBackendTest.runtime.megaDrive.mixer.exportState(),
      file:window.__nativeBackendTest.virtualFiles.get(statePath)?.data??null,
      source:window.__nativeBackendTest.editor.getValue(),
    }),{key:DEFAULTS_KEY,statePath:STATE_PATH});
    assert.deepEqual(malformed.audio,{contexts:0,offline:0,worklets:[]});
    assert.equal(malformed.commonSource,brokenCommon,'Startup must preserve damaged common JSON for repair');
    assert.equal(malformed.source,priorSource,'Malformed preferences must not damage the restored source');
    assert.deepEqual(malformed.project,expected(.73,-.1));
    assert.deepEqual(startupErrors,[],'Malformed common defaults must not cause a startup page error');
    phases.push({label:'malformed-common-startup-preserved',...malformed});
    await page.evaluate(({key,text})=>localStorage.setItem(key,text),{key:DEFAULTS_KEY,text:priorCommon});
    await page.reload();await ready(page);
    const restored=await observe('common-startup-repaired');
    assert.deepEqual(restored.common,common);assert.deepEqual(restored.project,expected(.73,-.1));
    assert.deepEqual(startupErrors,[]);
  } finally {page.off('pageerror',onStartupError);}

  await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
  await observe('finalized');
  await fs.writeFile(path.join(artifacts,name+'-mixer-state.json'),JSON.stringify({mockedNative:true,deviceOpened:false,
    browser:name,cassetteBytes:bytes.length,cases:phases.length,phases,calls:native.calls},null,2));
}
module.exports={runMixerState};
