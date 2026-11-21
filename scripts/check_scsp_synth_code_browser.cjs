// SPDX-License-Identifier: BSD-3-Clause
// Exercise real SCSP WASM behind zero-gain physical output routes.
// node scripts/check_scsp_synth_code_browser.cjs --engines=chromium,webkit
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { tmpdir } = require("node:os");
const { pathToFileURL } = require("node:url");
const { chromium, webkit } = require("playwright");
const repo = path.resolve(__dirname, "..");
const config = {
  root: path.join(repo, "docs"),
  entry: "/synth-scsp/index.html",
  engines: "chromium,webkit",
  out: path.join(tmpdir(), "scsp-synth-code-browser.json"),
  screenshots: path.join(tmpdir(), "scsp-synth-code-browser")
};
for (const argument of process.argv.slice(2)) {
  const match = /^--(root|entry|engines|out|screenshots)=(.+)$/.exec(argument);
  assert(match, "Unknown argument " + argument);
  config[match[1]] = match[2];
}
config.root = path.resolve(config.root);
assert(config.entry.startsWith("/") && !/[?#]/.test(config.entry));
const engines = config.engines.split(",");
assert(engines.length && engines.every((name) => ["chromium", "webkit"].includes(name)));
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function until(predicate, label, timeout = 2e4) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await wait(30);
  }
  throw Error("Timeout: " + label);
}
function installSilentAudit() {
  const Context = window.AudioContext ?? window.webkitAudioContext;
  const Worklet = window.AudioWorkletNode, connect = AudioNode.prototype.connect, post = MessagePort.prototype.postMessage;
  const audit = window.__scspCodeAudit = { contexts: [], nodes: [], meters: [], commands: [], databases: [], sequence: 0 };
  const open = indexedDB.open.bind(indexedDB);
  indexedDB.open = (...args) => {
    const request = open(...args);
    request.addEventListener("success", () => audit.databases.push(request.result));
    return request;
  };
  window.AudioContext = class extends Context {
    constructor(...args) {
      super(...args);
      audit.contexts.push(this);
    }
  };
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {
    constructor(context, name, ...args) {
      super(context, name, ...args);
      audit.nodes.push({ node: this, name });
    }
  };
  AudioNode.prototype.connect = function(destination, ...args) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...args);
    const analyser = this.context.createAnalyser(), mute = this.context.createGain();
    analyser.fftSize = 4096;
    mute.gain.value = 0;
    connect.call(this, analyser, ...args);
    connect.call(analyser, mute);
    connect.call(mute, destination);
    audit.meters.push({ source: this, analyser, mute });
    return destination;
  };
  MessagePort.prototype.postMessage = function(data, ...args) {
    if (data?.method) {
      audit.commands.push({ time: performance.now(), method: data.method, args: data.args });
      if (audit.commands.length > 1e4) audit.commands.shift();
    }
    return post.call(this, data, ...args);
  };
  audit.read = (method = "read", args = []) => new Promise((resolve, reject) => {
    const node = audit.nodes.findLast((item) => item.name === "tetorica-scsp-synth")?.node;
    if (!node) {
      reject(Error("SCSP editor Worklet missing"));
      return;
    }
    const id = --audit.sequence;
    const timeout = setTimeout(() => {
      node.port.removeEventListener("message", receive);
      reject(Error("SCSP audit read timed out"));
    }, 5e3);
    function receive({ data }) {
      if (data?.id !== id) return;
      clearTimeout(timeout);
      node.port.removeEventListener("message", receive);
      data.error ? reject(Error(data.error)) : resolve(data.value);
    }
    node.port.addEventListener("message", receive);
    node.port.start();
    node.port.postMessage(method === "read" ? { id, type: "chip-inspector", action: "read" } : { id, method, args });
  });
  audit.output = () => {
    const values = audit.meters.filter((item) => item.source.context.state === "running").map((item) => {
      const samples = new Float32Array(item.analyser.fftSize);
      item.analyser.getFloatTimeDomainData(samples);
      let peak = 0, square = 0;
      for (const value of samples) {
        peak = Math.max(peak, Math.abs(value));
        square += value * value;
      }
      return { peak, rms: Math.sqrt(square / samples.length), finite: samples.every(Number.isFinite) };
    }).sort((a, b) => b.rms - a.rms);
    return { ...values[0] ?? { peak: 0, rms: 0, finite: true }, muted: audit.meters.every((item) => item.mute.gain.value === 0) };
  };
  audit.graph = () => ({
    contexts: audit.contexts.length,
    editorWorklets: audit.nodes.filter((item) => item.name === "tetorica-scsp-synth").length,
    destinationConnections: audit.meters.length,
    muted: audit.meters.every((item) => item.mute.gain.value === 0)
  });
  audit.drain = () => audit.commands.splice(0);
}
const read = (page) => page.evaluate(() => __scspCodeAudit.read());
async function pcm(page, nonzero = true) {
  let value;
  await until(async () => {
    value = await page.evaluate(() => __scspCodeAudit.output());
    return value.finite && value.muted && (nonzero ? value.rms > 1e-4 : value.peak < 1e-7);
  }, nonzero ? "actual SCSP PCM" : "output silence");
  return value;
}
async function showFiles(page) {
  if (await page.locator("#scspFilesPanel").isHidden()) await page.locator("#scspFilesToggle").click();
  await until(() => page.locator("#scspFileImportButton").isEnabled(), "Files ready");
}
async function selectFile(page, filename) {
  await showFiles(page);
  for (let index = 0; index < 12; index++) {
    const closed = page.locator("#scspFilesTree details:not([open]) > summary");
    if (!await closed.count()) break;
    await closed.first().click();
  }
  await page.locator("#scspFilesTree button[data-file-path]").locator(`xpath=self::*[@data-file-path=${JSON.stringify(filename)}]`).click();
  await until(() => page.locator("#scspFilesSelected").textContent().then((value) => value === filename), "selected " + filename);
  if (/\.m?js$/i.test(filename)) await until(() => page.locator("#synthCodeRunButton").isEnabled(), "JavaScript editor loaded");
}
async function source(page, value) {
  await selectFile(page, "/index.js");
  await page.locator("#synthInputCodeTab").click();
  await page.locator("#synthCodeEditor").waitFor({ state: "visible" });
  await page.locator("#synthCodeEditor").fill(value);
}
async function execute(page, apply = false) {
  await page.locator(apply ? "#synthCodeApplyButton" : "#synthCodeRunButton").click();
  await waitRunning(page, apply ? "Apply" : "Run");
}
async function waitRunning(page, label) {
  await until(async () => {
    const error = await page.locator("#synthCodeError").textContent();
    if (error) throw Error(error);
    return /Running|Playing/.test(await page.locator("#synthCodeState").textContent());
  }, label);
}
async function stop(page) {
  await page.locator("#synthCodeStopButton").click();
  await until(async () => !/Running|Playing|Stopping/.test(await page.locator("#synthCodeState").textContent()), "Code stopped");
  await until(async () => !(await read(page)).codeActive, "physical Code session released");
  await wait(150);
  await pcm(page, false);
}
async function exportProject(page) {
  if (!await page.locator("#synthMenu").evaluate((node) => node.open)) await page.locator("#synthMenuButton").click();
  const pending = page.waitForEvent("download");
  await page.locator("#scspProjectExportButton").click();
  const download = await pending, chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function exportInstrument(page) {
  if (!await page.locator("#synthMenu").evaluate((node) => node.open)) await page.locator("#synthMenuButton").click();
  const pending = page.waitForEvent("download");
  await page.locator("#save").click();
  const download = await pending, chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const HOLD = `const scsp=await useSoundChip('scsp');
const {notes}=await import('./notes.mjs');
await livePrepare('held-note',async()=>{await scsp.noteOn(CH1,notes[0]);return{ready:true};});
context.runs=(context.runs??0)+1;globalThis.__scspProbe={scsp,context};log('apply-count',context.runs);
`;
const MOTION = `const scsp=await useSoundChip('scsp');setBpm(120);
const motion=await livePrepare('motion',()=>({ticks:0}));
context.runs=(context.runs??0)+1;globalThis.__scspMotion={scsp,motion,context};
liveLoop('melody',async()=>{
  motion.ticks++;await scsp.noteOn(CH1,motion.ticks%2?'C4':'E4');
  await beat(.5);await scsp.noteOff(CH1);await beat(.25);
});
`;
const heldGroups = (state) => state.voiceGroups.filter((group) => group.held);
async function stateUntil(page, predicate, label) {
  let state;
  await until(async () => {
    state = await read(page);
    return predicate(state);
  }, label);
  return state;
}
async function importFiles(page, files) {
  await showFiles(page);
  await page.locator("#scspFilesInput").setInputFiles(files);
  await until(() => page.locator("#scspFilesStatus").textContent().then((value) => value.includes(`Added ${files.length} file`)), "Files import");
}
async function setNumber(page, selector, value) {
  await page.locator(selector).evaluate((node) => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) if (parent.tagName === "DETAILS") parent.open = true;
  });
  await page.locator(selector).fill(String(value));
  await page.locator(selector).dispatchEvent("change");
}
async function check(browser, name, origin, loadCassette) {
  const page = await browser.newPage({ viewport: { width: 1240, height: 1050 }, acceptDownloads: true, serviceWorkers: "block" });
  const errors = [], missing = [], checks = [], measurements = {};
  let stage = "startup";
  page.setDefaultTimeout(2e4);
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  page.on("response", (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) missing.push(response.url());
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort();
  });
  await page.addInitScript(installSilentAudit);
  const step = (value) => {
    stage = value;
    checks.push(value);
    console.log(name + ": " + value);
  };
  try {
    await page.goto(origin + config.entry);
    await page.waitForFunction(() => document.querySelector("#synthInputCodeTab") && !document.querySelector("#synthInputCodeTab").disabled && !document.querySelector(".scsp-main").inert);
    assert.equal(await page.locator("#synthInputSection").getAttribute("data-input-mode"), "keyboard");
    assert(await page.locator("#scspFilesPanel").isHidden());
    await fs.mkdir(config.screenshots, { recursive: true });
    await page.screenshot({ path: path.join(config.screenshots, name + "-default.png"), fullPage: true });
    await showFiles(page);
    step("Files, source modules, JSON and named sound copies work before audio starts");
    assert.equal((await page.evaluate(() => __scspCodeAudit.graph())).contexts, 0);
    await page.locator("#scspSaveSoundAs").click();
    await page.locator("#scspFileNameInput").fill("Browser saved");
    await page.locator("#scspFileNameConfirm").click();
    await until(() => page.locator("#scspFilesStatus").textContent().then((value) => value.includes("/presets/Browser saved.scsp.json")), "passive named sound save");
    assert.equal((await page.evaluate(() => __scspCodeAudit.graph())).contexts, 0);
    step("Passive PCM edits survive mode changes and Stop before audio starts");
    await page.locator('[data-chip-action="scsp-square"]').click();
    await page.locator('[data-chip-action="scsp-apply"]').click();
    await until(() => page.locator('[data-chip-action="scsp-apply"]').isDisabled(), "passive PCM applied");
    const passivePatch = await exportInstrument(page);
    const operatorPcm = (patch) => Object.fromEntries(Object.entries(patch.operators).map(([name, operator]) => [name, operator.pcm]));
    assert(passivePatch.operators.carrier.pcm.some((value) => value !== 0), "edited PCM is nonzero");
    for (const mode of ["fm6", "fm2", "pcm"]) {
      await page.locator("#voiceMode").selectOption(mode);
      const changedMode = await exportInstrument(page);
      assert.equal(changedMode.mode, mode);
      assert.deepEqual(operatorPcm(changedMode), operatorPcm(passivePatch), "passive " + mode + " retains every operator's PCM");
    }
    await page.locator("#stop").click();
    assert.deepEqual(operatorPcm(await exportInstrument(page)), operatorPcm(passivePatch), "passive Stop retains PCM");
    assert.equal((await page.evaluate(() => __scspCodeAudit.graph())).contexts, 0, "passive edits and exports keep audio uninitialized");
    await importFiles(page, [
      { name: "notes.mjs", mimeType: "text/javascript", buffer: Buffer.from('export const notes=["A3","C4","E4"];\n') },
      { name: "data.json", mimeType: "application/json", buffer: Buffer.from('{"marker":"scsp-code-files"}\n') },
      { name: "opaque.bin", mimeType: "application/octet-stream", buffer: Buffer.from([0, 255, 17, 128]) }
    ]);
    await selectFile(page, "/data.json");
    assert.equal(await page.locator("#synthInputSection").getAttribute("data-input-mode"), "keyboard");
    await page.locator("#synthInputCodeTab").click();
    await page.locator("#synthCodeEditor").waitFor({ state: "visible" });
    assert.match(await page.locator("#synthCodeEditor").inputValue(), /scsp-code-files/);
    assert(await page.locator("#synthCodeRunButton").isDisabled());
    await selectFile(page, "/index.js");
    assert.match(await page.locator("#synthCodeEditor").inputValue(), /const scsp = await useSoundChip\(['"]scsp['"]\)/);
    assert.match(await page.locator("#synthCodeEditor").inputValue(), /await beat\(0\.5\)/);
    assert.equal((await page.evaluate(() => __scspCodeAudit.graph())).contexts, 0);
    step("Master edits during delayed WASM startup reach the eventual audio output");
    let releaseWasm, wasmHeld = false;
    const wasmGate = new Promise((resolve) => { releaseWasm = resolve; });
    const heldWasm = async (route) => {
      wasmHeld = true;
      await wasmGate;
      await route.continue();
    };
    await page.route("**/generated/scsp_wasm.wasm", heldWasm);
    try {
      await source(page, "const scsp=await useSoundChip('scsp');await scsp.noteOn(CH1,'C4');");
      await page.locator("#synthCodeRunButton").click();
      await until(() => wasmHeld, "WASM startup request held");
      await page.locator("#volume").evaluate((input) => {
        input.value = "0";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      releaseWasm();
      await waitRunning(page, "Run after delayed WASM");
      await stateUntil(page, (state) => state.codeActive && heldGroups(state).some((group) => group.owner.kind === "code"), "held Code note at startup Master zero");
      measurements.startupMasterZero = await pcm(page, false);
      await page.locator("#volume").evaluate((input) => {
        input.value = "0.6";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      measurements.startupMasterRestored = await pcm(page);
      await stop(page);
    } finally {
      releaseWasm();
      await page.unroute("**/generated/scsp_wasm.wasm", heldWasm);
    }
    step("PCM and 2/4/6-op Code notes produce finite real WASM output on one shared SCSP");
    measurements.modes = [];
    for (const mode of ["pcm", "fm2", "fm4", "fm6"]) {
      await source(page, `const scsp=await useSoundChip('scsp');await scsp.setConfig({mode:'${mode}'});await scsp.noteOn(CH1,'C4');`);
      await execute(page);
      const state = await stateUntil(page, (state2) => state2.codeActive && state2.config.mode === mode && heldGroups(state2).some((group2) => group2.owner.kind === "code"), "held " + mode);
      const group = heldGroups(state).find((group2) => group2.owner.kind === "code");
      assert.equal(group.slots.length, mode === "pcm" ? 1 : Number(mode.slice(2)));
      measurements.modes.push({ mode, slots: group.slots, output: await pcm(page) });
      const graph = await page.evaluate(() => __scspCodeAudit.graph());
      measurements.sharedGraph = graph;
      assert.equal(graph.contexts, 1);
      assert.equal(graph.editorWorklets, 1);
      assert.equal(graph.destinationConnections, 1);
      assert(graph.muted);
      await stop(page);
    }
    step("Apply keeps context, local modules and the same borrowed Code session");
    await source(page, HOLD);
    await execute(page);
    await pcm(page);
    const originalSession = (await read(page)).codeSession;
    await execute(page, true);
    await until(() => page.locator("#synthCodeLog").textContent().then((value) => /apply-count 2/.test(value)), "Apply kept context");
    assert.equal((await read(page)).codeSession, originalSession);
    step("Persistent Code/SCSP/DSP/Keyboard tabs preserve Code, Master and reference controls");
    const beforeTabs=await page.evaluate(()=>__scspCodeAudit.graph());
    await page.locator('#synthWorkspaceCodeButton').click();
    for(const id of ['scspChipTab','scspDspTab','synthInputKeyboardTab','synthInputCodeTab']){
      await page.locator('#'+id).click();await page.waitForFunction(id=>document.getElementById(id).getAttribute('aria-selected')==='true',id);
      assert(await page.locator('#synthWorkspace').evaluate(e=>e.classList.contains('is-code-expanded')));assert(await page.locator('#volume').isVisible());assert(await page.locator('#scspSongPlay').isVisible());assert.equal((await read(page)).codeSession,originalSession);await pcm(page);
    }
    assert.deepEqual(await page.evaluate(()=>__scspCodeAudit.graph()),beforeTabs);
    await page.locator('#scspReferencePlayback summary').first().click();assert(await page.locator('#volume').isVisible());await page.locator('#scspReferencePlayback summary').first().click();
    await page.locator('#scspChipTab').click();await page.locator('#synthWorkspaceSynthButton').click();
    step("Manual keyboard, numeric buttons and dragging remain live during Code");
    await page.locator("#synthInputCodeTab").click();
    const manualKey = await page.locator("#keyboard .key[data-key]").first().getAttribute("data-key");
    assert(manualKey, "shared fretboard keyboard key");
    await page.keyboard.down(manualKey);
    await stateUntil(page, (state) => heldGroups(state).some((group) => group.owner.kind === "keyboard"), "manual keyboard owner");
    const before = await read(page), held = heldGroups(before).map((group) => ({ id: group.id, slots: group.slots, owner: group.owner }));
    const pitch = page.locator("#pitch"), oldPitch = Number(await pitch.inputValue());
    await pitch.locator("xpath=..").getByRole("button", { name: "Increase pitch", exact: true }).click();
    await stateUntil(page, (state) => state.config.transpose === oldPitch + 1, "numeric increment");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "", "increment releases input focus");
    await pitch.scrollIntoViewIfNeeded();
    const box = await pitch.boundingBox();
    assert(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    const edited = await stateUntil(page, (state) => state.config.transpose === oldPitch + 3, "horizontal numeric drag");
    assert.deepEqual(heldGroups(edited).map((group) => ({ id: group.id, slots: group.slots, owner: group.owner })), held);
    assert.equal(edited.codeSession, originalSession);
    await pcm(page);
    step("Fractional pitch wheels retune held voices and spring back without changing portable transpose");
    const bentSlot = heldGroups(edited).find((group) => group.owner.kind === "code").slots[0];
    const originalFrequency = edited.channels[bentSlot].frequencyHz;
    await page.locator("#pitchBend").evaluate((input) => {
      input.value = "0.37";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const bent = await stateUntil(page, (state) => state.pitchBend === 0.37, "fractional pitch bend");
    assert.equal(bent.config.transpose, edited.config.transpose);
    assert.equal(bent.channels[0].frequencyHz, edited.channels[0].frequencyHz, "authored source frequency stays unbent");
    assert(Math.abs(bent.channels[bentSlot].frequencyHz / originalFrequency - 2 ** (0.37 / 12)) < 1e-9, "physical held voice follows fractional bend");
    assert.deepEqual(heldGroups(bent).map((group) => group.id), heldGroups(edited).map((group) => group.id));
    assert.equal(Number(await page.locator("#keyboardPitchBend").inputValue()), 0.37, "both pitch wheels stay synchronized");
    await page.locator("#pitchBend").dispatchEvent("change");
    const centered = await stateUntil(page, (state) => state.pitchBend === 0, "pitch wheel spring return");
    assert.equal(centered.config.transpose, edited.config.transpose);
    assert.equal(centered.channels[bentSlot].frequencyHz, originalFrequency);
    assert.equal(Number(await page.locator("#keyboardPitchBend").inputValue()), 0);
    await page.keyboard.up(manualKey);
    await stateUntil(page, (state) => !heldGroups(state).some((group) => group.owner.kind === "keyboard"), "manual release");
    await page.locator("#synthCodeEditor").focus();
    const commandCount = await page.evaluate(() => __scspCodeAudit.commands.filter((item) => item.method === "noteOn").length);
    await page.keyboard.press(manualKey);
    assert.equal(await page.evaluate(() => __scspCodeAudit.commands.filter((item) => item.method === "noteOn").length), commandCount, "typing in Code does not play the keyboard");
    await source(page, HOLD);
    await execute(page, true);
    assert.equal((await read(page)).codeSession, originalSession);
    await page.locator("#synthInputKeyboardTab").click();
    assert.match(await page.locator("#synthCodeState").textContent(), /Running|Playing/);
    await page.keyboard.down(manualKey);
    await stateUntil(page, (state) => heldGroups(state).some((group) => group.owner.kind === "keyboard"), "manual Keyboard view");
    await page.locator("#synthInputCodeTab").click();
    await page.locator("#synthCodeStopButton").click();
    await stateUntil(page, (state) => !state.codeActive && heldGroups(state).some((group) => group.owner.kind === "keyboard"), "Code Stop preserves manual owner");
    await pcm(page);
    await page.keyboard.up(manualKey);
    await pcm(page, false);
    step("Beat timing, direct sound edits and preset selection keep Code running across views");
    await source(page, MOTION);
    await execute(page);
    await until(() => page.evaluate(() => __scspMotion.motion.ticks >= 3), "three timed notes");
    const starts = await page.evaluate(() => __scspCodeAudit.commands.filter((item) => item.method === "code" && item.args[1] === "noteOn").slice(-3).map((item) => item.time));
    const intervals = starts.slice(1).map((value, index) => value - starts[index]);
    assert(intervals.every((value) => value > 200 && value < 750), "120 BPM beat intervals");
    measurements.beatIntervalsMs = intervals;
    const session = (await read(page)).codeSession, ticks = await page.evaluate(() => __scspMotion.motion.ticks);
    await page.locator("#synthInputKeyboardTab").click();
    await setNumber(page, '[data-chip-control="scsp-totalLevel"]', 16);
    await stateUntil(page, (state) => state.channels[0].totalLevel === 16, "direct source mix edit");
    await until(() => page.evaluate((previous) => __scspMotion.motion.ticks > previous, ticks), "melody after direct edit");
    assert.equal((await read(page)).codeSession, session);
    const preset = await page.evaluate(async () => {
      const entry = document.querySelector('script[type="module"][src]').src;
      const { createDefaultScspProjectSound } = await import(new URL("code_project.js", entry));
      return { ...createDefaultScspProjectSound(), mode: "fm4", transpose: 5, name: "Browser preset" };
    });
    await importFiles(page, [{ name: "Browser.scsp.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(preset)) }]);
    step("A held physical keyboard note survives preset selection and releases on keyup while Code continues");
    await page.keyboard.down(manualKey);
    const beforePreset = await stateUntil(page, (state) => heldGroups(state).some((group) => group.owner.kind === "keyboard"), "manual owner before preset selection");
    const manualPresetId = heldGroups(beforePreset).find((group) => group.owner.kind === "keyboard").id;
    const beforePresetTicks = await page.evaluate(() => __scspMotion.motion.ticks);
    await selectFile(page, "/Browser.scsp.json");
    const selectedPreset = await stateUntil(page, (state) => state.config.mode === "fm4" && state.config.transpose === 5, "selected portable patch");
    assert(selectedPreset.voiceGroups.some((group) => group.id === manualPresetId && group.held), "preset selection retains the physical keyboard owner");
    assert.equal(await page.locator("#synthInputSection").getAttribute("data-input-mode"), "keyboard");
    assert.equal(selectedPreset.codeSession, session);
    await page.keyboard.up(manualKey);
    const releasedPreset = await stateUntil(page, (state) => state.voiceGroups.some((group) => group.id === manualPresetId && !group.held), "physical keyup releases the preserved owner");
    assert(releasedPreset.codeActive, "Code remains active after physical keyup");
    assert.equal(releasedPreset.codeSession, session);
    assert(!heldGroups(releasedPreset).some((group) => group.owner.kind === "keyboard"), "no keyboard owner remains held after keyup");
    await until(() => page.evaluate((value) => __scspMotion.motion.ticks > value, beforePresetTicks), "Code after preset selection");
    await page.locator("#synthInputCodeTab").click();
    assert.match(await page.locator("#synthCodeEditor").inputValue(), /tetorica-scsp-voice/);
    await stop(page);
    step("Cassette restores local modules, complete PCM patch and binary Files without executing Code");
    await source(page, HOLD);
    await page.keyboard.press("ControlOrMeta+s");
    await wait(250);
    const archive = await exportProject(page), cassette = await loadCassette(new Uint8Array(archive));
    assert.match(new TextDecoder().decode(cassette.files.get("notes.mjs")), /export const notes/);
    assert.deepEqual([...cassette.files.get("opaque.bin")], [0, 255, 17, 128]);
    const savedPatch = JSON.parse(new TextDecoder().decode(cassette.files.get("scsp-synth.project.json"))).settings;
    assert.equal(savedPatch.mode, "fm4");
    assert.equal(savedPatch.transpose, 5);
    assert.equal(Object.keys(savedPatch.operators).length, 6);
    assert(savedPatch.operators.f.pcm.length > 0);
    await source(page, "// changed");
    await page.locator("#scspProjectFileInput").setInputFiles({ name: "saved.cassette.zip", mimeType: "application/zip", buffer: archive });
    await until(() => page.locator("#scspFilesStatus").textContent().then((value) => /project imported/.test(value)), "Cassette imported");
    await selectFile(page, "/index.js");
    assert.equal(await page.locator("#synthCodeEditor").inputValue(), HOLD);
    assert.equal((await read(page)).codeActive, false);
    await pcm(page, false);
    await page.evaluate(() => __scspCodeAudit.databases.forEach((database) => database.close()));
    await page.locator("#synthCodeEditor").fill(HOLD + "// after reconnect\n");
    await page.keyboard.press("ControlOrMeta+s");
    await wait(250);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector(".scsp-main").inert);
    await page.locator("#synthInputCodeTab").click();
    await page.locator("#synthCodeEditor").waitFor({ state: "visible" });
    assert.match(await page.locator("#synthCodeEditor").inputValue(), /after reconnect/);
    assert.equal((await page.evaluate(() => __scspCodeAudit.graph())).contexts, 0, "saved projects restore silently");
    step("Expanded Code remains visible alongside Files at desktop and narrow widths");
    for (const width of [1240, 390]) {
      await page.setViewportSize({ width, height: 1050 });
      await page.locator("#synthCodeExpandButton").click();
      assert(await page.locator("#synthExpandedCodeSlot #synthCodeEditor").isVisible());
      assert(await page.locator("#scspFilesPanel").isVisible());
      await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1);assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "expanded width " + width);
      await fs.mkdir(config.screenshots, { recursive: true });
      await page.screenshot({ path: path.join(config.screenshots, name + "-" + width + ".png"), fullPage: true });
      await page.locator("#synthCodeExpandButton").click();
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(missing, []);
    return { browser: name, passed: true, checks, measurements, graph: await page.evaluate(() => __scspCodeAudit.graph()), pageErrors: errors, missing };
  } catch (error) {
    const diagnostic = { stage, codeState: await page.locator("#synthCodeState").textContent().catch(() => ""), codeError: await page.locator("#synthCodeError").textContent().catch(() => ""), status: await page.locator("#status").textContent().catch(() => ""), commands: await page.evaluate(() => __scspCodeAudit.drain()).catch(() => []) };
    await fs.mkdir(config.screenshots, { recursive: true });
    await page.screenshot({ path: path.join(config.screenshots, name + "-failure.png"), fullPage: true }).catch(() => {
    });
    error.receipt = { browser: name, passed: false, error: error.stack, checks, measurements, diagnostic, pageErrors: errors, missing };
    throw error;
  } finally {
    await page.close();
  }
}
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".ico": "image/x-icon"
};
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    const filename = path.resolve(config.root, "." + decodeURIComponent(pathname));
    assert(filename.startsWith(config.root + path.sep));
    response.setHeader("Content-Type", mime[path.extname(filename)] ?? "application/octet-stream");
    response.end(await fs.readFile(filename));
  } catch {
    response.writeHead(404).end("not found");
  }
});
(async () => {
  const { loadPlaygroundCassette } = await import(pathToFileURL(path.join(repo, "docs/playground/playground_cassette.js")).href);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = "http://127.0.0.1:" + server.address().port, results = [];
  let failure = null;
  try {
    for (const name of engines) {
      const browser = await { chromium, webkit }[name].launch({ headless: true, ...name === "chromium" ? { args: ["--mute-audio"] } : {} });
      try {
        results.push(await check(browser, name, origin, loadPlaygroundCassette));
      } catch (error) {
        results.push(error.receipt ?? { browser: name, passed: false, error: error.stack });
        throw error;
      } finally {
        await browser.close();
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
  const receipt = { schemaVersion: 1, passed: !failure, root: config.root, entry: config.entry, physicalOutputMuted: true, listeningPerformed: false, results };
  await fs.mkdir(path.dirname(path.resolve(config.out)), { recursive: true });
  await fs.writeFile(config.out, JSON.stringify(receipt, null, 2) + "\n");
  if (failure) throw failure;
  console.log("PASS receipt " + config.out);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
