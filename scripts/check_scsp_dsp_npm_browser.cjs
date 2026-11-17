// SPDX-License-Identifier: BSD-3-Clause
// Verify the installed npm tarball in isolated browsers with audio creation blocked.
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {chromium, webkit} = require('playwright');

const options = {
  tarball: null,
  engines: 'chromium,webkit',
  out: path.join(os.tmpdir(), 'scsp-dsp-npm-browser.json'),
};
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const match = /^--(tarball|engines|out)(?:=(.+))?$/.exec(args[index]);
  assert(match, 'Unknown argument ' + args[index]);
  options[match[1]] = match[2] ?? args[++index];
  assert(options[match[1]], 'Missing value for ' + match[1]);
}
assert(options.tarball, 'Pass --tarball with the local npm archive');
options.tarball = path.resolve(options.tarball);
options.out = path.resolve(options.out);
const engines = options.engines.split(',');
assert(engines.length && engines.every(name => ['chromium', 'webkit'].includes(name)));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.md': 'text/plain',
};

function blockAudioAndRuntimeInitialization() {
  const audit = window.__scspDspPackageAudit = {audio: [], fetch: [], wasm: [], xhr: []};
  for (const name of ['AudioContext', 'webkitAudioContext', 'OfflineAudioContext', 'webkitOfflineAudioContext', 'AudioWorkletNode']) {
    if (!(name in window)) continue;
    window[name] = class {
      constructor() {
        audit.audio.push(name);
        throw Error('Pure assembler attempted to create ' + name);
      }
    };
  }
  window.fetch = (...args) => {
    audit.fetch.push(String(args[0]));
    throw Error('Pure assembler attempted fetch');
  };
  for (const name of ['instantiate', 'instantiateStreaming', 'compile', 'compileStreaming', 'Module', 'Instance']) {
    if (!(name in WebAssembly)) continue;
    WebAssembly[name] = function() {
      audit.wasm.push(name);
      throw Error('Pure assembler attempted WebAssembly.' + name);
    };
  }
  XMLHttpRequest.prototype.open = function(_method, url) {
    audit.xhr.push(String(url));
    throw Error('Pure assembler attempted XMLHttpRequest');
  };
}

const importMap = {
  imports: {
    'tetorica-fm2612/scsp_dsp_assembler.js': '/node_modules/tetorica-fm2612/scsp_dsp_assembler.js',
    'tetorica-fm2612/scsp_dsp_assembler': '/node_modules/tetorica-fm2612/scsp_dsp_assembler.js',
  },
};
const harnessHtml = `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Installed SCSP DSP assembler</title>
<script type="importmap">${JSON.stringify(importMap)}</script>
<pre id="output">Loading installed package</pre>
<script type="module">
import * as js from 'tetorica-fm2612/scsp_dsp_assembler.js';
import * as bare from 'tetorica-fm2612/scsp_dsp_assembler';
window.packageApi = js;
window.packageBareApi = bare;
window.packageReady = true;
document.querySelector('#output').textContent = 'Installed assembler ready';
</script></html>`;

async function exercise(browser, name, origin, sourceHash) {
  const context = await browser.newContext();
  const failures = [], missing = [], external = [], requests = [], cases = [];
  await context.addInitScript(blockAudioAndRuntimeInitialization);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      external.push(url.href);
      return route.abort();
    }
    requests.push(url.pathname);
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) missing.push({url: response.url(), status: response.status()});
  });
  try {
    await page.goto(origin + '/consumer.html');
    await page.waitForFunction(() => window.packageReady === true);
    const identity = await page.evaluate(() => ({
      sameAssemble: packageApi.assembleScspDsp === packageBareApi.assembleScspDsp,
      sameDisassemble: packageApi.disassembleScspDsp === packageBareApi.disassembleScspDsp,
      exports: Object.keys(packageApi),
    }));
    assert.deepEqual(identity, {
      sameAssemble: true,
      sameDisassemble: true,
      exports: ['assembleScspDsp', 'disassembleScspDsp'],
    });
    cases.push('both npm subpaths resolve to the same installed pure assembler exports');

    const layout = await page.evaluate(() => {
      const {assembleScspDsp: assemble, disassembleScspDsp: disassemble} = packageApi;
      const words = assemble('; Preserve physical positions, including an explicit zero step\n002:\n003: XSEL=1 YSEL=1 EWT=1 ZERO=1 COEF=1');
      const compact = disassemble(words);
      const full = disassemble(words, {includeTrailingZeros: true});
      const roundTrip = assemble(compact);
      const zeros = assemble('; No assignments');
      return {
        typed: words instanceof Uint16Array,
        length: words.length,
        vector: Array.from(words.slice(12, 16)),
        gapsZero: words.slice(0, 12).every(value => value === 0),
        restZero: words.slice(16).every(value => value === 0),
        compact,
        fullLines: full.trimEnd().split('\n').length,
        fullLast: full.trimEnd().split('\n').at(-1),
        roundTrip: roundTrip.every((value, index) => value === words[index]),
        emptyCompact: disassemble(zeros),
      };
    });
    assert.equal(layout.typed, true);
    assert.equal(layout.length, 512);
    assert.deepEqual(layout.vector, [0, 0xa000, 0x1002, 0x200]);
    assert(layout.gapsZero && layout.restZero && layout.roundTrip);
    assert.match(layout.compact, /^000:\n001:\n002:\n003:/);
    assert.equal(layout.fullLines, 128);
    assert.equal(layout.fullLast, '127:');
    assert.equal(layout.emptyCompact, '');
    cases.push('independent field words, explicit zero positions and compact/full source preserve the 512-word image');

    const ownership = await page.evaluate(() => {
      const {assembleScspDsp: assemble, disassembleScspDsp: disassemble} = packageApi;
      const source = '000: RAW0=0x8000 RAW1=0x1000 RAW3=0x180\n127: NXADR=1';
      const a = assemble(source), b = assemble(source);
      a.fill(0);
      const original = Array.from(b), raw = disassemble(b);
      const rebuilt = assemble(raw);
      disassemble(b, {includeTrailingZeros: true});
      const readonly = Object.freeze(original.slice());
      const readonlySource = disassemble(readonly);
      return {
        independent: b[0] === 0x8000 && b[1] === 0x1000 && b[3] === 0x180 && b[511] === 1,
        unchanged: b.every((value, index) => value === original[index]),
        roundTrip: rebuilt.every((value, index) => value === b[index]),
        raw,
        readonlySource,
      };
    });
    assert(ownership.independent && ownership.unchanged && ownership.roundTrip);
    assert.match(ownership.raw, /RAW0=0x8000 RAW1=0x1000 RAW3=0x0180/);
    assert.equal(ownership.readonlySource, ownership.raw);
    cases.push('owned outputs and readonly inputs retain opaque bits through complete round trips');

    const errors = await page.evaluate(() => {
      const {assembleScspDsp: assemble, disassembleScspDsp: disassemble} = packageApi;
      const attempt = callback => {
        try {callback(); return null;} catch (error) {return {name: error.name, message: error.message};}
      };
      const words = assemble('000: ZERO=1');
      let getterCalls = 0;
      const accessor = Object.defineProperty({}, 'includeTrailingZeros', {get() {getterCalls++; return true;}});
      return {
        invalid: [
          attempt(() => assemble('; context\n003: UNKNOWN=1')),
          attempt(() => assemble('004: ZERO=1\n003: ZERO=1')),
          attempt(() => assemble('000: ZERO=1 ZERO=0')),
          attempt(() => assemble('128: ZERO=1')),
          attempt(() => assemble('000: RAW0=1')),
          attempt(() => disassemble([0])),
          attempt(() => disassemble(words, {includeTrailingZeros: 'yes'})),
          attempt(() => disassemble(words, {unknown: true})),
          attempt(() => disassemble(words, accessor)),
        ],
        getterCalls,
      };
    });
    assert(errors.invalid.every(Boolean));
    assert.match(errors.invalid[0].message, /^Line 2: unknown field UNKNOWN$/);
    assert.match(errors.invalid[1].message, /strictly increasing/);
    assert.equal(errors.getterCalls, 0);
    cases.push('invalid source preserves line diagnostics and invalid options reject without invoking getters');

    const audit = await page.evaluate(() => structuredClone(__scspDspPackageAudit));
    assert.deepEqual(audit, {audio: [], fetch: [], wasm: [], xhr: []});
    assert(!requests.some(url => /\.wasm$|\/generated\/|audio|worklet/i.test(url)));
    cases.push('import and codec calls create no AudioContext, fetch, WebAssembly instance or Worklet');

    await page.goto(origin + '/node_modules/tetorica-fm2612/examples/scsp-dsp/index.html');
    await page.waitForFunction(() => document.querySelector('#output')?.dataset.passed === 'true');
    const example = await page.locator('#output').innerText();
    assert.match(example, /512|128|SCSP|TRA|XSEL/i);
    const exampleAudit = await page.evaluate(() => structuredClone(__scspDspPackageAudit));
    assert.deepEqual(exampleAudit, {audio: [], fetch: [], wasm: [], xhr: []});
    cases.push('the packaged browser example runs against its locally installed npm dependency');
    assert.deepEqual(failures, []);
    assert.deepEqual(missing, []);
    assert.deepEqual(external, []);
    return {browser: name, passed: true, cases, identity, layout, ownership, errors,
      audit, exampleAudit, example, requests, sourceHash, failures, missing, external};
  } catch (error) {
    const audit = await page.evaluate(() => window.__scspDspPackageAudit ?? null).catch(() => null);
    error.browserResult = {browser: name, passed: false, cases, error: error.stack, audit, failures, missing, external, requests};
    throw error;
  } finally {
    await context.close();
  }
}

(async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'scsp-dsp-npm-browser-'));
  const consumer = path.join(scratch, 'consumer');
  const assets = new Map(), results = [];
  let server, failure, tarballRecord;
  try {
    const tarballBytes = await fs.readFile(options.tarball);
    tarballRecord = {filename: path.basename(options.tarball), bytes: tarballBytes.length, sha256: digest(tarballBytes)};
    await fs.mkdir(consumer);
    await fs.writeFile(path.join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
    execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      '--cache', path.join(scratch, 'npm-cache'), options.tarball], {cwd: consumer, stdio: 'pipe'});
    const installed = path.join(consumer, 'node_modules/tetorica-fm2612');
    const moduleBytes = await fs.readFile(path.join(installed, 'scsp_dsp_assembler.js'));
    await fs.readFile(path.join(installed, 'scsp_dsp_assembler.d.ts'));
    for (const name of ['roundtrip.mjs', 'index.html', 'README.md'])
      await fs.readFile(path.join(installed, 'examples/scsp-dsp', name));
    await fs.writeFile(path.join(consumer, 'consumer.html'), harnessHtml);
    server = http.createServer(async (request, response) => {
      try {
        let relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        if (relative === '/favicon.ico') {response.writeHead(204).end(); return;}
        if (relative.endsWith('/')) relative += 'index.html';
        const filename = path.resolve(consumer, '.' + relative);
        assert(filename.startsWith(consumer + path.sep));
        const bytes = await fs.readFile(filename);
        assets.set(path.relative(consumer, filename).split(path.sep).join('/'), {bytes: bytes.length, sha256: digest(bytes)});
        response.writeHead(200, {'Content-Type': mime[path.extname(filename)] ?? 'application/octet-stream',
          'Cache-Control': 'no-store'}).end(bytes);
      } catch {response.writeHead(404).end();}
    });
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const name of engines) {
      const browser = await {chromium, webkit}[name].launch({headless: true});
      try {
        results.push(await exercise(browser, name, origin, digest(moduleBytes)));
        console.log('PASS ' + name + ' installed SCSP DSP assembler');
      } finally {await browser.close();}
    }
    const servedModule = assets.get('node_modules/tetorica-fm2612/scsp_dsp_assembler.js');
    assert.equal(servedModule?.sha256, digest(moduleBytes));
  } catch (error) {
    failure = error;
    if (error.browserResult) results.push(error.browserResult);
    console.error(error);
  } finally {
    server?.closeAllConnections?.();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await fs.mkdir(path.dirname(options.out), {recursive: true});
    await fs.writeFile(options.out, JSON.stringify({passed: !failure, tarball: tarballRecord,
      physicalOutputBlocked: true, audioContextsCreated: 0, listeningPerformed: false,
      isolatedInstalledConsumer: true, results, assets: Object.fromEntries(assets)}, null, 2) + '\n');
    await fs.rm(scratch, {recursive: true, force: true});
    if (failure) process.exitCode = 1;
  }
})();
