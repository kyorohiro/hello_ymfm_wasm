// SPDX-License-Identifier: BSD-3-Clause
// Nitro DS Synth and 2SF verification. The physical destination stays muted.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { chromium, webkit } = require('playwright');

const root = path.resolve(__dirname, '../..');
const { values: options } = parseArgs({ options: {
	engines: { type: 'string', default: 'chromium,webkit' },
	'real-folder': { type: 'string' },
	'web-root': { type: 'string', default: path.join(root, 'docs') },
	entry: { type: 'string', default: '/synth-nitro-ds/index.html' },
} });
const webRoot = path.resolve(options['web-root']);
assert(/^\/(?!\/)/.test(options.entry) && !options.entry.includes('\\'), 'Use an entry URL path such as /index.html');
const engines = { chromium, webkit };
const browsers = options.engines.split(',');
assert(browsers.every((name) => Object.hasOwn(engines, name)), 'Select chromium and/or webkit');
const realFolder = options['real-folder'] ? path.resolve(options['real-folder']) : null;
const contentTypes = {
	'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
	'.mjs': 'text/javascript', '.wasm': 'application/wasm', '.webp': 'image/webp',
};

function silentAudit() {
	const Context = window.AudioContext ?? window.webkitAudioContext;
	const connect = AudioNode.prototype.connect;
	const contexts = [], monitored = [];
	const AuditContext = class extends Context {
		constructor(...args) {
			super(...args);
			contexts.push(this);
		}
	};
	window.AudioContext = AuditContext;
	if (window.webkitAudioContext) window.webkitAudioContext = AuditContext;
	AudioNode.prototype.connect = function (destination, ...args) {
		if (destination !== this.context.destination) return connect.call(this, destination, ...args);
		const splitter = this.context.createChannelSplitter(2);
		const mute = this.context.createGain();
		mute.gain.value = 0;
		const meters = [this.context.createAnalyser(), this.context.createAnalyser()];
		connect.call(this, splitter, args[0] ?? 0);
		for (const [index, meter] of meters.entries()) {
			meter.fftSize = 2048;
			connect.call(splitter, meter, index);
			connect.call(meter, mute);
		}
		connect.call(mute, destination);
		monitored.push({ mute, meters });
		return destination;
	};
	function measure(meter) {
		const wave = new Float32Array(meter.fftSize);
		meter.getFloatTimeDomainData(wave);
		let squared = 0, peak = 0, sum = 0;
		for (const value of wave) {
			squared += value * value;
			peak = Math.max(peak, Math.abs(value));
			sum += value;
		}
		const crossings = [];
		const mean = sum / wave.length;
		for (let index = 1; index < wave.length; index++) {
			const prev = wave[index - 1], next = wave[index];
			if (prev <= mean && next > mean) crossings.push(index - 1 + (mean - prev) / (next - prev));
		}
		const pitch = crossings.length > 1
			? meter.context.sampleRate * (crossings.length - 1) / (crossings.at(-1) - crossings[0])
			: 0;
		return { rms: Math.sqrt(squared / wave.length), peak, pitch };
	}
	window.twoSfAudit = (index = -1) => ({
		contexts: contexts.length,
		currentTime: contexts.at(index)?.currentTime ?? 0,
		contextState: contexts.at(index)?.state ?? 'idle',
		outputs: monitored.length,
		muted: monitored.every(({ mute }) => mute.gain.value === 0),
		channels: monitored.at(index)?.meters.map(measure) ?? [],
	});
}

const output = (page, index = -1) => page.evaluate(index => window.twoSfAudit(index), index);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(read, predicate, label, timeoutMs = 15000) {
	const deadline = Date.now() + timeoutMs;
	let actual;
	while (Date.now() < deadline) {
		actual = await read();
		if (predicate(actual)) return actual;
		await wait(25);
	}
	throw Error(`${label} (last observed ${JSON.stringify(actual)})`);
}

async function importFiles(page, button, files) {
	const trigger = page.locator(button);
	if (!(await trigger.isVisible())) await page.locator('#menu:is(summary), #menu > summary').click();
	const picked = page.waitForEvent('filechooser');
	await trigger.click();
	await (await picked).setFiles(files);
}

const tracks = (page) => page.locator('#songSelect').evaluate((select) =>
	[...select.options].filter((option) => option.value && !option.disabled).map((option) => ({
		value: option.value, label: option.text,
	})),
);
const readPosition = (page) => page.locator('#position').evaluate((element) =>
	(element instanceof HTMLProgressElement || element instanceof HTMLInputElement ? element.value : element.textContent),
);

async function measureSide(page, side, pitch, index = -1) {
	const { channels } = await until(() => output(page, index), (state) => {
		const signal = state.channels[side], other = state.channels[1 - side];
		return state.muted && signal && other && signal.rms > 0.005 && other.rms < signal.rms * 0.04 &&
			Math.abs(signal.pitch - pitch) < 4;
	}, `Expected ${pitch} Hz on the ${side === 0 ? 'left' : 'right'} channel`);
	return channels;
}

function readReferenceChannel(page) {
	return page.evaluate(() => {
		const text = name => document.getElementById('twoSfLive' + name).textContent.trim();
		return {
			status: text('Status'),
			visible: !document.getElementById('twoSfLiveDetails').hidden,
			active: text('Active'),
			format: text('Format'),
			volume: Number(text('Volume')),
			pan: Number(text('Pan')),
			rate: Number(text('Rate').replace(/[,\s]|Hz/g, '')),
		};
	});
}

function fixtureChannel(state, hz, pan) {
	const sampleRate = 16756991 / Math.round(16756991 / (hz * 32));
	return state.visible && state.active === 'Active' && state.format === 'PCM16' &&
		state.volume === 100 && state.pan === pan && Math.abs(state.rate - sampleRate) < 2;
}

async function holdC4(page, action) {
	await page.keyboard.down('6');
	try {
		return await action();
	} finally { await page.keyboard.up('6'); }
}

async function checkPausedAudition(page, frozenPosition, frozenClock) {
	const audition = page.locator('#twoSfAuditionEnabled');
	const reference = page.locator('#twoSfAuditionReference');
	const status = () => page.locator('#twoSfAuditionStatus').textContent();
	const ready = () => until(status, text => /Keyboard ready/i.test(text), 'The paused channel should be ready for keyboard audition');
	const live = page.locator('#twoSfLiveEnabled'), channel = page.locator('#twoSfLiveChannel');
	const silent = ({ channels }) => channels.length === 2 && channels.every(({ peak }) => peak < 1e-7);
	const verifySongFrozen = async () => {
		const state = await output(page, 0);
		assert.equal(state.contextState, 'suspended', 'The reference audio should remain paused during audition');
		assert.equal(state.currentTime, frozenClock, 'Keyboard audition must not advance the reference clock');
		assert.equal(await readPosition(page), frozenPosition);
	};

	// Distinguish the authored sound from the reference with both pitch and pan.
	await page.locator('#ndsPan').evaluate(input => {
		input.value = '127';
		input.dispatchEvent(new Event('input', { bubbles: true }));
	});
	assert(!(await audition.isChecked()), 'Audition should be opt-in on Pause');
	assert.equal(await reference.inputValue(), '60', 'Audition starts with C4 as the root note');
	await audition.check();
	await ready();
	await holdC4(page, () => measureSide(page, 0, 440, 1));
	await until(() => output(page, 1), silent, 'Releasing the key should silence the frozen sample');
	await verifySongFrozen();

	await reference.selectOption('72');
	await ready();
	await holdC4(page, () => measureSide(page, 0, 220, 1));
	await until(() => output(page, 1), silent, 'The transposed note should release');
	await channel.selectOption('15');
	await until(status, text => /idle/i.test(text), 'An idle reference channel should have no playable sample');
	await holdC4(page, async () => {
		await wait(120);
		assert(silent(await output(page, 1)), 'An idle reference channel must not replay the previous sample');
		assert.equal((await output(page)).outputs, 2, 'Audition must not fall back to the authored Synth while enabled');
	});
	await verifySongFrozen();

	await live.uncheck();
	await page.locator('#twoSfAuditionTools').waitFor({ state: 'hidden' });
	assert(!(await audition.isChecked()), 'Disabling Live should clear audition');
	await holdC4(page, () => measureSide(page, 1, 261.626));
	assert.equal(await page.locator('#ndsPan').inputValue(), '127', 'Audition must preserve authored Synth settings');
	await verifySongFrozen();

	// Arm audition again to verify that Resume clears it and restores normal
	// keyboard routing even if audition was selected immediately before Resume.
	await live.check();
	await channel.selectOption('0');
	await audition.check();
	await ready();
}

async function checkReferenceCapture(page) {
	const pausedPosition = await readPosition(page);
	const audition = page.locator('#twoSfAuditionEnabled'), capture = page.locator('#twoSfCapture');
	await page.locator('#twoSfAuditionReference').selectOption('72');
	await audition.check();
	await capture.click();
	await page.locator('#ndsSampleEditor').waitFor();
	assert.equal(await audition.isChecked(), false, 'Capture should return the keyboard to the editable Synth sound');
	assert.equal(await page.locator('#twoSfLiveChannel').inputValue(), '0', 'Capture should retain the selected reference channel');
	assert.match((await readReferenceChannel(page)).status, /Paused/);
	assert.equal(await readPosition(page), pausedPosition, 'Capture should retain the paused song position');
	assert.equal(await page.locator('#ndsMode').inputValue(), 'pcm16');
	assert.equal(await page.locator('#ndsPan').inputValue(), '0');
	assert.equal(await page.locator('#ndsSampleRoot').inputValue(), '72');
	assert.equal(await page.locator('#ndsSampleEnd').inputValue(), '32');
	assert.equal(await page.locator('#ndsLoop').isChecked(), true);
	await holdC4(page, () => measureSide(page, 0, 220));

	await page.locator('#ndsSaveSound').click();
	assert.equal(await page.locator('#ndsSoundName').inputValue(), '2SF CH 1');
	await page.locator('#ndsSaveSoundCommit').click();
	await page.locator('#ndsSaveSoundDialog').waitFor({ state: 'hidden' });
	const presetPath = '/presets/2SF CH 1.nds.json';
	await page.locator(`#ndsSavedSounds option[value="${presetPath}"]`).waitFor({ state: 'attached' });

	const panel = page.locator('#ndsFilesPanel');
	if (!(await panel.isVisible())) await page.locator('#ndsFilesToggle').click();
	await page.locator('#ndsNewJs').click();
	await page.locator('#ndsFileName').fill('/capture-check.js');
	await page.locator('#ndsFileNameConfirm').click();
	await page.locator('#ndsFileNameDialog').waitFor({ state: 'hidden' });
	await page.locator('#synthInputCodeTab').click();
	const editor = page.locator('#synthCodeEditor');
	await until(() => editor.inputValue(), value => value.includes('Write your DS performance'), 'Captured-preset test script should be editable');
	const original = Buffer.alloc(64);
	for (let i = 0; i < 32; i++) original.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * i / 32)), i * 2);
	await editor.fill(`const nds = await useSoundChip("nds");
const preset = await file(${JSON.stringify(presetPath)}, { type: "json" });
const sample = preset.sample;
if (preset.mode !== "pcm16" || preset.pan !== 0 || !preset.loop || sample.loopStartWords !== 0 ||
    sample.lengthWords !== 16 || sample.rootNote !== 72 || Math.abs(sample.sampleRate - 16756991 / 1190) > 1e-8 ||
    sample.bytes !== ${JSON.stringify(original.toString('base64'))}) {
  throw new Error("Saved reference preset did not retain the source bytes and settings: " + JSON.stringify(preset));
}
await nds.loadPreset(CH2, preset);
await nds.noteOn(CH2, "C4");`);
	await page.locator('#synthCodeRunButton').click();
	try {
		const code = await until(() => page.evaluate(() => ({
			state: document.getElementById('synthCodeState').textContent,
			error: document.getElementById('synthCodeError').textContent,
		})), value => /Running|Error/.test(value.state), 'Code should finish loading the saved 2SF sample');
		assert.equal(code.state, 'Running', code.error);
		await measureSide(page, 0, 220);
	} finally { await page.locator('#synthCodeStopButton').click(); }
	assert.equal(await readPosition(page), pausedPosition, 'Saving and running Code should leave the 2SF transport paused');
	await panel.locator('button[data-file-path="/index.js"]').click();
	await page.locator('#synthInputKeyboardTab').click();
}

async function checkPresentimentAudition(page) {
	const channel = page.locator('#twoSfLiveChannel'), pause = page.locator('#pause');
	const available = state => state.visible && state.active === 'Active' && state.format === 'IMA-ADPCM';
	await channel.selectOption('4');
	let paused;
	for (let attempt = 0; attempt < 4; attempt++) {
		await until(() => readReferenceChannel(page), state => available(state) && /Live/.test(state.status),
			'Presentiment should trigger its CH5 percussion sample');
		await pause.click();
		paused = await until(() => readReferenceChannel(page), state => /Paused/.test(state.status), 'Wait for frozen real-song channel');
		if (available(paused)) break;
		await pause.click();
	}
	assert(available(paused), 'Pause should catch an active CH5 percussion sample');
	const frozen = await readPosition(page);
	await page.locator('#twoSfAuditionReference').selectOption('84');
	await page.locator('#twoSfAuditionEnabled').check();
	await until(() => page.locator('#twoSfAuditionStatus').textContent(), text => /Keyboard ready/i.test(text),
		'Presentiment percussion should be captured from the paused ADPCM channel');
	await holdC4(page, () => until(() => output(page, 1), state => state.muted && state.channels.some(({ rms }) => rms > 0.0001),
		'The original real-song ADPCM sample should produce keyboard PCM'));
	assert.equal(await readPosition(page), frozen, 'Audition should keep the real song paused');
}

async function checkSynth(page) {
	await page.reload();
	const noteStatus = page.locator('#ndsNoteStatus');
	const mode = page.locator('#ndsMode');
	const quiet = () => until(() => output(page), state => state.channels.length === 2 &&
		state.channels.every(({ peak }) => peak < 1e-7), 'Synth output should reach silence');
	const tone = () => until(() => output(page), state => state.muted &&
		state.channels.some(({ rms, pitch }) => rms > .001 && Math.abs(pitch - 261.626) < 5), 'Expected C4 from the DS Synth');
	const synthModes = [];
	for (const source of ['pcm16', 'pcm8', 'adpcm', 'pulse', 'noise']) {
		await mode.selectOption(source);
		await page.keyboard.down('6');
		try {
			if (source === 'noise') await until(() => output(page), state => state.channels.some(({ rms }) => rms > .001), 'DS noise should sound');
			else await tone();
			const channel = { pulse: /CH (?:9|1[0-4]) · Timer 0x/, noise: /CH 1[56] · Timer 0x/ }[source];
			if (channel) await until(() => noteStatus.textContent(), message => channel.test(message), `Expected ${source} on a compatible channel`);
			synthModes.push(source);
		} finally { await page.keyboard.up('6'); }
		await quiet();
	}
	await page.locator('#ndsChannel').selectOption('0');
	assert(await mode.locator('option[value="pulse"]').evaluate(option => option.disabled));
	assert(await mode.locator('option[value="noise"]').evaluate(option => option.disabled));
	await page.locator('#synthInputKeyboardTab').click();
	const key = page.locator('.key[data-key="6"]');
	await key.hover();
	await page.mouse.down();
	try {
		await tone();
		await until(() => noteStatus.textContent(), value => value.includes('CH 1 · Timer 0x'), 'Physical note should be acknowledged before changing pan');
		await page.locator('#ndsPan').evaluate(input => {
			input.value = '127';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await measureSide(page, 1, 261.626);
	} finally { await page.mouse.up(); }
	await quiet();
	const files = page.locator('#ndsFilesPanel');
	if (!(await files.isVisible())) await page.locator('#ndsFilesToggle').click();
	await files.locator('button[data-file-path="/index.js"]').click();
	await page.locator('#synthInputCodeTab').click();
	const editor = page.locator('#synthCodeEditor');
	await until(() => editor.inputValue(), value => value.includes('legacy DS draft'), 'Previous single-file draft should survive migration');
	await editor.fill(`const nds = await useSoundChip("nds");
liveLoop("test", async () => {
  await nds.noteOn(CH16, "A4", {mode: "pcm16", pan: 0});
  await beat(1);
});`);
	await page.locator('#synthCodeRunButton').click();
	await measureSide(page, 0, 440);
	await page.locator('#synthInputKeyboardTab').click();
	await measureSide(page, 0, 440);
	await page.keyboard.down('6');
	try {
		await until(() => output(page), state => state.muted &&
			state.channels[0]?.rms > .001 && Math.abs(state.channels[0].pitch - 440) < 4 &&
			state.channels[1]?.rms > .001 && Math.abs(state.channels[1].pitch - 261.626) < 5,
		'Code and keyboard should sound together on separate channels');
		await page.locator('#synthCodeStopButton').click();
		await measureSide(page, 1, 261.626);
	} finally { await page.keyboard.up('6'); }
	await quiet();
	assert.equal((await output(page)).contexts, 1, 'Code and keyboard should use one Synth context');

	await page.setViewportSize({ width: 375, height: 780 });
	assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
	return synthModes;
}

async function checkWorkspace(page, fixture, name) {
	await page.setViewportSize({ width: 1200, height: 900 });
	const panel = page.locator('#ndsFilesPanel');
	const row = (file) => panel.locator(`button[data-file-path="${file}"]`);
	if (!(await panel.isVisible())) await page.locator('#ndsFilesToggle').click();
	const keyboard = page.locator('#synthKeyboardPanel');
	const editor = page.locator('#synthCodeEditor');
	const example = panel.locator('button[data-file-path^="/examples/"][data-file-path$=".js"]').first();
	await example.click();
	assert(await keyboard.isVisible(), 'Choosing a file should keep the keyboard view');
	await page.locator('#synthInputCodeTab').click();
	await until(() => editor.inputValue(), value => value.includes('useSoundChip("nds")'), 'Starter example should be editable');
	await page.locator('#synthCodeExpandButton').click();
	assert(await page.locator('#synthExpandedCodeSlot').isVisible());
	const sidebar = await panel.boundingBox(), expanded = await page.locator('#synthExpandedCodeSlot').boundingBox();
	assert(expanded.x >= sidebar.x + sidebar.width && Math.abs(expanded.y - sidebar.y) < 3);
	await page.locator('#synthInputKeyboardTab').click();
	assert(await page.locator('#synthExpandedCodeSlot').isVisible());
	await page.locator('#synthInputCodeTab').click();
	await page.locator('#synthCodeExpandButton').click();

	const index = row('/index.js');
	await index.click();
	await until(() => editor.inputValue(), value => value.includes('liveLoop("test"'), 'Index file should be open before editing');
	const saved = 'console.log("nds-saved-baseline");\n';
	const working = 'console.log("nds-working-draft");\n';
	await editor.fill(saved);
	await page.locator('#ndsAutoApply').uncheck();
	await editor.fill(working);
	await index.getByLabel('Unsaved changes').waitFor();
	const run = page.locator('#synthCodeRunButton');
	const log = page.locator('#synthCodeLog');
	await run.click();
	await until(() => page.evaluate(() => ({ log: document.getElementById('synthCodeLog').textContent,
		state: document.getElementById('synthCodeState').textContent, error: document.getElementById('synthCodeError').textContent })),
	value => value.log.includes('nds-saved-baseline'), 'Run should use saved JavaScript with Auto apply off');
	assert(!(await log.textContent()).includes('nds-working-draft'));
	await example.click();
	await until(() => editor.inputValue(), value => value.includes('useSoundChip("nds")'), 'Example should open while Code keeps running');
	assert.match(await page.locator('#synthCodeState').textContent(), /Running|Playing/);
	await index.click();
	await until(() => editor.inputValue(), value => value === working, 'Index working edit should remain visible');
	await importFiles(page, '#ndsImportCassette', {
		name: 'invalid.cassette.zip', mimeType: 'application/zip', buffer: Buffer.from('Invalid Cassette test file'),
	});
	await until(() => page.locator('#ndsFilesStatus').textContent(), value => value.startsWith('Files:'), 'Invalid ZIP should report an error');
	assert.match(await page.locator('#synthCodeState').textContent(), /Running|Playing/);
	assert.equal(await editor.inputValue(), working);

	const pathToCassette = path.join(fixture, `${name}-draft.cassette.zip`);
	await page.locator('#menu').click();
	const downloaded = page.waitForEvent('download');
	await page.locator('#ndsExportCassette').click();
	await (await downloaded).saveAs(pathToCassette);

	await page.locator('#menu').click();
	await page.locator('#ndsNewCassette').click();
	await page.locator('#ndsNewCassetteDialog').getByRole('button', { name: /create without export/i }).click();
	await page.locator('#ndsNewCassetteDialog').waitFor({ state: 'hidden' });
	if (!(await editor.isVisible())) await page.locator('#synthInputCodeTab').click();
	await until(() => editor.inputValue(), value => value.includes('liveLoop("melody"'), 'New Cassette should have starter code');
	assert.match(await page.locator('#synthCodeState').textContent(), /Idle|Stopped/);

	await importFiles(page, '#ndsImportCassette', pathToCassette);
	await index.getByLabel('Unsaved changes').waitFor();
	if (!(await editor.isVisible())) await page.locator('#synthInputCodeTab').click();
	await index.click();
	await until(() => editor.inputValue(), value => value === working, 'Imported working edit should be visible');
	assert.equal(await page.locator('#ndsAutoApply').isChecked(), false);
	assert.match(await page.locator('#synthCodeState').textContent(), /Idle|Stopped/);
	await page.locator('#ndsDiscardFile').click();
	await until(() => editor.inputValue(), value => value === saved, 'Discard should restore the saved code from the Cassette');
	await index.getByLabel('Unsaved changes').waitFor({ state: 'hidden' });
	await editor.fill(working);
	await index.getByLabel('Unsaved changes').waitFor();
	await editor.press('Control+s');
	await index.getByLabel('Unsaved changes').waitFor({ state: 'hidden' });
	await until(() => page.locator('#ndsFilesStatus').textContent(), value => value === 'Files saved.', 'Manual save should reach local storage');
	await page.reload();
	if (!(await editor.isVisible())) await page.locator('#synthInputCodeTab').click();
	await until(() => editor.inputValue(), value => value === working, 'Saved Code should survive a page reload');
	assert.equal(await index.getByLabel('Unsaved changes').count(), 0);
	assert.equal((await output(page)).contexts, 0, 'Workspace restore should not start audio');
	await run.click();
	await until(() => log.textContent(), value => value.includes('nds-working-draft'), 'Reload should retain the new saved baseline');
	await page.locator('#synthCodeStopButton').click();

	const examplePath = await example.getAttribute('data-file-path');
	const copy = row(examplePath.replace(/\.js$/, '-copy.js'));
	const fileMenu = page.locator('#spuFileContextMenu');
	await example.click({ button: 'right' });
	await fileMenu.getByRole('menuitem', { name: 'Duplicate' }).click();
	await copy.getByLabel('Unsaved changes').waitFor();
	await copy.click({ button: 'right' });
	await fileMenu.getByRole('menuitem', { name: 'Rename…' }).click();
	await page.locator('#ndsFileName').fill('/examples/temporary-edition.js');
	await page.locator('#ndsFileNameConfirm').click();
	const renamed = row('/examples/temporary-edition.js');
	await renamed.getByLabel('Unsaved changes').waitFor();
	await page.locator('#ndsDiscardAll').click();
	await renamed.waitFor({ state: 'hidden' });
	assert(await example.isVisible());

	await page.setViewportSize({ width: 375, height: 780 });
	assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
	return 'legacy draft, file actions, saved and working views, New and ZIP round trip';
}

async function checkSample(page, fixture, name) {
	const { encodeWav } = await import('../../docs/js/wav.js');
	const sampleRate = 24000;
	const wave = Float32Array.from({ length: 5760 }, (_, frame) => .7 * Math.sin(frame * Math.PI * 2 / 80));
	const source = { name: 'Marked cycle.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav({ sampleRate, channels: [wave, wave] })) };
	const panel = page.locator('#ndsSampleEditor'), mode = page.locator('#ndsMode'), repeat = page.locator('#ndsLoop');
	const start = page.locator('#ndsSampleStart'), end = page.locator('#ndsSampleEnd'), rootNote = page.locator('#ndsSampleRoot');
	const savedSounds = page.locator('#ndsSavedSounds');
	await page.locator('#synthInputKeyboardTab').click();
	await page.locator('#ndsChannel').selectOption('auto');
	await mode.selectOption('pcm16');
	await importFiles(page, '#ndsLoadWav', source);
	await panel.waitFor();
	assert.equal(await repeat.isChecked(), false);
	assert.equal(await rootNote.inputValue(), '60');
	assert.match(await page.locator('#ndsSampleInfo').textContent(), /PCM16.*24,?000 Hz/);

	await mode.selectOption('pcm8');
	assert.match(await page.locator('#ndsSampleInfo').textContent(), / · PCM8 · /);
	await mode.selectOption('adpcm');
	assert.match(await page.locator('#ndsSampleInfo').textContent(), / · IMA-ADPCM · /);
	const samplePlot = page.locator('#ndsSampleCanvas');
	await samplePlot.scrollIntoViewIfNeeded();
	const rect = await samplePlot.boundingBox();
	await page.mouse.move(rect.x + 2, rect.y + rect.height / 2);
	await page.mouse.down();
	await page.mouse.move(rect.x + rect.width / 5, rect.y + rect.height / 2);
	await page.mouse.up();
	assert(Number(await start.inputValue()) > 1000, 'Dragging the waveform marker should move the repeat start');
	const change = async (field, value) => { await field.fill(value); await field.press('Tab'); };
	await change(start, '803');
	await change(end, '3996');
	await change(rootNote, '72');
	await repeat.check();
	assert.equal(await start.inputValue(), '800');
	assert.equal(await end.inputValue(), '4000');
	assert.match(await page.locator('#ndsSampleStatus').textContent(), /PNT 101 · LEN 400 words/);
	await importFiles(page, '#ndsLoadWav', { name: 'Invalid.wav', mimeType: 'audio/wav', buffer: Buffer.from('not a valid WAV') });
	await until(() => page.locator('#status').textContent(), value => /WAV|RIFF/i.test(value), 'Invalid WAV should report an error');
	assert.equal(await start.inputValue(), '800');

	const tuned = state => state.muted && state.channels.some(({ rms, pitch }) => rms > .002 && Math.abs(pitch - 150) < 3);
	const quiet = label => until(() => output(page), state => state.channels.every(({ peak }) => peak < 1e-7), label);
	async function hearLoop() {
		await page.keyboard.down('6'); // C4, one octave below the saved root note.
		try {
			await until(() => output(page), tuned, 'Imported WAV should transpose by source rate and root note');
			await wait(550);
			assert(tuned(await output(page)), 'Repeat should sustain the edited window past the one-shot duration');
		} finally { await page.keyboard.up('6'); }
		await quiet('Sample note should release');
	}
	await hearLoop();

	await page.locator('#ndsSaveSound').click();
	await page.locator('#ndsSoundName').fill('Browser sample');
	await page.locator('#ndsSaveSoundCommit').click();
	await page.locator('#ndsSaveSoundDialog').waitFor({ state: 'hidden' });
	const presetPath = '/presets/Browser sample.nds.json';
	assert.equal(await savedSounds.locator(`option[value="${presetPath}"]`).count(), 1);

	const zipPath = path.join(fixture, `${name}-sample.cassette.zip`);
	await page.locator('#menu').click();
	const downloaded = page.waitForEvent('download');
	await page.locator('#ndsExportCassette').click();
	await (await downloaded).saveAs(zipPath);
	await page.locator('#ndsUseBuiltin').click();
	assert(await panel.isHidden());
	await page.locator('#menu').click();
	await page.locator('#ndsNewCassette').click();
	await page.locator('#ndsNewCassetteCreate').click();
	await page.locator('#ndsNewCassetteDialog').waitFor({ state: 'hidden' });
	await until(() => savedSounds.isDisabled(), Boolean, 'New Cassette should have no user sound');
	await importFiles(page, '#ndsImportCassette', zipPath);
	await savedSounds.locator(`option[value="${presetPath}"]`).waitFor({ state: 'attached' });
	await savedSounds.selectOption(presetPath);
	await panel.waitFor();
	assert.equal(await mode.inputValue(), 'adpcm');
	assert.equal(await rootNote.inputValue(), '72');
	assert.equal(await start.inputValue(), '800');
	assert.equal(await end.inputValue(), '4000');
	assert.equal(await repeat.isChecked(), true);
	assert(await page.locator('#synthKeyboardPanel').isVisible());
	await hearLoop();

	await page.locator('#synthInputCodeTab').click();
	const files = page.locator('#ndsFilesPanel'), editor = page.locator('#synthCodeEditor');
	if (!(await files.isVisible())) await page.locator('#ndsFilesToggle').click();
	const index = files.locator('button[data-file-path="/index.js"]');
	await index.click();
	await until(() => editor.inputValue(), value => value.includes('nds-working-draft'), 'Cassette should restore the saved entry source');
	await editor.fill(`const nds = await useSoundChip("nds");
await nds.loadPreset(CH2, await file(${JSON.stringify(presetPath)}, { type: "json" }));
const state = await nds.getState(CH2);
if (state.active || state.mode !== "adpcm" || state.rootNote !== 72 || state.sampleRate !== 24000 ||
    state.loopStartWords !== 101 || state.lengthWords !== 400 || !state.loop || state.byteLength === 0) {
  throw new Error("Expected a configured, silent ADPCM channel: " + JSON.stringify(state));
}
await nds.noteOn(CH2, "C4");`);
	await index.getByLabel('Unsaved changes').waitFor();
	await editor.press('Control+s');
	await index.getByLabel('Unsaved changes').waitFor({ state: 'hidden' });
	await until(() => page.locator('#ndsFilesStatus').textContent(), value => value === 'Files saved.', 'Code entry should be saved in manual mode');
	const run = page.locator('#synthCodeRunButton'), stop = page.locator('#synthCodeStopButton');
	await run.click();
	try {
		const code = await until(() => page.evaluate(() => ({
			state: document.getElementById('synthCodeState').textContent,
			error: document.getElementById('synthCodeError').textContent,
		})), value => /Running|Error/.test(value.state), 'Code should finish loading the saved sample');
		assert.equal(code.state, 'Running', code.error);
		await until(() => output(page), tuned, 'Code should play the restored sample one octave below its root');
		await wait(550);
		assert(tuned(await output(page)), 'Code should sustain the restored repeat window');
	} finally { await stop.click(); }
	await quiet('Stopping Code should release its sample note');
	assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
	return 'WAV conversion, tuned loop, sound saved in manual mode and played from the restored Cassette in Keyboard and Code';
}

async function check(name, origin, fixture) {
	const browser = await engines[name].launch({ headless: true,
		...(name === 'chromium' ? { args: ['--mute-audio'] } : {}),
	});
	try {
		const page = await browser.newPage();
		page.setDefaultTimeout(15000);
		const errors = [], fetchFailures = [];
		page.on('pageerror', (error) => errors.push(error.message));
		page.on('response', (response) => {
			if (response.status() >= 400) fetchFailures.push(new URL(response.url()).pathname);
		});
		await page.route('**/*', (route) => new URL(route.request().url()).origin === origin
			? route.continue()
			: route.abort());
		await page.addInitScript(silentAudit);
		await page.addInitScript(() => {
			if (sessionStorage.getItem('nds-test-seeded')) return;
			sessionStorage.setItem('nds-test-seeded', 'true');
			localStorage.setItem('tetorica-nitro-ds-code-v1', JSON.stringify({
				workspaceId: 'tetorica-nitro-ds', path: '/index.js',
				source: '// legacy DS draft\nconst nds = await useSoundChip("nds");\n',
			}));
		});
		await page.goto(`${origin}${options.entry}`);

		await importFiles(page, '#loadTwoSfFolder', fixture);
		const choices = await until(() => tracks(page), (entries) => entries.length === 2, 'Two original tracks expected');
		assert.equal((await output(page)).contexts, 0, 'Folder import must not start audio');
		const select = page.locator('#songSelect');
		const fixtureChoice = (name) => {
			const entry = choices.find(({ value, label }) => value.includes(name) || label.includes(name));
			assert(entry, `Missing original track ${name}`);
			return entry.value;
		};
		const play = page.locator('#play'), pause = page.locator('#pause'), stop = page.locator('#stop');
		const live = page.locator('#twoSfLiveEnabled'), channel = page.locator('#twoSfLiveChannel');
		const readLive = () => readReferenceChannel(page);
		await until(() => live.isChecked(), Boolean, 'Reference Live should be enabled by default');
		assert.equal(await channel.locator('option').count(), 16, 'All physical DS channels should be selectable');
		assert.equal((await readLive()).visible, false, 'No channel data is shown before playback');
		await select.selectOption(fixtureChoice('left-a4'));
		await play.click();
		const left = await measureSide(page, 0, 440);
		await until(readLive, state => /Live/i.test(state.status) && fixtureChannel(state, 440, 0), 'Expected CH1 settings of the audible left-A4 song');
		await pause.click();
		const freeze = await until(() => output(page), (state) => state.contextState === 'suspended', 'Paused audio context expected');
		const pausedPosition = await readPosition(page);
		const frozenChannel = await until(readLive, state => /Paused/.test(state.status) && fixtureChannel(state, 440, 0), 'Reference CH1 should freeze when paused');
		await channel.selectOption('15');
		await until(readLive, state => state.visible && /Paused/.test(state.status) && state.active === 'Idle',
			'Selecting CH16 should show its idle state from the paused frame');
		await live.uncheck();
		await until(readLive, state => !state.visible && /Off/i.test(state.status), 'Turning Live off should hide the channel readings');
		await live.check();
		await until(readLive, state => state.visible && /Paused/.test(state.status) && state.active === 'Idle',
			'Turning Live back on should restore the paused CH16');
		await channel.selectOption('0');
		assert.deepEqual(await readLive(), frozenChannel, 'Selecting CH1 again should reveal the same frozen settings');
		await wait(200);
		assert.equal((await output(page)).currentTime, freeze.currentTime);
		assert.equal(await readPosition(page), pausedPosition);
		assert.deepEqual(await readLive(), frozenChannel, 'Paused channel readings should stay fixed');
		assert.match(await pause.innerText(), /Resume/i);

		await importFiles(page, '#loadTwoSfFiles', {
			name: 'missing-library.mini2sf', mimeType: 'application/octet-stream',
			buffer: await fs.readFile(path.join(fixture, 'right-e5.mini2sf')),
		});
		const invalid = await until(() => tracks(page), (entries) => entries.some(({ value, label }) =>
			value.includes('missing-library') || label.includes('missing-library')), 'Missing-library track expected');
		await select.selectOption(invalid.find(({ value, label }) => value.includes('missing-library') || label.includes('missing-library')).value);
		await play.click();
		await until(() => page.locator('#status').innerText(), (status) => /(?:missing|not found).*\blibrary\b|\blibrary\b.*(?:missing|not found)/i.test(status), 'Missing dependency error expected');
		assert.match(await pause.innerText(), /Resume/i);
		assert.equal((await output(page)).currentTime, freeze.currentTime);
		assert.equal(await readPosition(page), pausedPosition);
		assert.deepEqual(await readLive(), frozenChannel, 'A missing library should leave the paused song observation intact');
		await checkPausedAudition(page, pausedPosition, freeze.currentTime);
		await pause.click();
		await until(() => output(page, 0), (state) => state.currentTime > freeze.currentTime + 0.04, 'Playback clock should resume');
		await page.locator('#twoSfAuditionTools').waitFor({ state: 'hidden' });
		assert(!(await page.locator('#twoSfAuditionEnabled').isChecked()), 'Resuming playback should clear audition');
		await measureSide(page, 0, 440, 0);
		await holdC4(page, () => measureSide(page, 1, 261.626));
		await stop.click();
		await until(() => output(page, 0), (state) => state.channels.every(({ peak }) => peak < 1e-7), 'Stop should silence the output');
		await until(readLive, state => !state.visible, 'Stop should clear the previous channel observation');

		await importFiles(page, '#loadTwoSfFolder', fixture);
		const restored = await until(() => tracks(page), (entries) => entries.some(({ value, label }) =>
			value.includes('right-e5') || label.includes('right-e5')), 'Original folder should be selectable again');
		await select.selectOption(restored.find(({ value, label }) => value.includes('right-e5') || label.includes('right-e5')).value);
		await play.click();
		const right = await measureSide(page, 1, 659.255, 0);
		await until(readLive, state => /Live/i.test(state.status) && fixtureChannel(state, 659.255, 127), 'Reference CH1 should reflect the new right-E5 song');
		await stop.click();

		await select.selectOption(fixtureChoice('left-a4'));
		await play.click();
		await until(readLive, state => /Live/i.test(state.status) && fixtureChannel(state, 440, 0), 'Play the left fixture again before testing Capture');
		await pause.click();
		await until(readLive, state => /Paused/.test(state.status) && fixtureChannel(state, 440, 0), 'Pause CH1 ready for Capture');
		await checkReferenceCapture(page);
		await stop.click();

		let realSongs = null, realAudition = null;
		if (realFolder) {
			await page.reload();
			await importFiles(page, '#loadTwoSfFolder', realFolder);
			const realTracks = await until(() => tracks(page), (entries) => entries.length === 71, '71 tracks expected from the local set', 30000);
			const presentiment = realTracks.find(({ label }) => /Presentiment/i.test(label));
			await select.selectOption((presentiment ?? realTracks[0]).value);
			await play.click();
			await until(() => output(page), (state) => state.muted && state.channels.some(({ rms }) => rms > 0.0001), 'Expected playback from the local 2SF set', 30000);
			if (presentiment) {
				await checkPresentimentAudition(page);
				realAudition = 'Presentiment CH5 IMA-ADPCM one-shot';
			}
			await stop.click();
			realSongs = realTracks.length;
		}
		const audit = await output(page);
		assert(audit.muted && audit.outputs > 0);
		const synthModes = await checkSynth(page);
		const workspace = await checkWorkspace(page, fixture, name);
		const sample = await checkSample(page, fixture, name);
		assert.deepEqual(errors, []);
		assert.deepEqual(fetchFailures, []);
		return { browser: name, left, right, realSongs, realAudition, synthModes, workspace, sample,
			referenceLive: 'fixture registers and pan, frozen pause and channel switch, Live toggle, missing library and Stop',
			referenceAudition: 'frozen 440 Hz sample, C5-root transposition, idle channel silence, authored keyboard restored after Live Off and Resume',
			referenceCapture: 'captured settings and exact original PCM16 preset, 220 Hz from editable Synth and saved-preset Code',
			physicalOutputMuted: true };
	} finally {
		await browser.close();
	}
}

async function main() {
	const fixture = await fs.mkdtemp(path.join(tmpdir(), 'tetorica-2sf-browser-'));
	const server = http.createServer(async (request, response) => {
		try {
			const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
			if (requested === '/favicon.ico') return response.writeHead(204).end();
			const file = path.resolve(webRoot, `.${requested}`);
			assert(file.startsWith(webRoot + path.sep));
			response.setHeader('Content-Type', contentTypes[path.extname(file)] ?? 'application/octet-stream');
			response.end(await fs.readFile(file));
		} catch {
			response.writeHead(404).end();
		}
	});
	try {
		execFileSync('python3', [path.join(__dirname, 'make_fixture.py'), fixture]);
		await new Promise((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', resolve);
		});
		const origin = `http://127.0.0.1:${server.address().port}`;
		for (const name of browsers) console.log(JSON.stringify(await check(name, origin, fixture)));
	} finally {
		server.closeAllConnections();
		if (server.listening) await new Promise((resolve) => server.close(resolve));
		await fs.rm(fixture, { recursive: true, force: true });
	}
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
