// Browser menu regression: exercise the real file dialogs, downloads and
// Web Audio instrument rather than replacing the import/export handlers.
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
    const file = path.resolve(docs, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!file.startsWith(docs + '/')) throw Error('Invalid path');
    response.setHeader('Content-Type', {'.js':'text/javascript', '.wasm':'application/wasm', '.html':'text/html', '.json':'application/json'}[path.extname(file)] || 'application/octet-stream');
    response.end(await fs.readFile(file));
  } catch (error) { response.statusCode = 404; response.end(String(error)); }
});

async function downloadBytes(download) {
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks);
}

(async () => {
  const {createTfiFromPreset} = await import(pathToFileURL(path.join(docs, 'js/tfi.js')));
  const {createVgiFromPreset} = await import(pathToFileURL(path.join(docs, 'js/vgi.js')));
  const patch = {algorithm:4, feedback:2, operators:{1:{multi:2, ar:23, tl:12}, 2:{ar:17, tl:24}, 3:{ar:20, tl:18}, 4:{ar:31, tl:8}}};
  const tfi = Buffer.from(createTfiFromPreset(patch));
  const vgi = Buffer.from(createVgiFromPreset({...patch, b4:0xc0}));
  const recording = {
    format:'megasynth-recording-v1', version:1, startedAt:0, durationSeconds:.25,
    initialState:null,
    commands:[{time:0, type:'noteOn', channel:0, block:4, fnum:600}, {time:.2, type:'noteOff', channel:0}],
  };
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/synth/index.html`;
  try {
    for (const [name, type] of [['chromium',chromium], ['webkit',webkit]]) {
      const browser = await type.launch({headless:true});
      try {
        const page = await browser.newPage({acceptDownloads:true});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(url);
        await page.waitForSelector('#keyboard .key');
        const menu = page.locator('#synthMenu');
        const openMenu = async () => {
          if (!await menu.evaluate(element => element.open)) await page.locator('#synthMenuButton').click();
          assert.equal(await menu.evaluate(element => element.open), true);
        };
        const chooseFile = async (button, files) => {
          await openMenu();
          const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator(button).click()]);
          assert.equal(await menu.evaluate(element => element.open), false, 'Import closes the menu before the file dialog');
          await chooser.setFiles(files);
        };
        const exportFile = async button => {
          await openMenu();
          const [download] = await Promise.all([page.waitForEvent('download'), page.locator(button).click()]);
          assert.equal(await menu.evaluate(element => element.open), false, 'Export closes the menu');
          assert.equal(await download.failure(), null);
          return {name:download.suggestedFilename(), bytes:await downloadBytes(download)};
        };
        assert.equal(await page.locator('#synthPinButton').isVisible(), false, 'Browser has no native pin control');
        assert.equal(await page.locator('#synthMenuButton').getAttribute('aria-label'), 'Menu');
        assert.equal(await menu.evaluate(element => element.open), false);
        await page.locator('#keyboard .key').first().click();
        await page.waitForFunction(() => document.getElementById('status').textContent.includes('Audio ready'));
        await openMenu();
        assert.equal(await page.locator('#synthBrowserAudioHint').isVisible(), true);
        assert.equal(await page.locator('#tfiFile').isVisible(), false, 'Menu file pickers are buttons, with hidden native inputs');
        assert.equal(await page.locator('#eventRecordImportInput').isVisible(), false);
        assert.equal(await page.locator('[data-reset-offline-cache]').evaluate(element => !!element.closest('#synthMenu')), true);
        assert.equal(await page.locator('#eventRecordExportButton').isDisabled(), true);
        assert.equal(await page.evaluate(() => document.activeElement?.id), '', 'Mouse menu actions do not steal instrument focus');
        await page.screenshot({path:`/private/tmp/synth-menu-${name}-desktop.png`});
        await page.keyboard.down('a');
        await page.waitForFunction(() => document.querySelector('#keyboard .key[data-key="a"]')?.classList.contains('is-active'));
        await page.keyboard.up('a');
        await page.waitForFunction(() => !document.querySelector('#keyboard .key[data-key="a"]')?.classList.contains('is-active'));
        await page.keyboard.press('Escape');
        assert.equal(await menu.evaluate(element => element.open), false);
        await openMenu();
        await page.locator('#pageTitle').click();
        assert.equal(await menu.evaluate(element => element.open), false, 'Outside click closes the menu');

        await chooseFile('#importPresetButton', [
          {name:'a-tone.tfi', mimeType:'application/octet-stream', buffer:tfi},
          {name:'b-tone.vgi', mimeType:'application/octet-stream', buffer:vgi},
        ]);
        await page.waitForFunction(() => document.getElementById('tfiSummary').textContent.includes('2 imported presets'));
        assert.equal(await page.locator('#presetSelect optgroup').count(), 2);
        assert.equal(await page.locator('#tfiFile').inputValue(), '');
        const tfiDownload = await exportFile('#exportTfiButton');
        assert.match(tfiDownload.name, /\.tfi$/);
        assert.equal(tfiDownload.bytes.length, 42);
        assert.deepEqual(tfiDownload.bytes, tfi, 'Moving Export TFI preserves instrument parameters');
        const vgiDownload = await exportFile('#exportVgiButton');
        assert.match(vgiDownload.name, /\.vgi$/);
        assert.deepEqual(vgiDownload.bytes, vgi, 'Moving Export VGI preserves instrument parameters');
        await chooseFile('#importPresetButton', [{name:'bad.tfi', mimeType:'application/octet-stream', buffer:Buffer.alloc(2)}]);
        await page.waitForFunction(() => !document.getElementById('presetImportError').hidden);
        assert.match(await page.locator('#presetImportError').textContent(), /bad\.tfi/);
        assert.equal(await page.locator('#presetSelect optgroup').count(), 2, 'A failed import retains prior sound choices');

        await chooseFile('#importEventRecordingButton', [{name:'take.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(recording))}]);
        await page.waitForFunction(() => document.getElementById('status').textContent.includes('Imported event recording: take.json'));
        const recordingDownload = await exportFile('#eventRecordExportButton');
        assert.equal(recordingDownload.name, 'megasynth-recording.json');
        assert.deepEqual(JSON.parse(recordingDownload.bytes), recording);
        assert.equal(await page.locator('#eventRecordImportInput').inputValue(), '');
        // Returning from import/export still allows direct keyboard playing.
        await page.keyboard.down('a');
        await page.waitForFunction(() => document.querySelector('#keyboard .key[data-key="a"]')?.classList.contains('is-active'));
        await page.keyboard.up('a');
        await page.waitForFunction(() => !document.querySelector('#keyboard .key[data-key="a"]')?.classList.contains('is-active'));
        await page.setViewportSize({width:390, height:844});
        await page.locator('#synthMenuButton').scrollIntoViewIfNeeded();
        await openMenu();
        const panel = await page.locator('.synth-menu-panel').boundingBox();
        assert(panel.x >= 0 && panel.x + panel.width <= 390, `Menu fits narrow viewport: ${JSON.stringify(panel)}`);
        assert(panel.y >= 0 && panel.y + panel.height <= 844, 'Menu remains visible vertically');
        await page.screenshot({path:`/private/tmp/synth-menu-${name}-390.png`});
        await page.keyboard.press('Escape');
        assert.equal(await menu.evaluate(element => element.open), false);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({browser:name, passed:true, importedPresets:2, tfiBytes:tfiDownload.bytes.length, eventCommands:recording.commands.length, menuWidth:panel.width}));
        await page.close();
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => {console.error(error); server.close(); process.exitCode = 1;});
