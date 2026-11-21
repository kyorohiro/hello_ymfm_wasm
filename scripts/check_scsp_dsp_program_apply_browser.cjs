// SPDX-License-Identifier: BSD-3-Clause
// Exercise the shipped DSP editor and real SCSP Worklet, never a physical output.
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');

const repository = path.resolve(__dirname, '..');
const config = {
  root: path.join(repository, 'docs'), entry: '/synth-scsp/index.html',
  engines: 'chromium,webkit', out: path.join(os.tmpdir(), 'scsp-dsp-program-apply-browser.json'),
};
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const match = /^--(root|entry|engines|out)(?:=(.+))?$/.exec(args[index]);
  assert(match, 'Unknown argument ' + args[index]);
  config[match[1]] = match[2] ?? args[++index];
  assert(config[match[1]], 'Missing value for ' + match[1]);
}
config.root = path.resolve(config.root);
assert(config.entry.startsWith('/') && !/[?#]/.test(config.entry));
const engines = config.engines.split(',');
assert(engines.length && engines.every(name => ['chromium', 'webkit'].includes(name)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.md': 'text/plain', '.scspasm': 'text/plain',
};
const served = new Map();
const server = http.createServer(async (request, response) => {
  try {
    let relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (relative === '/favicon.ico') {response.writeHead(204).end(); return;}
    if (relative.endsWith('/')) relative += 'index.html';
    const file = path.resolve(config.root, '.' + relative);
    assert(file.startsWith(config.root + path.sep), 'Request stays inside the isolated static site');
    const bytes = await fs.readFile(file);
    served.set(path.relative(config.root, file).split(path.sep).join('/'), {bytes: bytes.length, sha256: sha(bytes)});
    response.writeHead(200, {'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store'}).end(bytes);
  } catch {response.writeHead(404).end();}
});

// Install before application modules. The real signal feeds analysers followed
// by gains fixed at zero; no signal ever connects directly to a destination.
function installSilentAudit() {
  const Context = window.AudioContext ?? window.webkitAudioContext;
  const Worklet = window.AudioWorkletNode;
  const connect = AudioNode.prototype.connect;
  const post = MessagePort.prototype.postMessage;
  const audit = window.__scspDspApplyAudit = {
    contexts: [], nodes: [], meters: [], commands: [], clipboard: [],
    clipboardMode: 'success', sequence: 0, holdNextApply: false, heldApply: null,
  };
  window.AudioContext = class extends Context {
    constructor(...args) {super(...args); audit.contexts.push(this);}
  };
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {
    constructor(context, name, options) {
      super(context, name, options); audit.nodes.push({name, node: this});
    }
  };
  AudioNode.prototype.connect = function(destination, ...rest) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...rest);
    const analyser = this.context.createAnalyser(), mute = this.context.createGain();
    analyser.fftSize = 2048;
    mute.gain.value = 0;
    connect.call(this, analyser); connect.call(analyser, mute); connect.call(mute, destination);
    audit.meters.push({analyser, mute});
    return destination;
  };
  MessagePort.prototype.postMessage = function(data, ...rest) {
    if (data?.method || data?.type === 'chip-inspector') audit.commands.push(structuredClone(data));
    if (data?.method === 'applyDspProgram' && audit.holdNextApply) {
      audit.holdNextApply = false;
      audit.heldApply = {port: this, id: data.id, data: structuredClone(data), rest};
      return;
    }
    return post.call(this, data, ...rest);
  };
  audit.rejectHeldApply = () => {
    if (!audit.heldApply) throw Error('No pending DSP Apply transport request');
    const {port, id} = audit.heldApply; audit.heldApply = null;
    port.dispatchEvent(new MessageEvent('message', {data: {id, error: 'Injected DSP Apply transport rejection'}}));
  };
  audit.releaseHeldApply = () => {
    if (!audit.heldApply) throw Error('No pending DSP Apply transport request');
    const {port, data, rest} = audit.heldApply; audit.heldApply = null;
    post.call(port, data, ...rest);
  };
  // Both paths are test doubles, never operating-system clipboard calls.
  Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
    async writeText(text) {
      audit.clipboard.push({method: 'clipboard', text: String(text)});
      if (audit.clipboardMode !== 'success') throw Error('Clipboard test denial');
    },
  }});
  Object.defineProperty(document, 'execCommand', {configurable: true, value(command) {
    const active = document.activeElement;
    const text = typeof active?.value === 'string' ? active.value : String(window.getSelection());
    const result = command === 'copy' && audit.clipboardMode === 'fallback';
    audit.clipboard.push({method: 'execCommand', command, text, result}); return result;
  }});
  audit.level = () => {
    let peak = 0, sum = 0, square = 0, count = 0;
    for (const {analyser} of audit.meters) {
      const values = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(values);
      for (const value of values) {
        if (!Number.isFinite(value)) throw Error('Non-finite destination PCM');
        peak = Math.max(peak, Math.abs(value)); sum += value; square += value * value; count++;
      }
    }
    const denominator = Math.max(1, count);
    return {peak, rms: Math.sqrt(square / denominator),
      acRms: Math.sqrt(Math.max(0, square / denominator - (sum / denominator) ** 2))};
  };
  audit.graph = () => ({contexts: audit.contexts.length, contextStates: audit.contexts.map(item => item.state),
    nodes: audit.nodes.map(item => item.name), destinationRoutes: audit.meters.length,
    physicalOutputMuted: audit.meters.every(item => item.mute.gain.value === 0)});
  audit.request = command => new Promise((resolve, reject) => {
    const node = audit.nodes.findLast(item => item.name === 'tetorica-scsp-synth')?.node;
    if (!node) {reject(Error('SCSP primary Synth endpoint is unavailable')); return;}
    const id = 'dsp-program-apply-audit-' + ++audit.sequence;
    const timer = setTimeout(() => {
      node.port.removeEventListener('message', receive); reject(Error('SCSP response exceeded five seconds'));
    }, 5000);
    function receive({data}) {
      if (data?.id !== id) return;
      clearTimeout(timer); node.port.removeEventListener('message', receive);
      if (data.error) {const error = Error(data.error); error.name = data.name ?? 'Error'; reject(error);}
      else resolve(data.value);
    }
    node.port.addEventListener('message', receive); node.port.start();
    node.port.postMessage({...command, id});
  });
  audit.inspect = () => audit.request({type: 'chip-inspector', action: 'read'});
}

const graph = page => page.evaluate(() => __scspDspApplyAudit.graph());
const inspect = page => page.evaluate(() => __scspDspApplyAudit.inspect());
const request = (page, command) => page.evaluate(command => __scspDspApplyAudit.request(command), command);
const program = page => request(page, {method: 'readDspProgram', args: []});
const mutations = page => page.evaluate(() => __scspDspApplyAudit.commands.filter(command =>
  !(command.type === 'chip-inspector' && command.action === 'read') &&
  !['readAuthoring', 'readPhysical', 'readAudition', 'readDspProgram'].includes(command.method)));
const draft = page => page.locator('#scspDspProgramEditor').inputValue();
const status = page => page.locator('#scspDspProgramStatus').textContent();
const applied = page => page.locator('#scspDspProgramApplied').textContent();
const stableVoices = state => ({bankId: state.bankId, voiceGroups: state.voiceGroups,
  playingSampleIds: state.playingSampleIds, codeActive: state.codeActive,
  codeSession: state.codeSession, codeLanes: state.codeLanes});
async function until(test, label, limit = 200) {
  for (let attempt = 0; attempt < limit; attempt++) {
    if (await test()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('Timed out waiting for ' + label);
}
async function waitState(page, predicate, label) {
  let state;
  await until(async () => {state = await inspect(page); return predicate(state);}, label);
  return state;
}
async function level(page, nonzero = true) {
  let value;
  await until(async () => {
    value = await page.evaluate(() => __scspDspApplyAudit.level());
    return nonzero ? value.acRms > 0.00005 : value.peak < 1e-7;
  }, nonzero ? 'nonzero real SCSP PCM' : 'real SCSP output silence');
  return value;
}
async function openDsp(page) {
  await page.locator('#scspDspTab').click();
  await page.locator('#scspDspProgramEditor').waitFor({state: 'visible'});
}
async function ready(page) {
  await page.waitForFunction(() => document.getElementById('scspDspProgramRows')?.children.length === 6 &&
    !document.getElementById('voiceMode').disabled);
  await openDsp(page);
}
async function edit(page, source) {
  await page.locator('#scspDspProgramEditor').fill(source);
  assert(await page.locator('#scspDspProgramApply').isDisabled(), 'Editing invalidates the previous Check');
}
async function checkValid(page, pending = false) {
  await page.locator('#scspDspProgramCheck').click();
  assert.equal((await page.locator('#scspDspProgramError').textContent()).trim(), '');
  assert.equal(await page.locator('#scspDspProgramApply').isDisabled(), pending,
    pending ? 'A valid newer draft waits for the previous Apply acknowledgement' : 'Valid checked draft can be applied');
  assert.match(await page.locator('#scspDspProgramPreview').textContent(), /000:/);
}
async function apply(page) {
  await page.locator('#scspDspProgramApply').click();
  await until(async () => !(await page.locator('#scspDspProgramApply').isDisabled()), 'Apply acknowledged');
  assert.equal((await page.locator('#scspDspProgramError').textContent()).trim(), '');
  assert.notEqual(await page.locator('#scspDspProgramStatus').getAttribute('data-error'), 'true', await status(page));
  assert.match(await status(page), /program (?:already )?applied/i);
}
async function resetAndApply(page) {
  await page.locator('#scspDspProgramReset').click();
  assert(await page.locator('#scspDspProgramApply').isDisabled(), 'Reset draft still needs Check');
  await checkValid(page); await apply(page);
}
async function copy(page, mode, expected) {
  const before = await page.evaluate(mode => {
    __scspDspApplyAudit.clipboardMode = mode; return __scspDspApplyAudit.clipboard.length;
  }, mode);
  await page.locator('#scspDspProgramCopy').click();
  await until(() => page.evaluate(before => __scspDspApplyAudit.clipboard.length > before, before), 'Copy attempt');
  if (mode === 'failure') await until(async () => /unavailable|could not|failed|unable/i.test(await status(page)), 'Copy denial');
  else await until(async () => /copied/i.test(await status(page)), 'Copy success');
  const attempts = await page.evaluate(before => __scspDspApplyAudit.clipboard.slice(before), before);
  assert.equal(attempts.find(item => item.method === 'clipboard').text, expected, 'Copy preserves exact current draft');
  if (mode !== 'success') assert.equal(attempts.find(item => item.method === 'execCommand').text, expected);
  assert.equal(await page.locator('#scspDspProgramView textarea').count(), 1, 'Temporary copy textarea is removed');
  return {mode, attempts: attempts.map(({text, ...rest}) => ({...rest, bytes: text.length})), status: await status(page)};
}
async function save(page, expected) {
  const pending = page.waitForEvent('download'); await page.locator('#scspDspProgramSave').click();
  const download = await pending;
  assert.match(download.suggestedFilename(), /\.scspasm$/);
  const source = await fs.readFile(await download.path(), 'utf8');
  assert.equal(source, expected, 'Save preserves the exact current draft');
  return {filename: download.suggestedFilename(), bytes: Buffer.byteLength(source), sha256: sha(source)};
}
async function startCode(page) {
  if (await page.locator('#scspFilesPanel').isHidden()) await page.locator('#scspFilesToggle').click();
  await until(() => page.locator('#scspFileImportButton').isEnabled(), 'Files ready');
  for (let index = 0; index < 12; index++) {
    const closed = page.locator('#scspFilesTree details:not([open]) > summary');
    if (!await closed.count()) break;
    await closed.first().click();
  }
  await page.locator('#scspFilesTree button[data-file-path="/index.js"]').click();
  await page.locator('#synthInputCodeTab').click();
  await page.locator('#synthCodeEditor').waitFor({state: 'visible'});
  await page.locator('#synthCodeEditor').fill("const scsp = await useSoundChip('scsp');\nawait scsp.noteOn(CH1, 'E3');\n");
  await page.locator('#synthCodeRunButton').click();
  await waitState(page, state => state.codeActive && state.voiceGroups.some(group => group.held && group.owner?.kind === 'code'),
    'live Code voice');
}
async function inputValue(page, id, value) {
  await page.locator('#' + id).evaluate((node, value) => {
    node.value = String(value); node.dispatchEvent(new Event('change', {bubbles: true}));
  }, value);
}

async function check(browser, name, origin, assemble, expectedWords) {
  const page = await browser.newPage({acceptDownloads: true, serviceWorkers: 'block', viewport: {width: 1360, height: 1024}});
  const errors = [], missing = [], blockedEditor = [], unexpectedExternal = [], cases = [];
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {if (response.url().startsWith(origin) && response.status() >= 400) missing.push(response.url());});
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    if (url.href.startsWith('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/')) blockedEditor.push(url.href);
    else unexpectedExternal.push(url.href);
    return route.abort('blockedbyclient');
  });
  await page.addInitScript(installSilentAudit);
  try {
    await page.goto(origin + config.entry); await ready(page);
    assert.equal((await graph(page)).contexts, 0);
    assert.equal(await page.locator('#scspDspReferencePanel').evaluate(node => node.open), false);
    const builtin = await draft(page), initialApplied = await applied(page);
    assert.deepEqual(assemble(builtin), expectedWords);
    const wetless = builtin.replace(/\bEWT=1\b/, 'EWT=0');
    assert.notEqual(wetless, builtin);
    const wetlessWords = assemble(wetless);
    assert.notDeepEqual(wetlessWords, expectedWords);
    await edit(page, wetless); await checkValid(page);
    assert.equal(await applied(page), initialApplied, 'Check does not Apply');
    assert.equal((await graph(page)).contexts, 0); assert.deepEqual(await mutations(page), []);
    cases.push('cold editor and Check do not create audio or issue mutations');

    const invalidDraft = wetless + '\n006: UNKNOWN=1\n';
    await edit(page, invalidDraft);
    const clipboard = [await copy(page, 'success', invalidDraft), await copy(page, 'fallback', invalidDraft),
      await copy(page, 'failure', invalidDraft)];
    const invalidExport = await save(page, invalidDraft);
    assert.equal(await applied(page), initialApplied);
    assert.equal((await graph(page)).contexts, 0);
    cases.push('Copy and Save preserve current invalid draft with no sound commands');

    await edit(page, wetless);
    // The draft backup must survive navigation, but it must not become applied.
    await page.waitForTimeout(300); await page.reload(); await ready(page);
    assert.equal(await draft(page), wetless, 'Draft backup survives reload');
    assert.equal(await applied(page), initialApplied, 'Restored draft never auto-applies');
    assert(await page.locator('#scspDspProgramApply').isDisabled());
    assert.equal((await graph(page)).contexts, 0); assert.deepEqual(await mutations(page), []);
    cases.push('reload restores only draft, without Check, Apply or audio');
    await checkValid(page); await apply(page);
    assert.notEqual(await applied(page), initialApplied, 'Cold Apply has explicit applied-program status');
    assert.equal((await graph(page)).contexts, 0); assert.deepEqual(await mutations(page), []);
    cases.push('cold Apply remains silent and does not create AudioContext');

    await page.setViewportSize({width: 390, height: 844});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(mobileOverflow <= 1, '390px document overflow ' + mobileOverflow);
    const editorBounds = await page.locator('#scspDspProgramEditor').boundingBox();
    assert(editorBounds.x >= 0 && editorBounds.x + editorBounds.width <= 391, 'Textarea fits narrow viewport');
    await page.locator('#scspDspProgramEditor').focus();
    await page.keyboard.press('End'); await page.keyboard.type('; asdfg keyboard safety');
    assert.equal((await graph(page)).contexts, 0, 'Draft letter keys do not create a keyboard voice');
    await edit(page, wetless); await checkValid(page);
    await page.locator('#scspDspProgramView').screenshot({path: config.out.replace(/\.json$/, '') + '-' + name + '-mobile.png'});
    await page.locator('#scspDspReferencePanel').evaluate(node => {node.open = true;});
    const region = page.locator('#scspDspReferencePanel [role="region"][tabindex="0"]');
    await region.focus();
    for (let index = 0; index < 12; index++) await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => {
      const region = document.querySelector('#scspDspReferencePanel [role="region"]');
      const role = region.querySelector('thead th:last-child').getBoundingClientRect(), bounds = region.getBoundingClientRect();
      return region.scrollLeft > 0 && role.left < bounds.right && role.right > bounds.left;
    });
    const right = await region.evaluate(node => node.scrollLeft); await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(right => document.querySelector('#scspDspReferencePanel [role="region"]').scrollLeft < right, right);
    await page.locator('#scspDspReferencePanel').evaluate(node => {node.open = false;});
    await page.setViewportSize({width: 1360, height: 1024});
    cases.push('390px editor and keyboard-scrollable collapsed reference');

    await page.locator('#start').click();
    await page.waitForFunction(() => document.getElementById('start').textContent === 'Audio ready');
    const migrated = await program(page);
    assert.deepEqual(migrated.words, Array.from(wetlessWords), 'Audio startup installs cold-applied custom program');
    assert(migrated.custom);
    const startupCommands = await mutations(page);
    assert(startupCommands.some(item => item.method === 'applyDspProgram'), 'Startup sends applied program to primary Worklet');
    const auditionBefore = await request(page, {method: 'readAudition', args: []});
    await resetAndApply(page);
    assert.deepEqual((await program(page)).words, Array.from(expectedWords));
    cases.push('cold-applied MPRO migrates through asynchronous real Worklet startup');

    await page.locator('#scspDelayPanel').evaluate(node => {node.open = true;});
    // Longer than the analyser window, so an accidental ring clear during an
    // unchanged Apply would create an observable silent gap.
    await inputValue(page, 'delayTime', 100); await inputValue(page, 'delayFeedback', 0);
    await inputValue(page, 'effectSend', 7); await inputValue(page, 'effectReturn', 7);
    await page.locator('#effectEnabled').check();
    await waitState(page, state => state.config.effect.enabled && state.config.effect.timeMs === 100 &&
      state.config.effect.feedback === 0 && state.config.effect.returnLevel === 7, 'short wet-only Delay configuration');
    await request(page, {type: 'chip-inspector', action: 'invoke', method: 'setMix', args: [0, {directLevel: 0}]});
    await startCode(page);
    await openDsp(page);
    await page.locator('#scspDspProgramCheck').focus();
    await page.keyboard.down('a');
    const held = await waitState(page, state => state.voiceGroups.filter(group => group.held).length >= 2 && state.codeActive,
      'simultaneous held keyboard and Code voices');
    const audibleBefore = await level(page);
    const heldStable = stableVoices(held), beforeProgram = await program(page);
    const voicePresetBefore = await request(page, {method: 'exportPatch', args: []});
    const beforeMutations = (await mutations(page)).length;
    await page.locator('#scspDspProgramEditor').focus();
    // Do not synthesize an 'a' keyup: that is the physical key held below.
    await page.keyboard.press('End'); await page.keyboard.type('; jkl');
    assert.deepEqual(stableVoices(await inspect(page)), heldStable, 'Live editor letter keys never start musical notes');
    await edit(page, wetless); await checkValid(page);
    assert.deepEqual(await program(page), beforeProgram, 'Check does not write MPRO');
    assert.equal((await mutations(page)).length, beforeMutations, 'Typing and Check issue no sound mutation');
    assert.deepEqual(stableVoices(await inspect(page)), heldStable);
    const audibleAfterCheck = await level(page);
    cases.push('Check preserves held voices, Code session, program and real wet signal');

    const invalidSources = [
      {kind: 'syntax', source: builtin + '\n006: UNKNOWN=1\n', error: /line\s+\d+/i},
      {kind: 'TABLE', source: builtin.replace('MRD=1', 'MRD=1 TABLE=1'), error: /TABLE/i},
      {kind: 'IRA', source: builtin.replace('IRA=32', 'IRA=63'), error: /IRA/i},
      {kind: 'even memory read', source: builtin.replace(/^(000:.*)$/m, '$1 MRD=1'), error: /odd|even|MRD|memory/i},
      {kind: 'RAW', source: builtin.replace(/^(000:.*)$/m, '$1 RAW0=0x8000'), error: /RAW|bit|unsupported/i},
    ];
    const rejected = [];
    for (const invalid of invalidSources) {
      assert.notEqual(invalid.source, builtin, 'Invalid fixture changes ' + invalid.kind);
      await edit(page, invalid.source); await page.locator('#scspDspProgramCheck').click();
      const error = (await page.locator('#scspDspProgramError').textContent()).trim();
      assert.match(error, invalid.error); assert.match(error, /line\s+\d+/i, 'Check identifies source line');
      assert(await page.locator('#scspDspProgramApply').isDisabled());
      assert.deepEqual(await program(page), beforeProgram); assert.deepEqual(stableVoices(await inspect(page)), heldStable);
      await level(page); rejected.push({kind: invalid.kind, error});
    }
    assert.equal((await mutations(page)).length, beforeMutations);
    cases.push('syntax and four execution-profile errors preserve program, voices and wet output');

    // A successful ACK belongs to its captured candidate A. It must not erase
    // or invalidate a newer checked candidate B entered while A was pending.
    await edit(page, builtin); await checkValid(page);
    await page.evaluate(() => {__scspDspApplyAudit.holdNextApply = true;});
    const beforeSuccessApplied = await applied(page);
    await page.locator('#scspDspProgramApply').click();
    await until(() => page.evaluate(() => !!__scspDspApplyAudit.heldApply), 'held successful Apply');
    await edit(page, wetless); await checkValid(page, true);
    const checkedNewerPreview = await page.locator('#scspDspProgramPreview').textContent();
    await page.evaluate(() => __scspDspApplyAudit.releaseHeldApply());
    await until(() => page.locator('#scspDspProgramApply').isEnabled(), 'newer checked draft after old ACK');
    assert.equal(await applied(page), beforeSuccessApplied, 'Acknowledged built-in A remains the applied program');
    assert.equal(await draft(page), wetless, 'Successful old ACK preserves the newer B draft');
    assert.equal(await page.locator('#scspDspProgramPreview').textContent(), checkedNewerPreview,
      'Successful old ACK preserves the newer checked preview');
    assert.match(await page.locator('#scspDspProgramDraftStatus').textContent(), /checked.*unapplied/i,
      'Newer checked B is clearly marked unapplied, without asking for Check again');
    assert.deepEqual(await program(page), beforeProgram, 'Identical A is a no-op at the real audio owner');
    assert.deepEqual(stableVoices(await inspect(page)), heldStable); await level(page);
    cases.push('successful older Apply ACK preserves newer checked draft, enabled Apply and unapplied status');

    await edit(page, wetless); await checkValid(page);
    await page.evaluate(() => {__scspDspApplyAudit.holdNextApply = true;});
    const beforeRejectApplied = await applied(page);
    await page.locator('#scspDspProgramApply').click();
    await until(() => page.evaluate(() => !!__scspDspApplyAudit.heldApply), 'held transport Apply');
    assert(await page.locator('#scspDspProgramApply').isDisabled(), 'Apply is disabled while pending');
    assert.equal(await applied(page), beforeRejectApplied, 'Pending Apply does not claim success');
    assert.deepEqual(await program(page), beforeProgram);
    await edit(page, invalidDraft);
    await page.evaluate(() => __scspDspApplyAudit.rejectHeldApply());
    await until(async () => /Injected DSP Apply transport rejection/.test(await status(page)),
      'transport rejection feedback');
    assert.equal(await page.locator('#scspDspProgramStatus').getAttribute('data-error'), 'true');
    assert.equal(await applied(page), beforeRejectApplied);
    assert.equal(await draft(page), invalidDraft, 'A pending Apply never replaces newer draft edits');
    assert(await page.locator('#scspDspProgramApply').isDisabled(), 'Newer un-checked draft stays ineligible after rejection');
    assert.deepEqual(await program(page), beforeProgram); assert.deepEqual(stableVoices(await inspect(page)), heldStable);
    await level(page);
    cases.push('pending transport failure does not claim or install a new program');

    await edit(page, wetless); await checkValid(page); await apply(page);
    const wetlessProgram = await program(page);
    assert.deepEqual(wetlessProgram.words, Array.from(wetlessWords));
    assert(wetlessProgram.revision > beforeProgram.revision);
    assert.deepEqual(stableVoices(await inspect(page)), heldStable, 'Changed Apply retains voices and Code session');
    const silentAfterApply = await level(page, false);
    assert.deepEqual(await request(page, {method: 'exportPatch', args: []}), voicePresetBefore,
      'Custom DSP program never changes the portable voice preset format or content');
    assert.deepEqual(await request(page, {method: 'readAudition', args: []}), auditionBefore,
      'Primary Synth DSP Apply leaves the separate audition instrument unchanged');
    cases.push('explicit EWT=0 Apply changes actual wet output while voices and Code survive');

    // Bypass the UI's Check: the audio owner must validate the full request too.
    const invalidWords = Array.from(wetlessWords); invalidWords[0] |= 0x8000;
    const rawRejected = await page.evaluate(async words => {
      try {await __scspDspApplyAudit.request({method: 'applyDspProgram', args: [words]}); return null;}
      catch (error) {return error.message;}
    }, invalidWords);
    assert.match(rawRejected, /RAW|bit|unsupported/i);
    assert.deepEqual(await program(page), wetlessProgram);
    assert.deepEqual(stableVoices(await inspect(page)), heldStable); await level(page, false);
    cases.push('Worklet rejects unchecked invalid program atomically');

    await page.locator('#scspDspProgramReset').click();
    assert.deepEqual(await program(page), wetlessProgram, 'Reset only changes the draft');
    await checkValid(page);
    assert.deepEqual(await program(page), wetlessProgram, 'Checking reset does not change the applied program');
    await apply(page);
    const restoredProgram = await program(page), audibleRestored = await level(page);
    assert.deepEqual(restoredProgram.words, Array.from(expectedWords)); assert(!restoredProgram.custom);
    assert.deepEqual(stableVoices(await inspect(page)), heldStable);
    const noOpBefore = await program(page);
    await page.evaluate(() => {
      const audit = __scspDspApplyAudit;
      audit.continuity = [audit.level()];
      audit.continuityTimer = setInterval(() => audit.continuity.push(audit.level()), 8);
    });
    await apply(page);
    await page.waitForTimeout(350);
    const continuity = await page.evaluate(() => {
      clearInterval(__scspDspApplyAudit.continuityTimer); return __scspDspApplyAudit.continuity;
    });
    assert(continuity.length >= 10, 'Observe a complete unchanged-Apply delay window');
    assert(continuity.every(item => item.acRms > 0.00005), 'Unchanged Apply never clears the wet delay ring');
    assert.deepEqual(await program(page), noOpBefore, 'Unchanged Apply does not restart DSP or advance its revision');
    assert.deepEqual(stableVoices(await inspect(page)), heldStable);
    for (let index = 0; index < 8; index++) {await level(page); await page.waitForTimeout(15);}
    cases.push('Reset/Check/Apply restores wet sound; unchanged Apply preserves program revision and held output');

    const exportBefore = (await mutations(page)).length;
    await copy(page, 'success', builtin);
    const savedValid = await save(page, builtin);
    assert.deepEqual(assemble(builtin), expectedWords);
    assert.equal((await mutations(page)).length, exportBefore, 'Export never sends sound mutations');
    assert.deepEqual(stableVoices(await inspect(page)), heldStable);
    await page.locator('#scspDspProgramView').screenshot({path: config.out.replace(/\.json$/, '') + '-' + name + '-desktop.png'});
    await page.keyboard.up('a');
    await page.locator('#stop').click();
    await waitState(page, state => !state.codeActive && state.voiceGroups.every(group => !group.held), 'Stop releases all owners');
    await level(page, false);
    const activeGraph = await graph(page);
    assert.equal(activeGraph.contexts, 1);
    assert.equal(activeGraph.nodes.filter(item => item === 'tetorica-scsp-synth').length, 1);
    assert(activeGraph.destinationRoutes > 0 && activeGraph.physicalOutputMuted);
    assert.deepEqual(errors, []); assert.deepEqual(missing, []); assert.deepEqual(unexpectedExternal, []);
    return {browser: name, passed: true, cases, mobileOverflow, clipboard, invalidExport, savedValid,
      rejected, rawRejected, beforeProgram: {revision: beforeProgram.revision, custom: beforeProgram.custom},
      changedProgram: {revision: wetlessProgram.revision, custom: wetlessProgram.custom},
      audibleBefore, audibleAfterCheck, silentAfterApply, audibleRestored,
      unchangedApplyContinuity: {samples: continuity.length, minimumAcRms: Math.min(...continuity.map(item => item.acRms))},
      graph: activeGraph,
      blockedEditor, errors, missing};
  } catch (error) {
    error.browserResult = {browser: name, passed: false, cases, error: error.stack ?? String(error), errors, missing,
      status: await status(page).catch(() => null), applied: await applied(page).catch(() => null),
      draftStatus: await page.locator('#scspDspProgramDraftStatus').textContent().catch(() => null),
      programError: await page.locator('#scspDspProgramError').textContent().catch(() => null),
      audioStatus: await page.locator('#status').textContent().catch(() => null)};
    await page.screenshot({path: config.out.replace(/\.json$/, '') + '-' + name + '-failure.png', fullPage: true}).catch(() => {});
    throw error;
  } finally {await page.close();}
}

(async () => {
  const {assembleScspDsp} = await import(pathToFileURL(path.join(repository, 'docs/synth-scsp/dsp_assembler.js')));
  const {delayProgram} = await import(pathToFileURL(path.join(repository, 'docs/synth-scsp/dsp.js')));
  const expectedWords = delayProgram(), results = [];
  let failure;
  await fs.mkdir(path.dirname(config.out), {recursive: true});
  try {
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const name of engines) {
      const browser = await ({chromium, webkit}[name]).launch({headless: true,
        ...(name === 'chromium' ? {args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required']} : {})});
      try {results.push(await check(browser, name, origin, assembleScspDsp, expectedWords));}
      finally {await browser.close();}
      console.log('PASS ' + name + ' SCSP DSP Check / Apply (physical gain zero)');
    }
  } catch (error) {failure = error; if (error.browserResult) results.push(error.browserResult);}
  finally {
    server.closeAllConnections?.(); if (server.listening) await new Promise(resolve => server.close(resolve));
    await fs.writeFile(config.out, JSON.stringify({passed: !failure, entry: config.entry,
      physicalOutputMuted: true, operatingSystemClipboardUsed: false, listeningPerformed: false,
      staticSiteOnly: true, results, assets: Object.fromEntries([...served].sort())}, null, 2) + '\n');
  }
  if (failure) throw failure;
})().catch(error => {console.error(error); process.exitCode = 1;});
