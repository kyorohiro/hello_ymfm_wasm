// Serve docs on port 8095. Args: URL, chromium|webkit, seconds, binary asset MiB.
// Exercises actual Menu/Monaco/tab UI during choir playback, including the
// Tauri-only autosave path. Captured graph PCM cannot prove the device did not
// underrun after rendering: use this alongside listening in the Tauri app.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const playwright = require('playwright');

const url = process.argv[2] || 'http://127.0.0.1:8095/playground/index.html';
const browserName = process.argv[3] || 'webkit';
const seconds = Number(process.argv[4] || 12);
const assetMiB = Number(process.argv[5] || 8);
assert(['chromium', 'webkit'].includes(browserName));
assert(Number.isFinite(seconds) && seconds >= 5 && seconds <= 120);
assert(Number.isFinite(assetMiB) && assetMiB >= 0 && assetMiB <= 128);

const captureModule = `class UIAudioCapture extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.frames=0; this.ended=false; this.maxWallGapMs=0;
    this.capacity=Math.ceil(sampleRate*(options.processorOptions.seconds+10));
    this.left=new Float32Array(this.capacity);this.right=new Float32Array(this.capacity);
    this.port.onmessage=({data})=>{
      if(data!=='end'||this.ended)return;this.ended=true;
      this.port.postMessage({frames:this.frames,rate:sampleRate,maxWallGapMs:this.maxWallGapMs,
        left:this.left.subarray(0,this.frames),right:this.right.subarray(0,this.frames)});
    };
  }
  process(inputs) {
    if(this.ended)return false;
    const now=Date.now();
    if(this.lastWall!==undefined)this.maxWallGapMs=Math.max(this.maxWallGapMs,now-this.lastWall);
    this.lastWall=now;
    const source=inputs[0];
    if(source?.[0]) {
      const n=Math.min(source[0].length,this.capacity-this.frames);
      for(let i=0;i<n;i++){this.left[this.frames+i]=source[0][i];this.right[this.frames+i]=(source[1]??source[0])[i];}
      this.frames+=n;
    }
    return true;
  }
}
registerProcessor('ui-audio-capture',UIAudioCapture);`;

// Keep instrumentation out of production code and measure the actual capture
// and IndexedDB submission; counting bytes does not copy the binary assets.
const autosaveInstrumentation = `
export function createProjectAutosave(options) {
  const m=window.__uiAudioAutosave={captures:0,saves:0,capturedBytes:0,savedBytes:0,captureMs:0,submitMs:0,maxSubmitMs:0};
  const bytes=snapshot=>(snapshot.files??[]).reduce((sum,file)=>sum+(typeof file.data==='string'?file.data.length:file.data.byteLength),0);
  return __uiAudioCreateProjectAutosave({...options,
    capture(){const before=performance.now();const snapshot=options.capture();m.captureMs+=performance.now()-before;m.captures++;m.capturedBytes+=bytes(snapshot);return snapshot;},
    store:{...options.store,save(snapshot){m.saves++;m.savedBytes+=bytes(snapshot);const before=performance.now();const result=options.store.save(snapshot);const elapsed=performance.now()-before;m.submitMs+=elapsed;m.maxSubmitMs=Math.max(m.maxSubmitMs,elapsed);return result;}}
  });
}`;

(async () => {
  const browser = await playwright[browserName].launch({headless: process.env.UI_AUDIO_HEADED !== '1',
    ...(browserName === 'chromium' ? {args: ['--autoplay-policy=no-user-gesture-required']} : {})});
  try {
    // Routes instrument module responses; a controlling service worker can
    // supply its cached originals on reload and bypass those test-only routes.
    const page = await browser.newPage({viewport: {width: 1440, height: 1000},serviceWorkers:'block'});
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    // This activates the same IndexedDB draft code as Tauri without exposing
    // native commands or importing any machine-specific saved project.
    await page.addInitScript(() => {window.__TAURI_INTERNALS__ = {};});
    await page.route('**/playground_autosave.js', async route => {
      const response = await route.fetch();
      let body = await response.text();
      assert(body.includes('export function createProjectAutosave('));
      body = body.replace('export function createProjectAutosave(', 'function __uiAudioCreateProjectAutosave(');
      await route.fulfill({response, body: body + autosaveInstrumentation});
    });
    await page.route('**/playground.js?*', async route => {
      const response = await route.fetch();
      const body = await response.text();
      await route.fulfill({response, body: body + `
window.__uiAudioTest={runtime,megaDrive,fs:virtualFiles,get editor(){return editorAdapter;},flush:()=>desktopAutosave.flush(),
  async persistedContent(){
    const binary=await Promise.all(virtualFiles.list().filter(file=>file.type==='binary').map(async file=>({
      path:file.path,bytes:file.data.byteLength,
      sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',file.data)),value=>value.toString(16).padStart(2,'0')).join('')
    })));
    binary.sort((a,b)=>a.path.localeCompare(b.path));
    return {source:editorAdapter.getValue(),storedSource:virtualFiles.get('/index.js').data,
      binary,directories:virtualFiles.listDirectories().sort()};
  }
};`});
    });
    await page.goto(url);
    await page.waitForFunction(() => window.__uiAudioTest && window.monaco?.editor?.getEditors().some(editor=>editor.getModel()?.uri.path.startsWith('/project/')));
    // A gesture allows WebKit to open the device.
    await page.click('#runButton'); await page.waitForTimeout(200);
    await page.evaluate(() => window.__uiAudioTest.runtime.stop());
    let source = await fs.readFile(path.join(__dirname, '../docs/playground/examples/basic/ambient-choir-sample.js'), 'utf8');
    source = 'let noiseVoiceCount=0;\n' + source.replace(/await sample.load\([\s\S]*?\);/, '')
      .replace('choose([0.5, 1 / 3, 3 / 5])', '[0.5, 1 / 3, 3 / 5][noiseVoiceCount++ % 3]')
      .replace('rrange(-1, 1)', 'Math.sin(noiseVoiceCount * 1.25)');
    await page.evaluate(async ({captureModule, assetMiB}) => {
      const {runtime, megaDrive, fs, flush} = window.__uiAudioTest;
      await runtime.ensureReady();
      await megaDrive.sample.load('sonic-pi/ambi-choir', new URL('./samples/sonic-pi/ambi_choir.flac', location.href).href);
      const moduleUrl = URL.createObjectURL(new Blob([captureModule], {type: 'text/javascript'}));
      try {await megaDrive.audioContext.audioWorklet.addModule(moduleUrl);} finally {URL.revokeObjectURL(moduleUrl);}
      if(assetMiB){
        const bytes=new Uint8Array(Math.round(assetMiB*1024*1024));
        for(let i=0;i<bytes.length;i++)bytes[i]=(i*13+19)&255;
        fs.writeBinary('/samples/ui-audio-stress.bin',bytes);
      }
      // Retain a nonzero binary even when the optional stress asset is omitted.
      fs.writeBinary('/samples/ui-audio-persistence.bin',new Uint8Array([0,1,255,128,0,254,7,32,64]));
      fs.mkdir('/ui-audio/empty/nested',{recursive:true});
      await flush();
    }, {captureModule, assetMiB});
    const results = [];
    for (const execution of ['main', 'worker']) {
      await page.evaluate(async ({source, execution, seconds}) => {
        const {runtime, megaDrive, editor, flush} = window.__uiAudioTest;
        editor.setValue(source); await flush();
        const m=window.__uiAudioAutosave;for(const key of Object.keys(m))m[key]=0;
        const context=megaDrive.audioContext;
        const tap=new AudioWorkletNode(context,'ui-audio-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{seconds}});
        const detach=megaDrive.audio.connectOutputMonitor(tap);tap.connect(context.destination);
        const captured=new Promise(resolve=>{tap.port.onmessage=({data})=>resolve(data);});
        window.__uiAudioRecording={tap,detach,captured,context,started:performance.now()};
        await runtime.playSource(source,{execution});
      }, {source, execution, seconds});
      const end = Date.now() + seconds * 1000;
      let menuClicks=0, editCharacters=0, contextMenus=0, fileMenus=0, tabChanges=0;
      while (Date.now() < end) {
        await page.locator('#mainMenu > summary').click(); menuClicks++;
        await page.locator('#mainMenu > summary').click(); menuClicks++;
        await page.locator('#fileExplorerList [data-file-path="/index.js"]').click({button:'right'});
        await page.locator('.file-context-menu').waitFor({state:'visible'});fileMenus++;
        await page.keyboard.press('Escape');
        const editor = page.locator('#editorHost .monaco-editor');
        await editor.click({position: {x: 180, y: 50}});
        // Start at the end of the file so edits do not trigger runtime changes.
        await page.keyboard.press('ControlOrMeta+End');
        const text = '\n// UI editing while sample voices continue playing.\n';
        await page.keyboard.type(text, {delay: 2}); editCharacters += text.length;
        await editor.click({button: 'right', position: {x: 200, y: 60}}); contextMenus++;
        await page.keyboard.press('Escape');
        await page.mouse.wheel(0, -240);
        await page.locator('#audioMonitorTab').click(); tabChanges++;
        await page.waitForTimeout(80);
        await page.locator('#consoleTab').click(); tabChanges++;
      }
      const result = await page.evaluate(async execution => {
        const {tap,detach,captured,context,started}=window.__uiAudioRecording;
        tap.port.postMessage('end'); const data=await captured;
        const result={execution,sampleRate:context.sampleRate,frames:data.frames,audioSeconds:data.frames/data.rate,
          wallSeconds:(performance.now()-started)/1000,maxWorkletWallGapMs:data.maxWallGapMs,
          baseLatency:context.baseLatency??null,outputLatency:context.outputLatency??null,
          peak:0,rms:0,outsideUnit:0,maxDelta:0,largeJumps:0,silentRunFrames:0};
        let energy=0;
        for(const channel of [data.left,data.right])for(let i=1;i<channel.length;i++){
          const value=channel[i],delta=Math.abs(value-channel[i-1]);energy+=value*value;
          result.peak=Math.max(result.peak,Math.abs(value));if(Math.abs(value)>1)result.outsideUnit++;
          result.maxDelta=Math.max(result.maxDelta,delta);if(delta>.1)result.largeJumps++;
        }
        let silent=0;
        for(let i=Math.round(data.rate*2);i<data.frames-128;i++){
          silent=data.left[i]===0&&data.right[i]===0?silent+1:0;result.silentRunFrames=Math.max(result.silentRunFrames,silent);
        }
        result.rms=Math.sqrt(energy/Math.max(1,data.frames*2));
        await window.__uiAudioTest.flush();result.autosave={...window.__uiAudioAutosave};
        detach();tap.disconnect();tap.port.close();await window.__uiAudioTest.runtime.stop();
        return result;
      }, execution);
      Object.assign(result,{menuClicks,editCharacters,contextMenus,fileMenus,tabChanges});
      assert(result.audioSeconds>=seconds-.5,JSON.stringify(result));
      assert(result.peak>.05&&result.rms>.005,'Playback inaudible: '+JSON.stringify(result));
      assert.equal(result.outsideUnit,0,'Output clipping: '+JSON.stringify(result));
      assert.equal(result.largeJumps,0,'Waveform discontinuity: '+JSON.stringify(result));
      assert(result.silentRunFrames<128,'Silent quantum: '+JSON.stringify(result));
      assert(result.autosave.captures<editCharacters/10,
        'Typing must coalesce whole-project snapshots: '+JSON.stringify(result));
      results.push(result);
    }
    // Simulate the native close/reload path immediately after the final edit,
    // before the normal editing-delay save can run. Await the real public hook,
    // then reload the same origin and inspect the actual restored IndexedDB draft.
    await page.evaluate(() => {
      const editor=window.monaco.editor.getEditors().find(editor=>editor.getModel()?.uri.path==='/project/index.js');
      window.__uiAudioBeforeFinalEditCaptures=window.__uiAudioAutosave.captures;
      editor.onDidChangeModelContent(()=>{window.__uiAudioLastEditAt=performance.now();});
    });
    await page.locator('#editorHost .monaco-editor').click({position:{x:180,y:50}});
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('\n// Native flush must retain this final keyboard edit.\n',{delay:2});
    const expected=await page.evaluate(async()=>{
      const capturesBeforeFlush=window.__uiAudioAutosave.captures;
      const flushAfterLastEditMs=performance.now()-window.__uiAudioLastEditAt;
      await window.__tetoricaAutosaveFlush();
      return {content:await window.__uiAudioTest.persistedContent(),capturesBeforeFlush,
        capturesBeforeEdit:window.__uiAudioBeforeFinalEditCaptures,
        capturesAfterFlush:window.__uiAudioAutosave.captures,flushAfterLastEditMs};
    });
    assert.equal(expected.capturesBeforeFlush,expected.capturesBeforeEdit,
      'Final edit must still be waiting for its delayed autosave');
    assert(expected.capturesAfterFlush>expected.capturesBeforeFlush,'Native hook must save the pending edit');
    assert(expected.flushAfterLastEditMs<750,'Native hook must be tested before the idle-save delay');
    assert(expected.content.source.includes('Native flush must retain this final keyboard edit.'));
    assert.equal(expected.content.source,expected.content.storedSource);
    assert(expected.content.binary.length>0);
    assert(expected.content.directories.includes('/ui-audio/empty/nested'));
    await page.reload();
    try {
      await page.waitForFunction(()=>window.__uiAudioTest&&window.monaco?.editor?.getEditors().some(editor=>editor.getModel()?.uri.path==='/project/index.js'));
    }catch(error){
      console.error('Reload diagnostics',JSON.stringify({errors,state:await page.evaluate(()=>({
        status:document.getElementById('autosaveStatus')?.textContent,
        mainStatus:document.getElementById('status')?.textContent,
        startup:document.querySelector('[data-startup-message]')?.textContent,
        exposed:!!window.__uiAudioTest,monaco:!!window.monaco,
        models:window.monaco?.editor?.getEditors().map(editor=>editor.getModel()?.uri.path)
      }))}));throw error;
    }
    const restored=await page.evaluate(()=>window.__uiAudioTest.persistedContent());
    assert.deepEqual(restored,expected.content,'Native-flushed code, binary bytes and empty directories must survive reload');
    const persistence={nativeFlush:true,reloaded:true,flushAfterLastEditMs:expected.flushAfterLastEditMs,
      retainedSourceCharacters:restored.source.length,binaryFiles:restored.binary.length,
      binaryBytes:restored.binary.reduce((sum,file)=>sum+file.bytes,0),emptyDirectoryRetained:true};
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,browser:browserName,desktopAutosave:true,assetMiB,
      observation:'Graph PCM only; physical output underruns require device listening.',results,persistence}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
