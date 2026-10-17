// Exercise the compact Playground menu in Chromium and WebKit, including the
// desktop-only settings with mock native IPC. The real app files are unchanged.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');

const docs = path.resolve(__dirname, '../docs');
const desktop = path.resolve(__dirname, '../w/tetorica-fm2612-playground-tauri/desktop');
const artifacts = process.env.MENU_TEST_ARTIFACT_DIR || os.tmpdir();
const mime = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.wasm':'application/wasm', '.svg':'image/svg+xml'};
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    let file = path.resolve(docs, '.' + pathname);
    if (!file.startsWith(docs + path.sep)) throw Error('Invalid path');
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
    let body = await fs.readFile(file);
    if (pathname.endsWith('/playground.js')) {
      let extra = '\nwindow.__menuRegression={runtime,megaDrive,virtualFiles,refreshExplorerFiles,' +
        'get editor(){return editorAdapter;}};';
      if (url.searchParams.has('menu-desktop-test')) extra += '\n' + await fs.readFile(path.join(desktop, 'audio-interface.js'), 'utf8');
      body = Buffer.from(body.toString() + extra);
    }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(body);
  } catch (error) {
    console.error('SERVE', request.url, error.message);
    response.writeHead(404).end(error.message);
  }
});

async function openMenu(page) {
  if (!await page.locator('#mainMenu').evaluate(element => element.open)) {
    await page.locator('#mainMenu > summary').click();
  }
}

async function menuAction(page, selector) {
  await openMenu(page);
  for (const group of ['#menuImport','#menuExport']) {
    if (await page.locator(`${group} ${selector}`).count() &&
        !await page.locator(group).evaluate(element => element.open)) {
      await page.locator(`${group} > summary`).click();
    }
  }
  await page.locator(selector).click();
}

async function dismiss(page, dialog) {
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'hidden'});
  // The dialog's close event runs after open is removed. Wait for the app's
  // close handler rather than observing the browser's intermediate focus.
  await page.waitForFunction(() => document.activeElement?.tagName !== 'BODY' &&
    Boolean(document.activeElement?.getClientRects().length));
  const focus = await page.evaluate(() => {
    const element = document.activeElement;
    return {tag:element?.tagName, visible:Boolean(element?.getClientRects().length),
      menuSummary:element?.matches('#mainMenu > summary')};
  });
  assert(focus.visible && focus.tag !== 'BODY', 'closing a settings dialog restores a visible focus target: ' + JSON.stringify(focus));
}

async function download(page, action) {
  const pending = page.waitForEvent('download');
  await action();
  const file = await pending;
  assert.equal(await file.failure(), null);
  return {name:file.suggestedFilename(), bytes:new Uint8Array(await fs.readFile(await file.path()))};
}

async function checkLayout(page, isDesktop) {
  const layout = await page.evaluate(() => {
    const rect = selector => {
      const element = document.querySelector(selector);
      if (!element?.getClientRects().length) return null;
      const {x,y,width,height} = element.getBoundingClientRect();
      return {x,y,width,height};
    };
    return {expanded:document.body.classList.contains('mode-expanded'),
      expandButtonVisible:Boolean(rect('#expandButton')), menu:rect('#mainMenu'),
      run:rect('#runButton'), stop:rect('#stopButton'), reset:rect('#resetOfflineCacheButton'),
      pin:rect('#desktop-window-top'), utilities:rect('.toolbar-utilities'), toolbar:rect('.toolbar'),
      pinAndResetGrouped:Boolean(document.querySelector('.toolbar-utilities #desktopPinSlot #desktop-window-top') &&
        document.querySelector('.toolbar-utilities > #resetOfflineCacheButton')),
      viewport:{width:innerWidth,height:innerHeight}, pageWidth:document.documentElement.scrollWidth};
  });
  assert(layout.expanded && !layout.expandButtonVisible, 'the workbench always uses the expanded layout');
  assert(layout.menu && layout.run && layout.stop && layout.reset, 'Menu, Run, Stop and Reset Offline Reload are visible');
  assert(layout.menu.x < layout.run.x && layout.run.x < layout.stop.x, 'Menu precedes Run and Stop');
  assert(layout.reset.x > layout.stop.x, 'Reset Offline Reload is separated at the right end');
  for (const control of ['menu','run','stop','reset',...(isDesktop ? ['pin'] : [])]) {
    const bounds = layout[control];
    assert(bounds.x >= 0 && bounds.x + bounds.width <= layout.viewport.width + 1,
      control + ' must remain reachable inside the viewport: ' + JSON.stringify(layout));
  }
  if (isDesktop) {
    assert(layout.pinAndResetGrouped && layout.pin && layout.utilities,
      'Pin and Reset Offline Reload share the right utility group');
    assert(layout.pin.x > layout.stop.x && layout.pin.x < layout.reset.x,
      'the native Pin toggle is to the right of Run and Stop, before Reset Offline Reload');
    assert(Math.abs(layout.reset.x - (layout.pin.x + layout.pin.width) - 8) < 1,
      'Pin and Reset Offline Reload remain 8 px apart');
    assert(Math.abs((layout.pin.y + layout.pin.height / 2) - (layout.reset.y + layout.reset.height / 2)) < 1,
      'Pin and Reset Offline Reload stay on the same row when their group wraps');
  }
  return layout;
}

async function checkLookahead(page) {
  const input = page.locator('#workerLookaheadMs');
  await openMenu(page);
  assert.equal(await input.isVisible(), false, 'the numeric setting belongs in its dialog');
  assert.match(await page.locator('#workerLookaheadButton').textContent(), /500\s*ms/);
  await page.locator('#workerLookaheadButton').click();
  const dialog = page.locator('#workerLookaheadDialog');
  await dialog.waitFor({state:'visible'});
  assert.equal(await input.inputValue(), '500');
  assert.equal(await input.getAttribute('aria-describedby'), 'workerLookaheadHint');
  assert.match(await dialog.textContent(), /Stop\s*→\s*Run/);
  assert.match(await dialog.textContent(), /Keyboard stays immediate/);
  assert(await input.evaluate(element => element === document.activeElement), 'opening the dialog focuses the latency input');
  await input.fill('90');
  assert.equal(await page.evaluate(() => window.__menuRegression.runtime.getTiming().workerLookaheadSeconds), .5,
    'editing a draft does not change the active setting');
  await dismiss(page, dialog);
  await menuAction(page, '#workerLookaheadButton');
  assert.equal(await input.inputValue(), '500', 'Escape discards the draft');
  await input.fill('90');
  await page.click('#applyWorkerLookaheadButton');
  await dialog.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(() => window.__menuRegression.runtime.getTiming().workerLookaheadSeconds), .09);
  await openMenu(page);
  assert.match(await page.locator('#workerLookaheadButton').textContent(), /90\s*ms/);
  await page.reload();
  await ready(page);
  await menuAction(page, '#workerLookaheadButton');
  assert.equal(await input.inputValue(), '90', 'the chosen lookahead survives reload');
  await input.fill('100');
  await page.click('#cancelWorkerLookaheadButton');
  await menuAction(page, '#workerLookaheadButton');
  assert.equal(await input.inputValue(), '90', 'Cancel discards the draft');
  // The larger default must not overwrite an explicitly chosen zero/old lead.
  for (const milliseconds of [0, 150]) {
    await input.fill(String(milliseconds));
    await page.click('#applyWorkerLookaheadButton');
    await dialog.waitFor({state:'hidden'});
    await page.reload();
    await ready(page);
    await menuAction(page, '#workerLookaheadButton');
    assert.equal(await input.inputValue(), String(milliseconds), 'an explicit ' + milliseconds + ' ms setting survives reload');
    assert.equal(await page.evaluate(() => window.__menuRegression.runtime.getTiming().workerLookaheadSeconds), milliseconds / 1000);
  }
  await input.fill('500');
  await page.click('#applyWorkerLookaheadButton');
  await dialog.waitFor({state:'hidden'});
  return {defaultMilliseconds:500, changedMilliseconds:90, persisted:true, zeroAndLegacy150Preserved:true};
}

async function checkCassetteAndImports(page, unzipSync) {
  await openMenu(page);
  const labels = await page.locator('#mainMenu > .toolbar-menu-panel button').allTextContents();
  for (const name of ['New Cassette','Save Cassette','Load Cassette']) {
    assert(labels.some(text => text.trim().replace(/…$/, '') === name), 'the menu includes ' + name);
  }
  await menuAction(page, '#newCassetteButton');
  const fresh = page.locator('#newCassetteDialog');
  await fresh.waitFor({state:'visible'});
  await page.keyboard.press('Escape');
  await fresh.waitFor({state:'hidden'});

  const marker = '// Menu regression cassette round trip.\nconsole.log("cassette round trip");\n';
  await page.evaluate(marker => {
    const app = window.__menuRegression;
    app.editor.setValue(marker);
    app.virtualFiles.writeText('/menu-roundtrip.txt', 'Saved by the compact menu.');
    app.refreshExplorerFiles();
  }, marker);
  await menuAction(page, '#exportCassetteButton');
  const saveDialog = page.locator('#cassetteExportDialog');
  await saveDialog.waitFor({state:'visible'});
  page.once('dialog', dialog => dialog.accept('menu-regression'));
  const saved = await download(page, () => page.click('#confirmCassetteExportButton'));
  assert.equal(saved.name, 'menu-regression.cassette.zip');
  const entries = unzipSync(saved.bytes);
  assert(Object.keys(entries).some(name => name.endsWith('menu-roundtrip.txt')), 'Save Cassette produces the project archive');
  const index = Object.entries(entries).find(([name]) => /(^|\/)index\.js$/.test(name));
  assert(index && new TextDecoder().decode(index[1]) === marker, 'Save Cassette includes current editor changes');

  await menuAction(page, '#newCassetteButton');
  await fresh.locator('button[value="new"]').click();
  await page.waitForFunction(() => !window.__menuRegression.virtualFiles.has('/menu-roundtrip.txt'));
  const chooseLoad = page.waitForEvent('filechooser');
  await menuAction(page, '#importCassetteButton');
  await (await chooseLoad).setFiles({name:saved.name,mimeType:'application/zip',buffer:Buffer.from(saved.bytes)});
  await page.waitForFunction(() => window.__menuRegression.virtualFiles.has('/menu-roundtrip.txt'));
  assert.equal(await page.evaluate(() => window.__menuRegression.virtualFiles.get('/index.js').data), marker);

  for (const [selector, expected] of [['#importVgmButton', /\.vgm.*\.vgz.*\.s98/], ['#importMidiButton', /\.mid.*\.midi/]]) {
    const chooser = page.waitForEvent('filechooser');
    await menuAction(page, selector);
    const input = await chooser;
    assert.match(await input.element().getAttribute('accept'), expected);
    await input.setFiles([]);
  }
  for (const [selector, extension] of [['#exportTfiButton','tfi'],['#exportVgiButton','vgi']]) {
    const exported = await download(page, () => menuAction(page, selector));
    assert.equal(exported.name, `playground_${extension}_presets.zip`);
    const voices = unzipSync(exported.bytes);
    assert.deepEqual(Object.keys(voices).sort(), Array.from({length:6}, (_,i) => `ch${i+1}.${extension}`));
    assert(Object.values(voices).every(bytes => bytes.length === (extension === 'tfi' ? 42 : 43)), 'voice exports retain the correct binary format');
  }
  return {cassetteRoundTrip:true, musicImportChoosers:true, tfiAndVgiDownloads:true};
}

async function ready(page) {
  try {
    await page.waitForFunction(() => window.__menuRegression?.editor.kind === 'textarea' &&
      !document.getElementById('runButton').disabled);
  } catch (error) {
    const state = await page.evaluate(() => ({editor:window.__menuRegression?.editor.kind,
      startup:document.getElementById('startupMessage')?.textContent,
      status:document.getElementById('status')?.textContent,
      runDisabled:document.getElementById('runButton')?.disabled}));
    throw Error(error.message + '\nStartup state: ' + JSON.stringify(state));
  }
}

async function installDesktopMock(page, origin) {
  const source = await fs.readFile(path.join(desktop, 'desktop-interface.js'), 'utf8');
  await page.addInitScript({content:`
    window.__menuNativeCalls=[];
    let mcpEnabled=false, mcpToken='test-only-token', pinned=false;
    window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
      window.__menuNativeCalls.push({command,args});
      if(command==='window_top_get')return pinned;
      if(command==='window_top_set')return pinned=Boolean(args.enabled);
      if(command==='mcp_set')mcpEnabled=Boolean(args.enabled);
      if(command==='mcp_regenerate_token')mcpToken='replacement-test-token';
      if(command.startsWith('mcp_'))return {enabled:mcpEnabled,token:mcpToken,generation:'test-generation',url:'http://127.0.0.1:39127/mcp'};
      if(command==='audio_request'&&args.op==='devices')return [{id:7,name:'Mock speakers',isDefault:true}];
      return null;
    }};
    ${source.replace('__DESKTOP_DEV_ORIGIN__', JSON.stringify(origin))}
  `});
}

async function checkDesktop(page) {
  await page.locator('#desktop-window-top').click();
  assert.equal(await page.locator('#desktop-window-top').getAttribute('aria-pressed'), 'true');
  await page.locator('#desktop-window-top').click();
  assert.equal(await page.locator('#desktop-window-top').getAttribute('aria-pressed'), 'false');
  await openMenu(page);
  assert.equal(await page.locator('#desktop-mcp-regenerate').isVisible(), false,
    'regenerate belongs inside MCP connection, not the menu');
  assert.match(await page.locator('#desktop-mcp-connection').textContent(), /MCP/);
  assert.match(await page.locator('#desktop-mcp-value').textContent(), /Off/);
  await page.locator('#desktop-mcp-connection').click();
  const mcp = page.locator('#desktop-mcp-dialog');
  await mcp.waitFor({state:'visible'});
  assert(await mcp.locator('#desktop-mcp-regenerate').isVisible());
  assert.equal(await page.locator('#mainMenu').evaluate(element => element.open), false);
  await mcp.locator('#desktop-mcp').click();
  await page.waitForFunction(() => document.getElementById('desktop-mcp').getAttribute('aria-pressed') === 'true');
  assert(await mcp.locator('#desktop-mcp-regenerate').isDisabled(), 'rotation is disabled while MCP runs');
  assert.match(await mcp.getByRole('textbox', {name:'MCP client connection configuration'}).inputValue(), /test-only-token/);
  await mcp.locator('#desktop-mcp').click();
  await page.waitForFunction(() => !document.getElementById('desktop-mcp-regenerate').disabled);
  await mcp.locator('#desktop-mcp-regenerate').click();
  const confirm = page.getByRole('dialog', {name:'Confirm action'});
  await confirm.getByRole('button', {name:'Continue',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="MCP client connection configuration"]').value.includes('replacement-test-token'));
  await dismiss(page, mcp);

  await menuAction(page, '#desktop-audio-output');
  const audio = page.locator('#desktop-audio-dialog');
  await audio.waitFor({state:'visible'});
  assert.equal(await page.locator('#mainMenu').evaluate(element => element.open), false);
  assert.equal(await audio.locator('#desktop-audio-mode').inputValue(), 'webview');
  await audio.locator('#desktop-audio-mode').selectOption('audify');
  await page.waitForFunction(() => document.querySelectorAll('#desktop-audio-device option').length === 2);
  assert.match(await audio.locator('#desktop-audio-device').textContent(), /Mock speakers/);
  await audio.locator('#desktop-audio-mode').selectOption('webview');
  await page.waitForFunction(() => !document.getElementById('desktop-audio-mode').disabled);
  await dismiss(page, audio);
  await openMenu(page);
  assert.match(await page.locator('#desktop-audio-value').textContent(), /WebView/);
  assert.equal(await page.locator('#desktop-audio-mode').isVisible(), false,
    'the menu contains the current output summary, not the settings form');
  return {pin:true,mcpDialogAndTokenRotation:true,audioDialogAndDevices:true};
}

async function check(engine, name, baseUrl, unzipSync) {
  const browser = await engine.launch({headless:true,
    ...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  try {
    for (const isDesktop of [false,true]) {
      const context = await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block',acceptDownloads:true});
      try {
        const page = await context.newPage(), errors = [];
        page.setDefaultTimeout(20000);
        page.on('pageerror', error => {errors.push(error.message);console.error('PAGEERROR',name,isDesktop,error.message);});
        await page.route('https://cdnjs.cloudflare.com/**', route => route.abort());
        if (isDesktop) {
          await installDesktopMock(page, new URL(baseUrl).origin);
          await page.route('**/playground.js?*', async route => {
            const url = new URL(route.request().url());
            url.searchParams.set('menu-desktop-test','1');
            const response = await route.fetch({url:url.href});
            await route.fulfill({response});
          });
        }
        await page.goto(baseUrl);
        await ready(page);
        const layout = await checkLayout(page, isDesktop);
        const lookahead = await checkLookahead(page);
        const flows = isDesktop ? await checkDesktop(page) : await checkCassetteAndImports(page, unzipSync);
        await openMenu(page);
        await page.screenshot({path:path.join(artifacts,`playground-menu-${name}-${isDesktop ? 'desktop' : 'browser'}-wide.png`)});
        await page.setViewportSize({width:640,height:800});
        await checkLayout(page, isDesktop);
        await openMenu(page);
        await page.screenshot({path:path.join(artifacts,`playground-menu-${name}-${isDesktop ? 'desktop' : 'browser'}.png`)});
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({passed:true,browser:name,desktopMock:isDesktop,layout,lookahead,...flows,errors}));
      } finally {await context.close();}
    }
  } finally {await browser.close();}
}

(async () => {
  const {unzipSync} = await import(pathToFileURL(path.join(docs,'playground/vendor/fflate.js')).href);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/playground/index.html?no-sw=1`;
    const engines = process.argv.includes('--webkit') ? [[webkit,'webkit']] :
      process.argv.includes('--chromium') ? [[chromium,'chromium']] : [[chromium,'chromium'],[webkit,'webkit']];
    for (const [engine,name] of engines) await check(engine,name,url,unzipSync);
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error);process.exitCode=1;});
