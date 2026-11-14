// SPDX-License-Identifier: BSD-3-Clause
// Real Monaco / S-DSP UI checks; all speaker connections are muted before app startup.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {tmpdir} = require('node:os');
const {chromium, webkit} = require('playwright');

const config = {
  root: path.resolve(__dirname, '../docs'),
  entry: '/synth-snes/index.html',
  engines: 'chromium,webkit',
  out: path.join(tmpdir(), 'snes-synth-code-monaco-browser.json'),
};
for (let i = 2; i < process.argv.length; i++) {
  const match = /^--(root|entry|engines|out)(?:=(.*))?$/.exec(process.argv[i]);
  assert(match, `Unknown argument: ${process.argv[i]}`);
  const value = match[2] ?? process.argv[++i];
  assert(value && !value.startsWith('--'), `Missing --${match[1]} value`);
  config[match[1]] = value;
}
config.root = path.resolve(config.root);
config.out = path.resolve(config.out);
const engines = config.engines.split(',');
assert(config.entry.startsWith('/'), '--entry must start with /');
assert(engines.length && engines.every(name => ['chromium', 'webkit'].includes(name)), 'Unknown browser engine');

const CDN_PREFIX = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs/';
const isMonacoCdn = url => url.startsWith(CDN_PREFIX) && !url.includes('/../');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const served = new Map(), missing = [], blocked = [], cdn = new Map(), results = [];
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
};
class CdnUnavailableError extends Error {
  constructor(message) { super(message); this.name = 'CdnUnavailableError'; }
}
async function bounded(promise, label, ms = 30000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(`Timed out: ${label}`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    const filename = path.resolve(config.root, '.' + decodeURIComponent(pathname));
    assert(filename.startsWith(config.root + path.sep), 'Path is outside package root');
    const bytes = await fs.readFile(filename);
    const relative = path.relative(config.root, filename).split(path.sep).join('/');
    const metadata = {bytes: bytes.length, sha256: hash(bytes)};
    if (served.has(relative)) assert.deepEqual(served.get(relative), metadata, 'Asset changed during check');
    served.set(relative, metadata);
    response.setHeader('Content-Type', mime[path.extname(filename)] ?? 'application/octet-stream');
    response.end(bytes);
  } catch (error) {
    missing.push({url: request.url, error: error.message});
    response.writeHead(404).end(error.message);
  }
});

function muteDestinations() {
  const gates = [], connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function(destination, ...ports) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...ports);
    const gate = this.context.createGain();
    gate.gain.value = 0;
    connect.call(gate, destination);
    connect.call(this, gate, ...ports);
    gates.push(gate);
    return destination;
  };
  window.__synthCodeMonacoAudioAudit = () => ({
    destinationConnections: gates.length,
    physicallyMuted: gates.every(gate => gate.gain.value === 0),
  });
}

async function setSource(page, source) {
  await page.evaluate(source => {
    const host = document.getElementById('synthCodeEditorHost');
    const editor = monaco.editor.getEditors().find(item => host.contains(item.getDomNode()));
    if (!editor) throw Error('Code Monaco editor missing');
    editor.setValue(source);
  }, source);
}
async function diagnostics(page) {
  return bounded(page.evaluate(async () => {
    const model = monaco.editor.getModels().find(item => item.uri.path === '/project/index.js');
    if (!model) throw Error('Code index.js Monaco model missing');
    const worker = await (await monaco.languages.typescript.getJavaScriptWorker())(model.uri);
    const simplify = item => ({
      code: item.code, category: item.category, start: item.start,
      line: model.getPositionAt(item.start ?? 0).lineNumber, message: item.messageText,
    });
    return {
      syntax: (await worker.getSyntacticDiagnostics(model.uri.toString())).map(simplify),
      semantic: (await worker.getSemanticDiagnostics(model.uri.toString())).map(simplify),
    };
  }), 'Monaco JavaScript worker diagnostics', 60000);
}
async function definition(page, {needle, symbol, file, sourceSymbol}) {
  const navigation = await page.evaluate(async ({needle, symbol}) => {
    const host = document.getElementById('synthCodeEditorHost');
    const editor = monaco.editor.getEditors().find(item => host.contains(item.getDomNode()));
    const model = editor.getModel(), index = model.getValue().indexOf(needle);
    if (index < 0) throw Error('Definition probe missing: ' + needle);
    // Overloaded hardware methods can have several declaration locations.
    // Follow the first through the public editor opener instead of a peek list.
    editor.updateOptions({gotoLocation: {multipleDefinitions: 'goto'}});
    editor.setPosition(model.getPositionAt(index + needle.indexOf(symbol) + 1));
    editor.focus();
    const action = editor.getAction('editor.action.revealDefinition');
    // Registered editor commands need not appear in getAction(). trigger() is
    // the public command route also used by the app's source-view context menu.
    // The visible dialog and requested source model are still asserted below.
    if (action) await action.run();
    else editor.trigger('synth-code-monaco-check', 'editor.action.revealDefinition', {});
    return {dispatch: action ? 'action.run' : 'editor.trigger',
      relatedActions: editor.getSupportedActions().map(item => item.id).filter(id => /defin|declar|symbol/i.test(id))};
  }, {needle, symbol});
  const dialog = page.locator('dialog[data-monaco-definition="true"]');
  await dialog.waitFor({state: 'visible'}).catch(error => {
    throw Error(`${error.message}\nNavigation diagnostic: ${JSON.stringify(navigation)}`);
  });
  await page.waitForFunction(() => {
    const dialog = document.querySelector('dialog[data-monaco-definition="true"]');
    return dialog?.open && dialog.querySelector('strong')?.textContent.endsWith('.d.ts (read-only)');
  });
  await dialog.getByRole('button', {name: 'View implementation', exact: true}).click();
  await page.waitForFunction(file => {
    const dialog = document.querySelector('dialog[data-monaco-definition="true"]');
    return dialog?.querySelector('strong')?.textContent === file.split('/').at(-1) + ' (read-only)' ||
      /Could not load/.test(dialog?.querySelector('[role="status"]')?.textContent ?? '');
  }, file);
  assert.equal(await dialog.locator('strong').textContent(), file.split('/').at(-1) + ' (read-only)',
    await dialog.locator('[role="status"]').textContent());
  const result = await page.evaluate(file => {
    const model = monaco.editor.getModels().find(item => item.uri.path === '/tetorica-runtime/' + file);
    const editor = monaco.editor.getEditors().find(item => item.getModel() === model);
    return model && editor ? {
      path: model.uri.path, text: model.getValue(), position: editor.getPosition(),
      readOnly: editor.getOption(monaco.editor.EditorOption.readOnly),
      line: model.getLineContent(editor.getPosition().lineNumber),
    } : null;
  }, file);
  assert(result, 'Implementation opens a real Monaco source model');
  assert(result.readOnly, 'Implementation is read-only');
  assert(result.text.length > 1000 && result.text.split('\n').length > 30, 'Readable source, not a stub');
  assert(result.position.lineNumber > 1, 'Implementation navigates to the function');
  assert(result.line.includes(sourceSymbol ?? symbol), 'Implementation points to the requested symbol');
  const receipt = {file, symbol, bytes: Buffer.byteLength(result.text),
    sha256: hash(result.text), line: result.position.lineNumber, readOnly: result.readOnly, navigation};
  await dialog.getByRole('button', {name: 'Close', exact: true}).click();
  return receipt;
}

const GOOD_SOURCE=`// @ts-check
const snes = await useSoundChip('snes');
await snes.noteOn(CH1, choose(scale('C4','minorPentatonic',1)));
await beat(.5);
await snes.noteOff(CH1);
const state = await snes.getState();
context.pmon = state.pmon.active;
await livePrepare('chip',async api=>api.useSoundChip('snes'));
`;
const BAD_SOURCE=`// @ts-check
const snes = await useSoundChip('snes');
await useSoundChip('ym2612');
snes.noteOn(8,'C4');
snes.writeDsp(0x4c,1);
createSoundChip('snes');
`;
async function run(browser,name,origin){
  const context=await browser.newContext({viewport:{width:1240,height:1000},serviceWorkers:'block'}),page=await context.newPage(),errors=[],cdnFailures=[];
  const result={browser:name,steps:[]};
  page.on('pageerror',e=>errors.push(e.stack??e.message));
  page.on('requestfailed',request=>{if(isMonacoCdn(request.url()))cdnFailures.push({url:request.url(),error:request.failure()?.errorText});});
  page.on('response',response=>{if(isMonacoCdn(response.url())){cdn.set(response.url(),{status:response.status()});if(response.status()>=400)cdnFailures.push({url:response.url(),status:response.status()});}});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin||['blob:','data:'].includes(url.protocol)||isMonacoCdn(url.href))return route.continue();blocked.push(url.href);return route.abort();});
  await context.addInitScript(muteDestinations);
  const editor=()=>page.evaluate(()=>{const host=document.querySelector('#synthCodeEditorHost');return window.monaco?.editor?.getEditors().some(e=>host.contains(e.getDomNode()));});
  const waitModel=async path=>page.waitForFunction(path=>{const host=document.querySelector('#synthCodeEditorHost'),e=window.monaco?.editor?.getEditors().find(e=>host.contains(e.getDomNode()));return e?.getModel()?.uri.path==='/project'+path;},path);
  try{
    await page.goto(origin+config.entry);await page.waitForFunction(()=>!document.querySelector('.snes-main').inert);
    assert.equal(await page.evaluate(()=>Boolean(window.monaco)),false);
    await page.locator('#synthInputCodeTab').click();
    await page.waitForFunction(()=>document.querySelector('#synthCodeEditorHost').dataset.ready==='true'||/fallback|unavailable|could not load/i.test(document.querySelector('#synthCodeEditorNote').textContent),null,{timeout:60000});
    if(!await editor()){if(cdnFailures.length)throw new CdnUnavailableError(JSON.stringify(cdnFailures));throw Error(await page.locator('#synthCodeEditorNote').textContent());}
    assert(await page.locator('#synthCodeEditor').isHidden());await waitModel('/index.js');
    result.steps.push('actual Monaco loads lazily and displays the SNES starter');
    await setSource(page,GOOD_SOURCE);result.good=await diagnostics(page);assert.deepEqual(result.good,{syntax:[],semantic:[]});
    const completion=await page.evaluate(async()=>{
      const model=monaco.editor.getModels().find(m=>m.uri.path==='/project/index.js');model.setValue('await useSoundChip("");');const worker=await(await monaco.languages.typescript.getJavaScriptWorker())(model.uri);
      return (await worker.getCompletionsAtPosition(model.uri.toString(),model.getValue().indexOf('""')+1))?.entries.map(e=>e.name.replace(/^["']|["']$/g,'')).sort();
    });assert.deepEqual(completion,['snes']);
    await setSource(page,BAD_SOURCE);result.bad=await diagnostics(page);assert.deepEqual(result.bad.syntax,[]);for(const line of [3,4,5,6])assert(result.bad.semantic.some(d=>d.line===line),'invalid API on line '+line);
    result.steps.push('real language worker accepts SNES Code and rejects unsupported chips, raw methods and invalid lanes');
    await setSource(page,GOOD_SOURCE);await diagnostics(page);result.implementations=[];
    for(const probe of [{needle:"useSoundChip('snes')",symbol:'useSoundChip',file:'playground_code_runtime.js'},{needle:'snes.noteOn',symbol:'noteOn',file:'synth-snes/code_client.js'},{needle:'snes.getState',symbol:'getState',file:'synth-snes/code_client.js'}])result.implementations.push(await bounded(definition(page,probe),'implementation '+probe.symbol,60000));
    result.steps.push('Go to Definition opens the actual shared runtime and S-DSP performance facade');
    await page.locator('#snesFilesToggle').click();await page.locator('#snesFileSaveSoundButton').click();await waitModel('/presets/Sine.sdsp.json');
    const sound=await page.evaluate(()=>{const host=document.querySelector('#synthCodeEditorHost'),e=monaco.editor.getEditors().find(e=>host.contains(e.getDomNode()));const preset=JSON.parse(e.getValue());preset.name='Monaco edited sound';e.setValue(JSON.stringify(preset,null,2)+'\n');return preset;});
    await page.keyboard.press('ControlOrMeta+s');await page.locator('#snesFilesTree button[data-file-path="/index.js"]').click();await waitModel('/index.js');
    await page.locator('#snesFilesTree button[data-file-path="/presets/Sine.sdsp.json"]').click();await waitModel('/presets/Sine.sdsp.json');
    assert.equal(await page.locator('#instrumentName').inputValue(),sound.name);assert(await page.locator('#synthCodeRunButton').isDisabled());
    await page.locator('#snesFilesTree button[data-file-path="/index.js"]').click();await waitModel('/index.js');await setSource(page,GOOD_SOURCE);await page.keyboard.press('ControlOrMeta+s');
    result.steps.push('mixed JSON / JavaScript edits preserve both files and explicitly apply the edited sound');
    await page.locator('#synthCodeExpandButton').click();for(const width of [1240,390]){
      await page.setViewportSize({width,height:900});
      await page.waitForFunction(()=>{const host=document.querySelector('#synthCodeEditorHost'),e=monaco.editor.getEditors().find(e=>host.contains(e.getDomNode()));return e?.getLayoutInfo().width>100&&e.getLayoutInfo().height>=240&&host.querySelector('.view-lines')?.textContent.includes('useSoundChip');});const size=await page.locator('#synthCodeEditorHost').boundingBox();assert(size.width>100&&size.height>240);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await page.locator('#synthInputSection').screenshot({path:config.out.replace(/\.json$/,'-'+name+'-'+width+'.png')});
    }
    await page.setViewportSize({width:1240,height:1000});await page.locator('#synthCodeExpandButton').click();await page.reload();await page.waitForFunction(()=>document.querySelector('#synthCodeEditorHost').dataset.ready==='true');await waitModel('/index.js');
    const restored=await page.evaluate(()=>{const host=document.querySelector('#synthCodeEditorHost');return monaco.editor.getEditors().find(e=>host.contains(e.getDomNode())).getValue();});assert.equal(restored,GOOD_SOURCE);assert.equal(await page.locator('#instrumentName').inputValue(),sound.name);
    result.steps.push('expanded editor stays visible at 1240/390px; reload restores Code and edited sound');
    await page.locator('#synthCodeRunButton').click();await page.waitForFunction(()=>/Running|Playing/.test(document.querySelector('#synthCodeState').textContent));await page.waitForTimeout(400);await page.locator('#synthCodeStopButton').click();assert.equal(await page.locator('#synthCodeError').textContent(),'');
    result.audio=await page.evaluate(()=>__synthCodeMonacoAudioAudit());assert(result.audio.physicallyMuted);assert(result.audio.destinationConnections>0);
    result.steps.push('Run / Stop consumes actual Monaco text with all destinations gain zero');
    await page.screenshot({path:config.out.replace(/\.json$/,'-'+name+'.png'),fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);assert.deepEqual(blocked,[]);return result;
  }catch(error){
    if(cdnFailures.length&&/Timeout|Timed out|could not load/i.test(error.message))throw new CdnUnavailableError(error.message+' '+JSON.stringify(cdnFailures));
    throw error;
  }finally{await context.close();}
}
(async () => {
  let failure;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const name of engines) {
      console.log('Checking actual Monaco: '+name);
      const browser = await bounded(({chromium, webkit})[name].launch({
        headless: true, ...(name === 'chromium' ? {args: ['--mute-audio']} : {}),
      }), 'launch ' + name);
      try {
        results.push(await run(browser, name, origin));
        console.log(`PASS ${name}: S-DSP real Monaco editing, completion, persistence and implementation navigation`);
      } finally { await browser.close(); }
    }
  } catch (error) { failure = error; }
  finally {
    server.closeIdleConnections?.(); server.closeAllConnections?.();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
  const unavailable = failure instanceof CdnUnavailableError;
  const report = {
    passed: !failure, status: failure ? unavailable ? 'cdn-unavailable' : 'failed' : 'passed',
    infrastructureFailure: unavailable, root: config.root, entry: config.entry,
    userCodeExecuted: true, listeningPerformed: false, physicalOutputMuted: true,
    error: failure ? failure.stack ?? failure.message : undefined, results,
    missing, blocked, cdn: Object.fromEntries([...cdn].sort(([a], [b]) => a.localeCompare(b))),
    assets: Object.fromEntries([...served].sort(([a], [b]) => a.localeCompare(b))),
  };
  await fs.mkdir(path.dirname(config.out), {recursive: true});
  await fs.writeFile(config.out, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.status.toUpperCase()} receipt ${config.out}`);
  if (failure) { console.error(failure); process.exitCode = unavailable ? 2 : 1; }
})().catch(error => { console.error(error); process.exitCode = 1; });
