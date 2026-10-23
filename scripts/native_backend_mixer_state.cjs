// Actual Playground Mixer/storage/Cassette UI; Native IPC is the only mocked boundary.
// This helper must be entered directly in Native mode, before any Web Audio prelude.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const STATE_PATH='/mixer/current.json',SYSTEM_PATH='/sys/mixer/default.json';
const DEFAULT_PATH='/mixer/default.json',NAMED_PATH='/mixer/quiet.json',LEGACY_PATH='/mixer/state.json';

async function runMixerState({page,native,artifacts,name,ready,nativeRun,source,assertNoLiveAudio}) {
  const phases=[];
  const observe=async label=>{
    await assertNoLiveAudio(page);
    const values=await page.evaluate(statePath=>{
      const t=window.__nativeBackendTest;
      return {audio:{...window.__audioConstructions},project:t.runtime.megaDrive.mixer.exportState(),
        presets:t.mixerState.listPresets(),file:t.virtualFiles.get(statePath)?.data??null};
    },STATE_PATH);
    assert.deepEqual(values.audio,{contexts:0,offline:0,worklets:[]},label+' must not construct any Web Audio context or worklet');
    phases.push({label,...values});return values;
  };
  const openMixer=async()=>{await page.click('#mixerTab');await page.locator('#mixerPanel').waitFor({state:'visible'});};
  const row=()=>page.locator('#mixerPanel [data-chip-id="ym2612"]');
  const preset=()=>page.getByRole('combobox',{name:'Mixer preset',exact:true});
  const setDefault=()=>page.getByRole('button',{name:'Set default',exact:true});
  const save=()=>page.locator('#mixerPanel').getByRole('button',{name:'Save',exact:true});
  const saveDialog=()=>page.getByRole('dialog',{name:'Save mixer preset',exact:true});
  const slider=async(key,value)=>{
    await row().locator(`[data-setting="${key}"]`).evaluate((input,value)=>{
      input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));
    },value);
  };
  const project=()=>page.evaluate(()=>window.__nativeBackendTest.runtime.megaDrive.mixer.exportState());
  const settings=()=>page.evaluate(()=>window.__nativeBackendTest.runtime.megaDrive.mixer.get('ym2612'));
  const currentText=()=>page.evaluate(statePath=>window.__nativeBackendTest.virtualFiles.get(statePath)?.data??null,STATE_PATH);
  const assertCurrentUnchanged=async(before,label)=>{
    // Exercise both the delayed autosave boundary and the project-wide flush.
    await page.waitForTimeout(300);
    const snapshot=await page.evaluate(()=>window.__nativeBackendTest.captureProjectSnapshot());
    assert.equal(await currentText(),before,label+' must preserve current.json bytes');
    assert.equal(snapshot.files.find(file=>file.path===STATE_PATH)?.data??null,before,
      label+' must also preserve current.json during snapshot flush');
  };
  const expected=(volume,pan,muted=true,solo=true)=>({version:1,entries:[{id:'ym2612',name:'ym2612',settings:{volume,pan,muted,solo}}]});
  const empty={version:1,entries:[]};
  const carriedDefault=expected(.55,-.15,false,false);
  const newCassette=async()=>{
    await page.locator('#mainMenu > summary').click();await page.click('#newCassetteButton');
    await page.locator('#newCassetteDialog').waitFor({state:'visible'});
    await page.locator('#newCassetteDialog button[value="new"]').click();
    await page.waitForFunction(()=>window.__nativeBackendTest.runtime.getState().playback==='stopped'&&
      window.__nativeBackendTest.runtime.megaDrive.mixer.get('ym2612').volume===.55&&
      !window.__nativeBackendTest.virtualFiles.get('/mixer/quiet.json'));
  };

  await observe('native-before-run');
  await page.evaluate(source=>{
    window.__nativeBackendTest.editor.setValue(source);document.getElementById('workerExecution').checked=false;
  },source);
  await nativeRun(page,native);await openMixer();await row().waitFor({state:'visible'});
  assert.equal(await page.getByRole('button',{name:'Set common default',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Use defaults',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Reset common defaults',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Reset mixer preset',exact:true}).count(),0);
  assert(await preset().locator(`option[value="${SYSTEM_PATH}"]`).count(),'Built-in System preset must be selectable');
  assert.match(await preset().locator(`option[value="${SYSTEM_PATH}"]`).textContent(),/System.*read.only/i,
    'System must be visibly identified as read-only');
  assert.equal(await currentText(),null,'An untouched project must not have current.json');
  await preset().selectOption(SYSTEM_PATH);
  await assertCurrentUnchanged(null,'Selecting System before any control edit');
  await slider('volume',65);await slider('pan',-35);
  await row().getByRole('button',{name:'ym2612 mute',exact:true}).click();
  await row().getByRole('button',{name:'ym2612 solo',exact:true}).click();
  await page.waitForFunction(()=>{
    const file=window.__nativeBackendTest.virtualFiles.get('/mixer/current.json');if(!file)return false;
    const settings=JSON.parse(file.data).entries.find(entry=>entry.id==='ym2612')?.settings;
    return settings?.volume===.65&&settings.pan===-.35&&settings.muted===true&&settings.solo===true;
  });
  const quiet=expected(.65,-.35);
  assert.deepEqual(await project(),quiet);
  await observe('controls-autosaved-current');

  // Save the current controls through the actual accessible name dialog.
  await save().click();await saveDialog().waitFor({state:'visible'});
  const initialName=saveDialog().getByRole('textbox',{name:'Preset name',exact:true});
  assert.deepEqual(await saveDialog().locator('.playground-mixer-save-prefix').evaluate(prefix=>({
    text:prefix.textContent,tag:prefix.tagName,editable:prefix.isContentEditable,
  })),{text:'mixer/',tag:'SPAN',editable:false},'The preset folder must be a fixed, non-editable prefix');
  assert.equal(await initialName.inputValue(),'mix.json','The first Save dialog must suggest mix.json');
  assert.deepEqual(await initialName.evaluate(input=>({start:input.selectionStart,end:input.selectionEnd})),
    {start:0,end:3},'Only the suggested basename must initially be selected');
  await initialName.fill('quiet');
  await saveDialog().getByRole('button',{name:'Save',exact:true}).click();
  await saveDialog().waitFor({state:'hidden'});
  await preset().locator(`option[value="${NAMED_PATH}"]`).waitFor({state:'attached'});
  assert.equal(await preset().inputValue(),NAMED_PATH,'Saving must select the new named preset');
  assert.deepEqual(await page.evaluate(namedPath=>JSON.parse(window.__nativeBackendTest.virtualFiles.get(namedPath).data),NAMED_PATH),quiet);

  const currentBeforeRejectedSave=await page.evaluate(statePath=>window.__nativeBackendTest.virtualFiles.get(statePath).data,STATE_PATH);
  await save().click();await saveDialog().waitFor({state:'visible'});
  const nameInput=saveDialog().getByRole('textbox',{name:'Preset name',exact:true});
  await nameInput.fill('../bad');await saveDialog().getByRole('button',{name:'Save',exact:true}).click();
  assert(await saveDialog().isVisible(),'An invalid preset path must leave the dialog open');
  assert((await saveDialog().getByRole('status').textContent()).trim(),'Invalid preset names must have a visible error');
  assert.deepEqual(await project(),quiet,'An invalid preset name must not alter the live mix');
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.virtualFiles.has('/bad.json')),false);
  await nameInput.fill('quiet');await saveDialog().getByRole('button',{name:'Save',exact:true}).click();
  assert(await saveDialog().isVisible(),'A duplicate preset name must leave the dialog open');
  assert((await saveDialog().getByRole('status').textContent()).trim(),'Duplicate names must have a visible error');
  assert.deepEqual(await project(),quiet,'A rejected duplicate must not alter the live mix');
  assert.deepEqual(await page.evaluate(namedPath=>JSON.parse(window.__nativeBackendTest.virtualFiles.get(namedPath).data),NAMED_PATH),quiet,
    'Save must not overwrite an existing named preset');
  assert.equal(await page.evaluate(statePath=>window.__nativeBackendTest.virtualFiles.get(statePath).data,STATE_PATH),currentBeforeRejectedSave,
    'Rejected names must leave current.json unchanged');
  assert.equal(await preset().inputValue(),NAMED_PATH,'Rejected names must preserve the selected preset');
  await saveDialog().getByRole('button',{name:'Cancel',exact:true}).click();await saveDialog().waitFor({state:'hidden'});
  await observe('named-preset-saved-and-rejected-names-preserved');

  await slider('volume',73);await slider('pan',20);
  const saved=expected(.73,.2);
  assert.equal(await preset().inputValue(),STATE_PATH,'Editing a named preset must select current.json immediately');
  const firstEditedSnapshot=await page.evaluate(()=>window.__nativeBackendTest.captureProjectSnapshot());
  assert.deepEqual(JSON.parse(firstEditedSnapshot.files.find(file=>file.path===STATE_PATH).data),saved,
    'Snapshot flush must save the actual 73/20 control edit before auditioning presets');
  const editedCurrent=await currentText();
  await preset().selectOption(NAMED_PATH);
  assert.deepEqual(await project(),quiet,'Selecting a named preset must immediately restore all controls, including Mute/Solo');
  assert.deepEqual(JSON.parse((await observe('named-preset-selected-immediately')).file),saved);
  await assertCurrentUnchanged(editedCurrent,'Auditioning a named preset');

  // Explicit preset saves capture the live audition without changing the last edit.
  await setDefault().click();
  assert.deepEqual(await page.evaluate(defaultPath=>JSON.parse(window.__nativeBackendTest.virtualFiles.get(defaultPath).data),DEFAULT_PATH),quiet,
    'Set default must capture the selected live preset rather than the saved current mix');
  await assertCurrentUnchanged(editedCurrent,'Set default with no control edit');
  await save().click();await saveDialog().waitFor({state:'visible'});
  await saveDialog().getByRole('textbox',{name:'Preset name',exact:true}).fill('audition');
  await saveDialog().getByRole('button',{name:'Save',exact:true}).click();
  await saveDialog().waitFor({state:'hidden'});
  assert.deepEqual(await page.evaluate(()=>JSON.parse(window.__nativeBackendTest.virtualFiles.get('/mixer/audition.json').data)),quiet,
    'Save must capture the live selected mix rather than the saved current mix');
  await assertCurrentUnchanged(editedCurrent,'Save with no control edit');

  await preset().selectOption(SYSTEM_PATH);
  assert.deepEqual(await settings(),{volume:1,pan:0,muted:false,solo:false},'System preset must restore factory levels and clear Mute/Solo');
  assert.deepEqual(await project(),empty);
  const factory=await observe('system-preset-selected-immediately');
  assert.equal(factory.file,editedCurrent);
  await assertCurrentUnchanged(editedCurrent,'Auditioning System');
  await preset().selectOption(STATE_PATH);
  assert.deepEqual(await project(),saved,'Selecting current.json must restore the last real edit after named and System auditions');
  await assertCurrentUnchanged(editedCurrent,'Returning to current.json');

  await slider('volume',55);
  assert.equal(await preset().inputValue(),STATE_PATH,'Actual control edits must keep current.json selected');
  await preset().selectOption(SYSTEM_PATH);
  assert.deepEqual(await settings(),{volume:1,pan:0,muted:false,solo:false},'System must be selectable again after a control edit');
  assert.deepEqual(await project(),empty);
  const pendingEditedCurrent=await currentText();
  assert.deepEqual(JSON.parse(pendingEditedCurrent),expected(.55,.2),
    'Selecting another preset must flush a pending actual control edit, without saving the selected System mix');
  await assertCurrentUnchanged(pendingEditedCurrent,'System after a pending actual edit');
  await slider('volume',55);await slider('pan',-15);
  assert.equal(await preset().inputValue(),STATE_PATH,'Volume/Pan adjustments must select current.json before Set default');
  for(const control of ['mute','solo']) {
    await row().getByRole('button',{name:`ym2612 ${control}`,exact:true}).click();
    await row().getByRole('button',{name:`ym2612 ${control}`,exact:true}).click();
  }
  await setDefault().click();
  await preset().locator(`option[value="${DEFAULT_PATH}"]`).waitFor({state:'attached'});
  assert.deepEqual(await project(),carriedDefault,'Set default must preserve the current controls');
  assert.deepEqual(await page.evaluate(defaultPath=>JSON.parse(window.__nativeBackendTest.virtualFiles.get(defaultPath).data),DEFAULT_PATH),carriedDefault,
    'Set default must write the current Volume/Pan/Mute/Solo to default.json');
  const defaultEditedCurrent=await currentText();
  await preset().selectOption(NAMED_PATH);assert.deepEqual(await project(),quiet);
  await preset().selectOption(DEFAULT_PATH);
  assert.deepEqual(await project(),carriedDefault,'Selecting default.json must immediately apply its snapshot');
  await assertCurrentUnchanged(defaultEditedCurrent,'Auditioning named and default presets');
  await observe('current-saved-as-default-and-selected-immediately');

  await preset().selectOption(NAMED_PATH);
  await slider('volume',73);await slider('pan',20);
  const snapshot=await page.evaluate(()=>window.__nativeBackendTest.captureProjectSnapshot());
  assert.deepEqual(JSON.parse(snapshot.files.find(file=>file.path===STATE_PATH).data),saved,'Snapshot flush must include the latest slider edits');
  assert.deepEqual(JSON.parse(snapshot.files.find(file=>file.path===NAMED_PATH).data),quiet,'Editing current must not mutate the named preset');

  // Edit and select current in one task, before the 250 ms autosave can fire.
  await page.evaluate(statePath=>{
    const input=document.querySelector('#mixerPanel [data-chip-id="ym2612"] [data-setting="volume"]');
    input.value='81';input.dispatchEvent(new Event('input',{bubbles:true}));
    const select=document.querySelector('select[aria-label="Mixer preset"]');
    select.value=statePath;select.dispatchEvent(new Event('change',{bubbles:true}));
  },STATE_PATH);
  const latest=expected(.81,.2);
  assert.deepEqual(await project(),latest,'Selecting current must flush the latest controls before reading current.json');
  assert.deepEqual(JSON.parse((await observe('current-selection-keeps-latest-edit')).file),latest);
  await page.evaluate(()=>window.__tetoricaAutosaveFlush());
  await observe('project-flushed-to-indexeddb');
  await page.reload();await ready(page);await observe('same-app-reloaded-before-run');
  assert.match(await page.locator('#autosaveStatus').textContent(),/Autosave restored/);
  assert.deepEqual(await project(),latest);
  await nativeRun(page,native);await openMixer();
  assert.equal(await preset().inputValue(),STATE_PATH,'Reloaded current settings must also select current.json');
  assert.equal(await row().locator('[data-setting="volume"]').inputValue(),'81');
  assert.equal(await row().locator('[data-setting="pan"]').inputValue(),'20');
  assert.equal(await row().getByRole('button',{name:'ym2612 mute',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await row().getByRole('button',{name:'ym2612 solo',exact:true}).getAttribute('aria-pressed'),'true');
  assert(await preset().locator(`option[value="${NAMED_PATH}"]`).count(),'Named preset must survive IndexedDB restoration');
  await page.screenshot({path:path.join(artifacts,name+'-mixer-project-restored.png')});

  const downloading=page.waitForEvent('download');
  page.once('dialog',dialog=>dialog.accept('mixer-preset-regression'));
  await page.evaluate(()=>window.__nativeBackendTest.exportCassette());
  const download=await downloading,bytes=await fs.readFile(await download.path());
  assert.equal(bytes.readUInt32LE(0),0x04034b50,'Export must be an actual ZIP archive');
  await fs.writeFile(path.join(artifacts,name+'-mixer-state.cassette.zip'),bytes);
  await observe('actual-cassette-zip-exported');

  await newCassette();
  const fresh=await observe('actual-new-cassette');
  assert.deepEqual(fresh.project,carriedDefault);
  assert.equal(fresh.file,null,'Starting from the carried default must not create current.json before a control edit');
  assert.deepEqual(await settings(),{volume:.55,pan:-.15,muted:false,solo:false},'New Cassette must start from its carried default.json');
  assert.deepEqual(await page.evaluate(defaultPath=>JSON.parse(window.__nativeBackendTest.virtualFiles.get(defaultPath).data),DEFAULT_PATH),carriedDefault,
    'New Cassette must copy the current project default.json into the fresh project');
  assert(!fresh.presets.some(value=>value.path===NAMED_PATH),'New Cassette must clear project presets');

  await page.evaluate(async base64=>{
    const archive=Uint8Array.from(atob(base64),value=>value.charCodeAt(0));
    await window.__nativeBackendTest.loadCassetteSource(archive,'mixer-preset-regression.cassette.zip');
  },bytes.toString('base64'));
  assert.deepEqual(await project(),latest,'Actual Cassette loader must restore current settings');
  const imported=await observe('actual-cassette-zip-imported');
  assert.deepEqual(JSON.parse(imported.file),latest);
  assert.deepEqual(await page.evaluate(namedPath=>JSON.parse(window.__nativeBackendTest.virtualFiles.get(namedPath).data),NAMED_PATH),quiet);
  assert.deepEqual(await page.evaluate(defaultPath=>JSON.parse(window.__nativeBackendTest.virtualFiles.get(defaultPath).data),DEFAULT_PATH),carriedDefault,
    'The actual Cassette ZIP must preserve the editable default.json');
  await openMixer();await page.screenshot({path:path.join(artifacts,name+'-mixer-cassette-imported.png')});

  const brokenPreset='{ "version":1, "entries": [ malformed preset';
  await page.evaluate(text=>window.__nativeBackendTest.virtualFiles.writeText('/mixer/broken.json',text),brokenPreset);
  await preset().locator('option[value="/mixer/broken.json"]').waitFor({state:'attached'});
  await preset().selectOption('/mixer/broken.json');
  assert.deepEqual(await project(),latest,'A malformed named preset must not partially alter any control');
  const rejected=await observe('malformed-named-preset-rejected');
  assert.deepEqual(JSON.parse(rejected.file),latest);
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.virtualFiles.get('/mixer/broken.json').data),brokenPreset);
  assert((await page.locator('#mixerPanel [role="status"]').textContent()).trim(),'Rejected preset must report a visible error');

  const broken='{ "version":1, "entries": [ malformed current';
  await page.evaluate(broken=>window.__nativeBackendTest.virtualFiles.writeText('/mixer/current.json',broken),broken);
  await slider('volume',45);
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.mixerState.flush()),false);
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.virtualFiles.get('/mixer/current.json').data),broken,'Blocked autosave must not overwrite malformed current');
  await observe('malformed-current-preserved');
  await page.screenshot({path:path.join(artifacts,name+'-mixer-malformed-preserved.png')});

  await page.evaluate(saved=>window.__nativeBackendTest.virtualFiles.writeText('/mixer/current.json',JSON.stringify(saved,null,2)+'\n'),latest);
  await slider('pan',-10);
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.mixerState.flush()),true);
  assert.deepEqual(await project(),expected(.81,-.1));
  const repaired=await observe('valid-current-recovery');assert.deepEqual(JSON.parse(repaired.file),expected(.81,-.1));

  // An older Cassette can still start from state.json, which remains available
  // as a named preset after the next edit writes the new current.json path.
  await page.evaluate(({currentPath,legacyPath,state})=>{
    const t=window.__nativeBackendTest;
    t.mixerState.replaceProject(()=>{
      t.virtualFiles.delete(currentPath);
      t.virtualFiles.writeText(legacyPath,JSON.stringify(state,null,2)+'\n');
    });
  },{currentPath:STATE_PATH,legacyPath:LEGACY_PATH,state:quiet});
  assert.deepEqual(await project(),quiet,'Legacy state.json must load when current.json is absent');
  assert(await preset().locator(`option[value="${LEGACY_PATH}"]`).count(),'Legacy state must remain selectable as a preset');
  await slider('volume',57);assert.equal(await page.evaluate(()=>window.__nativeBackendTest.mixerState.flush()),true);
  const migrated=await observe('legacy-state-remains-preset');
  assert.deepEqual(JSON.parse(migrated.file),expected(.57,-.35));
  assert.deepEqual(await page.evaluate(legacyPath=>JSON.parse(window.__nativeBackendTest.virtualFiles.get(legacyPath).data),LEGACY_PATH),quiet);
  await page.evaluate(()=>window.__tetoricaAutosaveFlush());

  await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
  await observe('finalized');
  await fs.writeFile(path.join(artifacts,name+'-mixer-state.json'),JSON.stringify({mockedNative:true,deviceOpened:false,
    browser:name,cassetteBytes:bytes.length,cases:phases.length,phases,calls:native.calls},null,2));
}
module.exports={runMixerState};
