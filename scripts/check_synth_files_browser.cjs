// Exercise the public Files editor and real Cassette downloads in both browser
// engines used by the standalone/Tauri Synth. No model or import mocks.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
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

function vgm(algorithm) {
  const commands = [0x52, 0xb0, algorithm, 0x52, 0x50, 31, 0x52, 0x28, 0xf0, 0x66];
  const bytes = new Uint8Array(0x100 + commands.length);
  bytes.set([0x56, 0x67, 0x6d, 0x20]);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 4, true);
  view.setUint32(8, 0x171, true);
  view.setUint32(0x34, 0xcc, true);
  view.setUint32(0x2c, 7670454, true);
  bytes.set(commands, 0x100);
  return Buffer.from(bytes);
}

async function downloadBytes(download) {
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function fileEntries(cassette) {
  return [...cassette.files].map(([name, bytes]) => [name, [...bytes]]).sort(([a], [b]) => a.localeCompare(b));
}

async function waitForStoredDraft(page, expected) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    // waitForFunction treats a Promise as truthy without polling its resolved
    // value. Await each actual read explicitly before testing persisted state.
    const ready = await page.evaluate(expected => new Promise(resolve => {
      const request = indexedDB.open('tetorica-fm2612-synth-drafts', 1);
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const database = request.result;
        const read = database.transaction('projects', 'readonly').objectStore('projects').get('current');
        read.onerror = () => {database.close(); resolve(false);};
        read.onsuccess = () => {
          const draft = read.result;
          const ready = draft?.activeTonePath === expected.activePath &&
            draft.filesVisible === expected.visible &&
            draft.project.files.some(file => file.path === expected.activePath) &&
            (expected.count === undefined || draft.project.files.length === expected.count);
          database.close(); resolve(Boolean(ready));
        };
      };
    }), expected);
    if (ready) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`Local draft was not persisted: ${JSON.stringify(expected)}`);
}

(async () => {
  const {createTfiFromPreset, parseTfi} = await import(pathToFileURL(path.join(docs, 'js/tfi.js')));
  const {createVgiFromPreset} = await import(pathToFileURL(path.join(docs, 'js/vgi.js')));
  const {createPlaygroundCassetteZip, loadPlaygroundCassette} = await import(pathToFileURL(path.join(docs, 'playground/playground_cassette.js')));
  const patch = {algorithm:4, feedback:2, operators:{1:{multi:2, ar:23, tl:12}, 2:{ar:17, tl:24}, 3:{ar:20, tl:18}, 4:{ar:31, tl:8}}};
  const tfi = createTfiFromPreset(patch);
  const vgi = createVgiFromPreset({...patch, b4:0xc0});
  const fixtureFiles = [
    {path:'/index.js', type:'text', data:"const lead = readFile('./timbres/lead.tfi');\nawait play('C4');\n"},
    {path:'/lib/song.js', type:'text', data:'export const notes = [60, 64, 67];\n'},
    {path:'/timbres/lead.tfi', type:'binary', data:tfi},
    {path:'/timbres/voice.vgi', type:'binary', data:vgi},
    {path:'/opaque/data.bin', type:'binary', data:new Uint8Array([0, 255, 128, 13, 10, 0])},
    {path:'/.git/objects/ab/cd', type:'binary', data:new Uint8Array([120, 156, 0, 255, 0])},
    {path:'/.git/HEAD', type:'text', data:'ref: refs/heads/main\n'},
  ];
  const fixture = Buffer.from(createPlaygroundCassetteZip(fixtureFiles, {
    directories:['/empty', '/.git/refs/heads', '/assets/empty'],
    metadataFileName:'cassette.metadata.js', license:'CC-BY-4.0', workType:'ORIGINAL',
    metadata:{title:'Shared Synth and Playground', author:'Regression fixture', extra:{unknown:[1,2,3]}},
  }));
  const sourceCassette = await loadPlaygroundCassette(fixture);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/synth/index.html`;
  try {
    for (const [name, type] of [['chromium',chromium], ['webkit',webkit]]) {
      const browser = await type.launch({headless:true});
      try {
        const page = await browser.newPage({acceptDownloads:true, viewport:{width:1440, height:1050}});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => dialog.accept());
        await page.goto(url);
        await page.waitForSelector('#keyboard .key');
        const panel = page.locator('#synthFilesPanel');
        const openFiles = async () => {
          if (!await panel.isVisible()) await page.locator('#synthFilesToggle').click();
          await panel.waitFor({state:'visible'});
        };
        const openMenu = async () => {
          if (!await page.locator('#synthMenu').evaluate(element => element.open)) await page.locator('#synthMenuButton').click();
        };
        const chooseFile = async (button, files) => {
          await openMenu();
          const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator(button).click()]);
          await chooser.setFiles(files);
        };
        const exportCassette = async () => {
          await openMenu();
          const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportCassetteButton').click()]);
          assert.match(download.suggestedFilename(), /\.cassette\.zip$/);
          assert.equal(await download.failure(), null);
          return loadPlaygroundCassette(await downloadBytes(download));
        };
        const expandDirectories = async () => {
          await openFiles();
          for (let index = 0; index < 30; index++) {
            const closed = page.locator('#synthFilesTree details:not([open]) > summary[data-file-path]');
            if (!await closed.count()) break;
            await closed.first().click();
          }
        };
        const toneButton = tonePath => page.locator('#synthFilesTree button.file-entry').locator(`xpath=self::*[@data-file-path=${JSON.stringify(tonePath)}]`);
        const selectTone = async tonePath => {
          await expandDirectories();
          await toneButton(tonePath).click();
          await page.waitForFunction(expected => document.getElementById('synthActiveFilePath').textContent.includes(expected), tonePath);
        };
        const confirmName = async nextName => {
          const dialog = page.locator('#synthFileNameDialog');
          await dialog.waitFor({state:'visible'});
          await page.locator('#synthFileNameInput').fill('');
          await page.keyboard.type(nextName);
          assert.equal(await page.locator('#synthFileNameInput').inputValue(), nextName, 'Typing a name belongs to the dialog, including spaces');
          await dialog.locator('[data-file-name-confirm]').click();
          await dialog.waitFor({state:'hidden'});
        };
        const algorithmControl = page.locator('.param-value[aria-label="ALGO"]');
        const algorithm = async () => Number(await algorithmControl.textContent());
        const editAlgorithm = async () => {
          const before = await algorithm();
          await algorithmControl.locator('..').locator('.param-button').nth(before < 7 ? 1 : 0).click();
          assert.notEqual(await algorithm(), before);
        };
        const assertKeyboardWorks = async () => {
          await page.keyboard.down('a');
          await page.waitForFunction(() => document.querySelector('#keyboard .key[data-key="a"]')?.classList.contains('is-active'));
          await page.keyboard.up('a');
          await page.waitForFunction(() => !document.querySelector('#keyboard .key[data-key="a"]')?.classList.contains('is-active'));
        };

        await page.locator('#keyboard .key').first().click();
        await page.waitForFunction(() => document.getElementById('status').textContent.includes('Audio ready'));
        await openFiles();
        const initialAlgorithm = await algorithm();
        await page.locator('#synthFilesToggle').click();
        await panel.waitFor({state:'hidden'});
        assert.equal(await algorithm(), initialAlgorithm, 'Hiding Files keeps the selected instrument');
        await assertKeyboardWorks();
        await openFiles();

        await chooseFile('#importPresetButton', [
          {name:'song.vgm', mimeType:'application/octet-stream', buffer:vgm(4)},
          {name:'song.vgm', mimeType:'application/octet-stream', buffer:vgm(5)},
        ]);
        await page.waitForFunction(() => document.getElementById('status').textContent.includes('Loaded 2'));
        let cassette = await exportCassette();
        const importedPaths = [...cassette.files.keys()].filter(file => file.endsWith('/ym2612_ch1_001.tfi'));
        assert.deepEqual(importedPaths.sort(), ['presets/song-2/ym2612_ch1_001.tfi', 'presets/song/ym2612_ch1_001.tfi']);
        assert.equal(parseTfi(cassette.files.get('presets/song/ym2612_ch1_001.tfi')).algorithm, 4);
        assert.equal(parseTfi(cassette.files.get('presets/song-2/ym2612_ch1_001.tfi')).algorithm, 5);

        const first = '/presets/song/ym2612_ch1_001.tfi';
        const second = '/presets/song-2/ym2612_ch1_001.tfi';
        await selectTone(first);
        await editAlgorithm();
        await expandDirectories();
        await toneButton(second).click();
        await page.locator('#synthFileDirtyDialog').waitFor({state:'visible'});
        await page.locator('[data-dirty-action="cancel"]').click();
        assert.equal(await algorithm(), 5, 'Cancel retains edits and the original active path');
        assert.match(await page.locator('#synthActiveFilePath').textContent(), /presets\/song\//);
        await toneButton(second).click();
        await page.locator('[data-dirty-action="save"]').click();
        await page.waitForFunction(() => document.getElementById('synthActiveFilePath').textContent.includes('/presets/song-2/'));
        cassette = await exportCassette();
        assert.equal(parseTfi(cassette.files.get(first.slice(1))).algorithm, 5, 'Switch-with-Save persists the edited sound');

        await editAlgorithm();
        await toneButton(first).click();
        await page.locator('[data-dirty-action="discard"]').click();
        await page.waitForFunction(() => document.getElementById('synthActiveFilePath').textContent.includes('/presets/song/'));
        assert.equal(await algorithm(), 5, 'Discard switches to the target instrument');
        cassette = await exportCassette();
        assert.equal(parseTfi(cassette.files.get(second.slice(1))).algorithm, 5, 'Discard does not save the previous edit');

        await editAlgorithm();
        await page.locator('#synthFileSaveButton').click();
        cassette = await exportCassette();
        assert.equal(parseTfi(cassette.files.get(first.slice(1))).algorithm, 6);
        await page.locator('#synthFileDuplicateButton').click();
        if (await page.locator('#synthFileNameDialog').isVisible()) await confirmName('My tone.tfi');
        await page.waitForFunction(() => document.getElementById('synthActiveFilePath').textContent !== '/presets/song/ym2612_ch1_001.tfi');
        await page.locator('#synthFileRenameButton').click();
        await confirmName('Lead.tfi');
        await page.waitForFunction(() => document.getElementById('synthActiveFilePath').textContent.endsWith('/Lead.tfi'));
        cassette = await exportCassette();
        const renamed = [...cassette.files.keys()].find(file => file.endsWith('/Lead.tfi'));
        assert(renamed, 'Rename changes the virtual path');
        assert.equal(parseTfi(cassette.files.get(renamed)).algorithm, 6);
        await page.locator('#synthFileDeleteButton').click();
        cassette = await exportCassette();
        assert(!cassette.files.has(renamed), 'Delete removes the selected file');
        await page.locator('#synthFileUndoButton').click();
        cassette = await exportCassette();
        assert.equal(parseTfi(cassette.files.get(renamed)).algorithm, 6, 'Undo restores the deleted tone');
        await page.locator('#synthFileNewFolderButton').click();
        await confirmName('My sounds');
        cassette = await exportCassette();
        assert(cassette.directories.some(directory => directory.endsWith('/My sounds')), 'New Folder persists an empty folder');
        await page.locator('#synthFileNewButton').click();
        await confirmName('Created.tfi');
        cassette = await exportCassette();
        assert([...cassette.files.keys()].some(file => file.endsWith('/Created.tfi')), 'New File creates an editable instrument');
        await assertKeyboardWorks();
        const savedPath = await page.locator('#synthActiveFilePath').textContent();
        const savedAlgorithm = await algorithm();
        await page.locator('#synthFilesToggle').click();
        await panel.waitFor({state:'hidden'});
        await waitForStoredDraft(page, {activePath:savedPath, visible:false});
        await page.reload();
        await page.waitForSelector('#keyboard .key');
        await page.waitForFunction(expected => document.getElementById('synthActiveFilePath').textContent === expected, savedPath);
        await page.waitForFunction(() => !document.getElementById('synthFileNewButton').disabled);
        assert.equal(await panel.isVisible(), false, 'The local draft remembers the hidden Files panel');
        assert.equal(await algorithm(), savedAlgorithm, 'Reload restores the saved editable instrument');
        await page.locator('#keyboard .key').first().click();
        await page.waitForFunction(() => document.getElementById('status').textContent.includes('Audio ready'));
        await openFiles();
        await page.screenshot({path:`/private/tmp/synth-files-${name}-desktop.png`});

        // A slow local draft read must not let a Files visibility click save the
        // still-empty project over the stored Cassette. Delay only delivery of
        // the first real IDB get, keeping persisted data and writes unmocked.
        const savedEntries = fileEntries(cassette);
        // Export generates metadata.json when the workspace does not contain a
        // metadata file; that generated entry is not a local virtual file.
        const savedFileCount = savedEntries.filter(([name]) => name !== 'metadata.json').length;
        await page.locator('#synthFilesToggle').click();
        await panel.waitFor({state:'hidden'});
        await waitForStoredDraft(page, {activePath:savedPath, visible:false, count:savedFileCount});
        await page.addInitScript(() => {
          const get = IDBObjectStore.prototype.get;
          let delayed = false;
          IDBObjectStore.prototype.get = function(key) {
            const request = get.call(this, key);
            if (delayed || this.name !== 'projects' || key !== 'current') return request;
            delayed = true;
            window.__synthDraftReadPending = true;
            const delivery = {
              onsuccess:null, onerror:null,
              get result() {return request.result;},
              get error() {return request.error;},
            };
            request.onsuccess = event => setTimeout(() => {
              window.__synthDraftReadPending = false;
              delivery.onsuccess?.(event);
            }, 1200);
            request.onerror = event => delivery.onerror?.(event);
            return delivery;
          };
        });
        await page.reload();
        await page.waitForFunction(() => window.__synthDraftReadPending === true);
        await page.locator('#synthFilesToggle').click();
        await panel.waitFor({state:'visible'});
        assert.equal(await page.locator('#synthFileNewButton').isDisabled(), true, 'File edits wait for the stored project');
        await page.waitForFunction(expected => document.getElementById('synthActiveFilePath').textContent === expected, savedPath);
        assert.equal(await panel.isVisible(), true, 'The visibility click during loading takes priority over the stored setting');
        assert.equal(await algorithm(), savedAlgorithm, 'A delayed read restores the active tone');
        cassette = await exportCassette();
        assert.deepEqual(fileEntries(cassette), savedEntries, 'A visibility click during draft loading preserves all saved files');
        await waitForStoredDraft(page, {activePath:savedPath, visible:true, count:savedFileCount});
        await page.locator('#keyboard .key').first().click();
        await page.waitForFunction(() => document.getElementById('status').textContent.includes('Audio ready'));

        await chooseFile('#importCassetteButton', [{name:'shared.cassette.zip', mimeType:'application/zip', buffer:fixture}]);
        await page.waitForFunction(() => document.getElementById('status').textContent.includes('shared'));
        cassette = await exportCassette();
        assert.deepEqual(fileEntries(cassette), fileEntries(sourceCassette), 'Cassette preserves code, opaque bytes, .git and raw metadata');
        for (const directory of sourceCassette.directories) assert(cassette.directories.includes(directory), `Preserves ${directory}`);
        await selectTone('/timbres/voice.vgi');
        assert.equal(await algorithm(), 4, 'VGI from Playground Cassette loads in Synth');
        assert.equal(await page.locator('#synthFileSaveButton').isDisabled(), true, 'An unedited saved tone needs no rewrite');
        await editAlgorithm();
        await algorithmControl.locator('..').locator('.param-button').first().click();
        await page.locator('#synthFileSaveButton').click();
        cassette = await exportCassette();
        assert.deepEqual([...cassette.files.get('timbres/voice.vgi')], [...vgi], 'Saving an unedited VGI retains its format and parameters');
        await expandDirectories();
        await toneButton('/index.js').click();
        assert.equal(await algorithm(), 4, 'Selecting shared code keeps the active Synth instrument');
        assert.match(await page.locator('#synthActiveFilePath').textContent(), /timbres\/voice\.vgi$/);
        const preservedBeforeFailure = fileEntries(cassette);
        await chooseFile('#importCassetteButton', [{name:'broken.cassette.zip', mimeType:'application/zip', buffer:Buffer.from([0,1,2,3])}]);
        await page.waitForFunction(() => /error|invalid|failed|could not/i.test(document.getElementById('status').textContent));
        cassette = await exportCassette();
        assert.deepEqual(fileEntries(cassette), preservedBeforeFailure, 'Malformed Cassette does not replace the project');
        await chooseFile('#importPresetButton', [{name:'bad.tfi', mimeType:'application/octet-stream', buffer:Buffer.alloc(2)}]);
        await page.locator('#presetImportError').waitFor({state:'visible'});
        cassette = await exportCassette();
        assert.deepEqual(fileEntries(cassette), preservedBeforeFailure, 'Malformed sound does not change the project');
        await page.setViewportSize({width:390, height:844});
        await openFiles();
        const bounds = await panel.boundingBox();
        assert(bounds.x >= 0 && bounds.x + bounds.width <= 390, 'Files fits a narrow viewport');
        await page.screenshot({path:`/private/tmp/synth-files-${name}-390.png`});
        await page.locator('#synthFilesToggle').click();
        await panel.waitFor({state:'hidden'});
        await assertKeyboardWorks();
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({browser:name, passed:true, uniqueVgmDirectories:2, cassetteFiles:cassette.files.size, preservedEmptyDirectories:3}));
        await page.close();
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => {console.error(error); server.close(); process.exitCode = 1;});
