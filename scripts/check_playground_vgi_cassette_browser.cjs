// Shared Synth/Playground cassette regression with real imports, tone controls
// and downloaded exports. Only exposes the existing VFS/preset state for checks.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const assert = require('node:assert/strict');
const {chromium, webkit} = require('playwright');

const root = path.resolve(__dirname, '..');
const docs = path.join(root, 'docs');
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = path.resolve(docs, '.' + pathname);
    if (!file.startsWith(docs + path.sep)) throw Error('Invalid path');
    let body = await fs.readFile(file);
    if (pathname === '/playground/playground.js') {
      body = Buffer.from(body.toString() + '\nwindow.__vgiCassetteAudit={files:virtualFiles,presets:runtime.presets};');
    }
    response.setHeader('Content-Type', {
      '.js':'text/javascript', '.wasm':'application/wasm', '.html':'text/html',
      '.json':'application/json', '.css':'text/css',
    }[path.extname(file)] || 'application/octet-stream');
    response.end(body);
  } catch (error) { response.statusCode = 404; response.end(String(error)); }
});

async function downloadBytes(download) {
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks);
}

(async () => {
  const {createVgiFromPreset, parseVgi} = await import(pathToFileURL(path.join(docs, 'js/vgi.js')));
  const {loadPlaygroundCassette} = await import(pathToFileURL(path.join(docs, 'playground/playground_cassette.js')));
  const {createSynthProject} = await import(pathToFileURL(path.join(docs, 'synth/synth_project.js')));
  const patch = {
    algorithm: 4, feedback: 2, b4: 0x6e,
    operators: {1:{multi:2,ar:25,tl:11}, 2:{multi:3,ar:26,tl:22}, 3:{multi:4,ar:27,tl:33}, 4:{multi:5,ar:28,tl:44}},
  };
  const tone = createVgiFromPreset(patch);
  const source = "// Shared project source\nawait play('C4', {seconds: .2});\n";
  const gitObject = new Uint8Array([0, 128, 255, 7, 20]);
  const synthProject = createSynthProject();
  synthProject.fs.replace([
    {path:'/presets/game-a/YM2612_CH1.vgi', type:'binary', data:tone},
    {path:'/presets/game-b/YM2612_CH1.vgi', type:'binary', data:tone},
    {path:'/index.js', type:'text', data:source},
    {path:'/lib/helper.js', type:'text', data:'export const shared = true;\n'},
    {path:'/.git/config', type:'binary', data:Buffer.from('[core]\n\tbare = false\n')},
    {path:'/.git/objects/aa/bb', type:'binary', data:gitObject},
    {path:'/samples/kept/clip.wav', type:'binary', data:new Uint8Array([1, 255, 0])},
  ], ['/presets/empty']);
  const archive = synthProject.exportCassette({metadata:{title:'Shared tone set',custom:{kept:true}}});

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/playground/index.html`;
  try {
    for (const [name, type] of [['chromium',chromium], ['webkit',webkit]]) {
      const browser = await type.launch({headless:true});
      try {
        const page = await browser.newPage({acceptDownloads:true, viewport:{width:1280,height:960}});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(url);
        await page.waitForFunction(() => window.__vgiCassetteAudit && document.getElementById('fileExplorerList').getAttribute('aria-busy') !== 'true');
        const openMenu = async () => {
          if (!await page.locator('#mainMenu').evaluate(element => element.open)) await page.locator('#mainMenu > summary').click();
        };
        await openMenu();
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#importCassetteButton').click()]);
        await chooser.setFiles({name:'shared-synth.cassette.zip',mimeType:'application/zip',buffer:Buffer.from(archive)});
        const tonePath = '/presets/game-a/YM2612_CH1.vgi';
        await page.waitForFunction(path => !!window.__vgiCassetteAudit.presets['vfs:' + path], tonePath);
        if (await page.locator('#mainMenu').evaluate(element => element.open)) await page.locator('#mainMenu > summary').click();
        for (const game of ['game-a', 'game-b']) {
          assert.equal(await page.locator(`#operatorTabPresetSelect option[value="vfs:/presets/${game}/YM2612_CH1.vgi"]`).count(), 1);
        }
        const selected = await page.evaluate(path => window.__vgiCassetteAudit.presets['vfs:' + path], tonePath);
        assert.equal(selected.ams, 2);
        assert.equal(selected.pms, 6);
        assert.deepEqual(selected.pan, {left:false,right:true});
        const fileButton = page.locator(`#fileExplorerList [data-file-path="${tonePath}"]`);
        await fileButton.evaluate(element => {
          for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
        });
        await fileButton.click();
        await page.locator('#tfiFileEditor').waitFor({state:'visible'});
        assert.equal(await page.locator('#tfiFileTitle').textContent(), tonePath);
        const editor = page.locator('#tfiFileOperator');
        assert.equal(await editor.locator('.param-value[aria-label="AMS"]').textContent(), '2');
        assert.equal(await editor.locator('.param-value[aria-label="PMS"]').textContent(), '6');
        await editor.locator('.param-value[aria-label="AMS"]').locator('..').getByRole('button',{name:'+',exact:true}).click();
        await editor.locator('.param-value[aria-label="PMS"]').locator('..').getByRole('button',{name:'-',exact:true}).click();
        await editor.locator('#file-operatorTabPanLeft').check();
        await editor.locator('#file-operatorTabPanRight').uncheck();
        await editor.locator('.param-value[aria-label="TL"]').nth(2).locator('..').getByRole('button',{name:'+',exact:true}).click();
        const edited = new Uint8Array(await page.evaluate(path => Array.from(window.__vgiCassetteAudit.files.get(path).data), tonePath));
        assert.equal(edited.length, 43);
        assert.equal(edited[2], 0xbd);
        assert.equal(parseVgi(edited).operators[3].tl, 34);
        assert.deepEqual(new Uint8Array(await page.evaluate(() => Array.from(window.__vgiCassetteAudit.files.get('/presets/game-b/YM2612_CH1.vgi').data))), tone);
        await openMenu();
        page.once('dialog', dialog => dialog.accept('shared-edited'));
        const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportCassetteButton').click()]);
        assert.equal(download.suggestedFilename(), 'shared-edited.cassette.zip');
        const exported = new Uint8Array(await downloadBytes(download));
        const roundtrip = await loadPlaygroundCassette(exported);
        assert.deepEqual(roundtrip.files.get(tonePath.slice(1)), edited);
        assert.deepEqual(roundtrip.files.get('presets/game-b/YM2612_CH1.vgi'), tone);
        assert.equal(new TextDecoder().decode(roundtrip.files.get('index.js')), source);
        assert.equal(new TextDecoder().decode(roundtrip.files.get('lib/helper.js')), 'export const shared = true;\n');
        assert.deepEqual(roundtrip.files.get('.git/objects/aa/bb'), gitObject);
        assert.equal(new TextDecoder().decode(roundtrip.files.get('.git/config')), '[core]\n\tbare = false\n');
        assert.deepEqual(roundtrip.files.get('samples/kept/clip.wav'), new Uint8Array([1,255,0]));
        assert.ok(roundtrip.directories.includes('/presets/empty'));
        assert.deepEqual(roundtrip.metadata.custom, {kept:true});
        const importedSynth = createSynthProject();
        await importedSynth.importCassette(exported, {name:download.suggestedFilename()});
        assert.deepEqual(importedSynth.readTone(tonePath).bytes, edited);
        assert.equal(importedSynth.readTone(tonePath).preset.operators[3].tl, 34);
        assert.equal(importedSynth.readTone(tonePath).preset.b4, 0xbd);
        assert.deepEqual(importedSynth.fs.get('/.git/objects/aa/bb').data, gitObject);
        assert.equal(new TextDecoder().decode(importedSynth.fs.get('/index.js').data), source);
        const finalCassette = await loadPlaygroundCassette(importedSynth.exportCassette());
        assert.deepEqual(finalCassette.files.get('cassette.metadata.js'), roundtrip.files.get('cassette.metadata.js'));
        assert.deepEqual(errors, []);
        console.log(`${name}: VGI discovery/edit/B4 roundtrip, same-name source separation, code/Git/sample/directory retention passed.`);
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
