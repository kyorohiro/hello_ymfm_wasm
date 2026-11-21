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
			visible: document.getElementById('twoSfLiveDetails').getClientRects().length > 0,
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

const channelButton = (page, channel) => page.locator(`#ndsChannelButtons [data-channel="${channel}"]`);

async function assertReferenceInstrument(page, hz, expectedPan) {
	const instrument = page.locator('#ndsInstrument');
	await instrument.waitFor();
	assert.match(await page.locator('#instrumentTitle').textContent(), /2SF.*CH\s*1/);
	const expectedTimer = 65536 - Math.round(16756991 / (hz * 32));
	const timer = `0x${expectedTimer.toString(16).padStart(4, '0')}`;
	await until(() => instrument.evaluate(element => {
		const field = id => element.querySelector(`#${id}`);
		return {
			mode: field('ndsMode').value, volume: Number(field('ndsVolume').value), pan: Number(field('ndsPan').value),
			timer: field('ndsTimerValue').textContent, loop: field('ndsLoop').checked,
		};
	}), values => values.mode === 'pcm16' && values.volume === 100 && values.pan === expectedPan &&
		values.loop && values.timer.toLowerCase().includes(timer), 'The Synth controls should show the selected 2SF channel');
	for (const selector of ['#ndsMode', '#ndsVolume', '#ndsPan', '#ndsLoop', '#ndsTimerSlider', '#ndsTimerHz']) {
		assert(await instrument.locator(selector).isDisabled(), `${selector} should be read-only for 2SF`);
	}
}

async function checkPausedAudition(page, frozenPosition, frozenClock) {
	const reference = page.locator('#twoSfAuditionReference');
	const status = () => page.locator('#twoSfAuditionStatus').textContent();
	const ready = () => until(status, text => /Keyboard ready/i.test(text), 'The paused channel should be ready for keyboard audition');
	const live = page.locator('#twoSfLiveEnabled');
	const silent = ({ channels }) => channels.length === 2 && channels.every(({ peak }) => peak < 1e-7);
	const verifySongFrozen = async () => {
		const state = await output(page, 0);
		assert.equal(state.contextState, 'suspended', 'The reference audio should remain paused during audition');
		assert.equal(state.currentTime, frozenClock, 'Keyboard audition must not advance the reference clock');
		assert.equal(await readPosition(page), frozenPosition);
	};

	// Distinguish the authored sound from the reference with both pitch and pan.
	await channelButton(page, -1).click();
	await page.locator('#ndsPan').evaluate(input => {
		input.value = '127';
		input.dispatchEvent(new Event('input', { bubbles: true }));
	});
	await channelButton(page, 0).click();
	assert.equal(await reference.inputValue(), '60', 'Audition starts with C4 as the root note');
	await assertReferenceInstrument(page, 440, 0);
	await ready();
	await page.locator('#ndsSampleCanvas').waitFor();
	await until(() => page.locator('#ndsSampleStatus').textContent(), value => /32 decoded frames/.test(value) && /64 PCM bytes/.test(value),
		'Paused 2SF should show its actual decoded sample in the Synth waveform panel');
	await holdC4(page, () => measureSide(page, 0, 440, 1));
	await until(() => output(page, 1), silent, 'Releasing the key should silence the frozen sample');
	await verifySongFrozen();

	await reference.selectOption('72');
	await ready();
	await holdC4(page, () => measureSide(page, 0, 220, 1));
	await until(() => output(page, 1), silent, 'The transposed note should release');
	await channelButton(page, 15).click();
	await until(status, text => /idle/i.test(text), 'An idle reference channel should have no playable sample');
	await holdC4(page, async () => {
		await wait(120);
		assert(silent(await output(page, 1)), 'An idle reference channel must not replay the previous sample');
		assert.equal((await output(page)).outputs, 2, 'Audition must not fall back to the authored Synth while enabled');
	});
	await verifySongFrozen();

	await channelButton(page, 0).click();
	await ready();
	await live.uncheck();
	await page.locator('#twoSfLiveDetails').waitFor({ state: 'hidden' });
	await page.locator('#twoSfAuditionTools').waitFor();
	await holdC4(page, () => measureSide(page, 0, 220, 1));
	await verifySongFrozen();

	await channelButton(page, -1).click();
	await page.locator('#ndsInstrument').waitFor();
	await page.locator('#twoSfAuditionTools').waitFor({ state: 'hidden' });
	assert.equal(await page.locator('#ndsPan').inputValue(), '127', 'Audition must preserve authored Synth settings');
	await holdC4(page, () => measureSide(page, 1, 261.626));
	await verifySongFrozen();
	await channelButton(page, 0).click();
	await live.check();
	await ready();
}

async function checkReferenceCapture(page) {
	const pausedPosition = await readPosition(page);
	const capture = page.locator('#twoSfCapture');
	await page.locator('#twoSfAuditionReference').selectOption('72');
	await capture.click();
	await page.locator('#ndsSampleRangeFields').waitFor();
	assert.equal(await channelButton(page, -1).getAttribute('aria-pressed'), 'true', 'Capture should return the keyboard to the editable Auto sound');
	assert.match(await page.locator('#pause').innerText(), /Resume/);
	assert.equal(await readPosition(page), pausedPosition, 'Capture should retain the paused song position');
	await channelButton(page, 0).click();
	await until(() => readReferenceChannel(page), state => state.visible && /Paused/.test(state.status),
		'Reopening the reference view should show the same paused song');
	await channelButton(page, -1).click();
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
	await channelButton(page, 0).click();
	await panel.locator(`button[data-file-path="${presetPath}"]`).click();
	await until(() => channelButton(page, -1).getAttribute('aria-pressed'), value => value === 'true', 'Loading a saved sound should reveal it in Auto');
	assert.equal(await readPosition(page), pausedPosition, 'Loading a saved sound should keep the song paused');
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
	const pause = page.locator('#pause');
	const available = state => state.visible && state.active === 'Active' && state.format === 'IMA-ADPCM';
	await channelButton(page, 4).click();
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
	await until(() => page.locator('#twoSfAuditionStatus').textContent(), text => /Keyboard ready/i.test(text),
		'Presentiment percussion should be captured from the paused ADPCM channel');
	// A short percussion hit can finish before the first analyser read.
	let audible = false;
	for (let attempt = 0; attempt < 3 && !audible; attempt++) {
		audible = await holdC4(page, async () => {
			const deadline = Date.now() + 400;
			do {
				const state = await output(page, 1);
				if (state.muted && state.channels.some(({ peak }) => peak > 0.00001)) return true;
				await wait(10);
			} while (Date.now() < deadline);
			return false;
		});
	}
	assert(audible, 'The original real-song ADPCM sample should produce keyboard PCM');
	assert.equal(await readPosition(page), frozen, 'Audition should keep the real song paused');
}

async function checkSynth(page) {
	await page.reload();
	const noteStatus = page.locator('#ndsNoteStatus');
	const mode = page.locator('#ndsMode');
	const preview = page.locator('#ndsSampleCanvas'), sampleInfo = page.locator('#ndsSampleInfo');
	const generatedSource = page.locator('#ndsGeneratedSource'), sampleRange = page.locator('#ndsSampleRangeFields');
	const shape = page.locator('#ndsShape'), repeat = page.locator('#ndsLoop');
	const loadWav = page.locator('#ndsLoadWav'), duty = page.locator('#ndsDuty');
	const pcmFormats = {
		pcm16: ['PCM16 waveform', /16-bit signed PCM.*128 bytes/],
		pcm8: ['PCM8 waveform', /8-bit signed PCM.*64 bytes/],
		adpcm: ['IMA-ADPCM waveform', /4-bit codes.*36 bytes/],
	};
	const pcmPlots = new Set();
	const quiet = () => until(() => output(page), state => state.channels.length === 2 &&
		state.channels.every(({ peak }) => peak < 1e-7), 'Synth output should reach silence');
	const tone = () => until(() => output(page), state => state.muted &&
		state.channels.some(({ rms, pitch }) => rms > .001 && Math.abs(pitch - 261.626) < 5), 'Expected C4 from the DS Synth');
	const synthModes = [];
	for (const source of ['pcm16', 'pcm8', 'adpcm', 'pulse', 'noise']) {
		await mode.selectOption(source);
		const format = pcmFormats[source];
		if (format) {
			assert(await preview.isVisible() && await shape.isVisible() && await repeat.isVisible() && await loadWav.isVisible(),
				'PCM modes should display their waveform and sample controls');
			assert(await sampleRange.isHidden() && await generatedSource.isHidden() && await duty.isHidden());
			const [title, encoding] = format;
			assert.equal(await page.locator('#ndsSampleTitle').textContent(), title);
			assert.match(await sampleInfo.textContent(), encoding, 'The preview should describe the selected encoded format');
			pcmPlots.add(await preview.evaluate(canvas => canvas.toDataURL()));
		} else {
			assert(await preview.isHidden() && await shape.isHidden() && await repeat.isHidden() && await loadWav.isHidden(),
				'Oscillator modes should hide PCM controls');
			assert.equal(await duty.isVisible(), source === 'pulse', 'Only Pulse should show duty');
			assert(await generatedSource.isVisible());
			assert.match(await generatedSource.textContent(), source === 'pulse' ? /8 steps per cycle/ : /15-bit LFSR/);
		}
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
	assert.equal(pcmPlots.size, 3, 'Each built-in PCM format should draw its own decoded waveform');
	await channelButton(page, 0).click();
	assert.equal(await channelButton(page, 0).getAttribute('aria-pressed'), 'true');
	assert(await mode.locator('option[value="pulse"]').evaluate(option => option.disabled));
	assert(await mode.locator('option[value="noise"]').evaluate(option => option.disabled));
	const keyboardTab = page.locator('#synthInputKeyboardTab'), codeTab = page.locator('#synthInputCodeTab');
	await keyboardTab.click();
	await assertCodeTransport(page, false);
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
	await mode.focus();
	assert(await mode.evaluate(select => select === document.activeElement));
	await holdC4(page, () => measureSide(page, 1, 261.626));
	assert.equal(await mode.inputValue(), 'pcm16', 'A musical key must not change the focused sound source');
	await quiet();
	const files = page.locator('#ndsFilesPanel');
	if (!(await files.isVisible())) await page.locator('#ndsFilesToggle').click();
	await files.locator('button[data-file-path="/index.js"]').click();
	await codeTab.click();
	await assertCodeTransport(page, true);
	const editor = page.locator('#synthCodeEditor');
	await until(() => editor.inputValue(), value => value.includes('legacy DS draft'), 'Previous single-file draft should survive migration');
	await editor.fill(`const nds = await useSoundChip("nds");
liveLoop("test", async () => {
  await nds.noteOn(CH16, "A4", {mode: "pcm16", pan: 0});
  await beat(1);
});`);
	await page.locator('#synthCodeRunButton').click();
	await measureSide(page, 0, 440);
	await keyboardTab.click();
	await assertCodeTransport(page, false);
	await measureSide(page, 0, 440);
	await page.keyboard.down('6');
	try {
		await until(() => output(page), state => state.muted &&
			state.channels[0]?.rms > .001 && Math.abs(state.channels[0].pitch - 440) < 4 &&
			state.channels[1]?.rms > .001 && Math.abs(state.channels[1].pitch - 261.626) < 5,
		'Code and keyboard should sound together on separate channels');
		await codeTab.click();
		await page.locator('#synthCodeStopButton').click();
		await measureSide(page, 1, 261.626);
	} finally { await page.keyboard.up('6'); }
	await quiet();
	assert.equal((await output(page)).contexts, 1, 'Code and keyboard should use one Synth context');
	await keyboardTab.click();
	await assertCodeTransport(page, false);

	await page.setViewportSize({ width: 375, height: 780 });
	assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
	return synthModes;
}

async function assertCodeTransport(page, visible) {
	const transport = page.locator('#synthCodePanel .code-toolbar');
	await transport.waitFor({ state: visible ? 'visible' : 'hidden' });
	for (const name of ['Run', 'Apply', 'Stop']) {
		assert.equal(await page.locator(`#synthCode${name}Button`).isVisible(), visible,
			`${name} should only appear in the Code tab`);
		assert.equal(await transport.locator(`#synthCode${name}Button`).count(), 1);
	}
}

async function checkWorkspace(page, fixture, name) {
	const viewport = page.viewportSize();
	await page.setViewportSize({ width: 1200, height: 900 });
	const panel = page.locator('#ndsFilesPanel');
	const row = (file) => panel.locator(`button[data-file-path="${file}"]`);
	if (!(await panel.isVisible())) await page.locator('#ndsFilesToggle').click();
	const synth = page.locator('#ndsSynthEditor'), synthLayout = page.locator('#synthWorkspaceSynthButton');
	const codeLayout = page.locator('#synthWorkspaceCodeButton'), codeSlot = page.locator('#synthExpandedCodeSlot');
	const expandedTabs = page.locator('#synthExpandedTabsSlot');
	const codeTab = page.locator('#synthInputCodeTab'), keyboardTab = page.locator('#synthInputKeyboardTab');
	const reference = page.locator('#referenceTitle'), playSong = page.locator('#play'), master = page.locator('#master');
	const keyboard = page.locator('#synthKeyboardPanel');
	const editor = page.locator('#synthCodeEditor');
	const assertBesideFiles = async (content, label) => {
		const sidebar = await panel.boundingBox(), main = await content.boundingBox();
		assert(sidebar && main && main.x >= sidebar.x + sidebar.width && Math.abs(main.y - sidebar.y) < 3, label);
	};
	await assertBesideFiles(synth, 'Files should start beside the Synth controls');
	const example = panel.locator('button[data-file-path^="/examples/"][data-file-path$=".js"]').first();
	await example.click();
	assert(await keyboard.isVisible(), 'Choosing a file should keep the keyboard view');
	await page.locator('#ndsFilesToggle').click();
	await panel.waitFor({ state: 'hidden' });
	await codeLayout.click();
	await codeSlot.waitFor();
	await assertCodeTransport(page, true);
	assert(await panel.isVisible(), 'Opening the Code workspace should also open Files');
	await until(() => editor.inputValue(), value => value.includes('useSoundChip("nds")'), 'Starter example should be editable');
	assert.equal(await codeLayout.getAttribute('aria-pressed'), 'true');
	assert.deepEqual(await expandedTabs.getByRole('tab').allTextContents(), ['Code', 'DS', 'Mixer', 'Keyboard']);
	await assertBesideFiles(expandedTabs, 'Files and the expanded tabs should start at the same height');
	assert(!(await synth.isVisible()), 'The expanded Code tab should show the editor');
	assert(await playSong.isVisible() && await master.isVisible(), 'Expanded Code should keep 2SF transport and Master available');
	await reference.click();
	await playSong.waitFor({ state: 'hidden' });
	assert(await codeSlot.isVisible(), 'Collapsing reference playback should keep Code visible');
	await reference.click();
	await playSong.waitFor();
	await page.locator('#ndsChipTab').click();
	await synth.waitFor();
	await assertCodeTransport(page, false);
	assert(!(await codeSlot.isVisible()));
	assert.equal(await codeLayout.getAttribute('aria-pressed'), 'true', 'Opening DS should keep the expanded workspace');
	const capturedPreset = row('/presets/2SF CH 1.nds.json');
	if (!(await capturedPreset.isVisible())) await panel.locator('summary[data-file-path="/presets"]').click();
	await capturedPreset.click();
	await until(() => page.locator('#ndsSampleRoot').inputValue(), value => value === '72', 'The saved 2SF instrument should apply in the DS tab');
	assert(await synth.isVisible() && !(await codeSlot.isVisible()), 'Choosing a preset in the DS tab should keep that tab open');
	await keyboardTab.click();
	await keyboard.waitFor();
	await assertCodeTransport(page, false);
	assert(await codeSlot.isVisible() && !(await synth.isVisible()));
	assert.equal(await codeLayout.getAttribute('aria-pressed'), 'true', 'Opening Keyboard should keep the expanded workspace');
	await codeTab.click();
	await editor.waitFor();
	await assertCodeTransport(page, true);
	await synthLayout.click();
	await codeSlot.waitFor({ state: 'hidden' });
	assert.equal(await synthLayout.getAttribute('aria-pressed'), 'true');
	assert(await synth.isVisible() && await editor.isVisible(), 'Restoring Synth should keep the selected Code input below it');
	await assertBesideFiles(synth, 'Files should stay beside the restored Synth controls');

	const index = row('/index.js');
	await index.click();
	if (!(await editor.isVisible())) await page.locator('#synthInputCodeTab').click();
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
	await codeLayout.click();
	await codeSlot.waitFor();
	await page.locator('#ndsChipTab').click();
	await synth.waitFor();
	await assertCodeTransport(page, false);
	assert.match(await page.locator('#synthCodeState').textContent(), /Running|Playing/);
	await synthLayout.click();
	await expandedTabs.waitFor({ state: 'hidden' });
	assert.match(await page.locator('#synthCodeState').textContent(), /Running|Playing/, 'Changing layouts should keep Code running');
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
	await example.scrollIntoViewIfNeeded();
	await example.click({ button: 'right' });
	await fileMenu.getByRole('menuitem', { name: 'Duplicate' }).click();
	await copy.getByLabel('Unsaved changes').waitFor();
	await copy.scrollIntoViewIfNeeded();
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
	await codeLayout.click();
	await expandedTabs.waitFor();
	const sidebar = await panel.boundingBox(), tabs = await expandedTabs.boundingBox();
	assert(sidebar && tabs && tabs.y >= sidebar.y + sidebar.height, 'On a narrow screen Files should stack above the expanded workspace');
	assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Expanded workspace should fit a narrow screen');
	await synthLayout.click();
	await expandedTabs.waitFor({ state: 'hidden' });
	await page.setViewportSize(viewport);
	return 'Shared Code/DS/Mixer/Keyboard tabs and sidebar on desktop and mobile, running Code retained, legacy draft, saved and working files, New and ZIP round trip';
}

async function checkSample(page, fixture, name) {
	const { encodeWav } = await import('../../docs/js/wav.js');
	const sampleRate = 24000;
	const wave = Float32Array.from({ length: 5760 }, (_, frame) => .7 * Math.sin(frame * Math.PI * 2 / 80));
	const source = { name: 'Marked cycle.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav({ sampleRate, channels: [wave, wave] })) };
	const panel = page.locator('#ndsSampleEditor'), sampleRange = page.locator('#ndsSampleRangeFields');
	const mode = page.locator('#ndsMode'), repeat = page.locator('#ndsLoop');
	const start = page.locator('#ndsSampleStart'), end = page.locator('#ndsSampleEnd'), rootNote = page.locator('#ndsSampleRoot');
	const savedSounds = page.locator('#ndsSavedSounds');
	await page.locator('#synthInputKeyboardTab').click();
	await channelButton(page, -1).click();
	await mode.selectOption('pcm16');
	await importFiles(page, '#ndsLoadWav', source);
	await sampleRange.waitFor();
	assert.equal(await repeat.isChecked(), false);
	assert(await start.isDisabled(), 'A one-shot sample should not allow editing the loop start');
	assert.equal(await rootNote.inputValue(), '60');
	assert.match(await page.locator('#ndsSampleInfo').textContent(), /16-bit signed PCM.*24,?000 Hz/);

	await mode.selectOption('pcm8');
	assert.equal(await page.locator('#ndsSampleTitle').textContent(), 'PCM8 waveform');
	await mode.selectOption('adpcm');
	assert.equal(await page.locator('#ndsSampleTitle').textContent(), 'IMA-ADPCM waveform');
	assert(await start.isDisabled(), 'Converting a one-shot sample should retain the disabled loop start');
	await repeat.check();
	assert(await start.isEnabled());
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
	assert(await panel.isVisible() && await sampleRange.isHidden(), 'The built-in preview should remain after clearing the WAV');
	await page.locator('#menu').click();
	await page.locator('#ndsNewCassette').click();
	await page.locator('#ndsNewCassetteCreate').click();
	await page.locator('#ndsNewCassetteDialog').waitFor({ state: 'hidden' });
	await until(() => savedSounds.isDisabled(), Boolean, 'New Cassette should have no user sound');
	await importFiles(page, '#ndsImportCassette', zipPath);
	await savedSounds.locator(`option[value="${presetPath}"]`).waitFor({ state: 'attached' });
	await savedSounds.selectOption(presetPath);
	await sampleRange.waitFor();
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

async function checkReferenceFiles(page, fixture, name) {
	await page.reload();
	await importFiles(page, '#loadTwoSfFolder', fixture);
	const imported = await until(() => tracks(page), entries => entries.length === 2, 'Expected both songs in the imported reference set');
	const left = imported.find(({ label }) => /left-a4/i.test(label));
	assert(left, 'The imported set has a left-A4 track');
	const select = page.locator('#songSelect'), play = page.locator('#play'), stop = page.locator('#stop');
	await select.selectOption(left.value);
	assert.equal(await page.locator('#ndsAutoApply').isChecked(), false, 'Saving a song should work in manual-save mode');
	await page.locator('#saveTwoSfSong').click();
	await until(() => page.locator('#status').textContent(), value => /Saved song to Files/i.test(value), 'The 2SF song and its library should be saved');
	assert.equal(await select.inputValue(), left.value, 'Saving must preserve the session song selection');
	assert.equal((await output(page)).contexts, 0, 'Saving a reference must not start audio');

	async function playSavedSong() {
		const [{ value }] = await until(() => tracks(page),
			entries => entries.length === 1 && entries[0].value.startsWith('/2sf/') && /left-a4/i.test(entries[0].label),
			'Only the saved song should be listed after re-opening the workspace');
		await select.selectOption(value);
		await play.click();
		await measureSide(page, 0, 440);
		await stop.click();
	}

	await page.reload();
	assert.equal((await output(page)).contexts, 0, 'Reloading saved reference files must not start audio');
	await playSavedSong();

	const zipPath = path.join(fixture, `${name}-2sf.cassette.zip`);
	await page.locator('#menu').click();
	const downloaded = page.waitForEvent('download');
	await page.locator('#ndsExportCassette').click();
	await (await downloaded).saveAs(zipPath);
	const { unzipSync } = await import('../../docs/playground/vendor/fflate.js');
	const entries = unzipSync(await fs.readFile(zipPath));
	const sourcePaths = Object.keys(entries).filter(file => /^2sf\/.*\.(2sf|mini2sf|2sflib)$/i.test(file));
	assert.deepEqual(sourcePaths.map(file => path.posix.basename(file)).sort(), ['demo.2sflib', 'left-a4.mini2sf']);
	assert.equal(path.posix.dirname(sourcePaths[0]), path.posix.dirname(sourcePaths[1]), 'Keep the library next to its dependent song');
	for (const file of sourcePaths) {
		assert.deepEqual(Buffer.from(entries[file]), await fs.readFile(path.join(fixture, path.posix.basename(file))),
			`The Cassette must preserve the original bytes of ${file}`);
	}

	await page.locator('#menu').click();
	await page.locator('#ndsNewCassette').click();
	await page.locator('#ndsNewCassetteCreate').click();
	await page.locator('#ndsNewCassetteDialog').waitFor({ state: 'hidden' });
	await until(() => tracks(page), entries => entries.length === 0, 'New Cassette should clear the saved reference list');
	const contexts = (await output(page)).contexts;
	await importFiles(page, '#ndsImportCassette', zipPath);
	await until(() => tracks(page), entries => entries.length === 1, 'The imported Cassette should restore its reference');
	assert.equal((await output(page)).contexts, contexts, 'Importing a Cassette must not start reference audio');
	assert(await stop.isDisabled(), 'Reference playback should remain stopped after import');
	await playSavedSong();
	return 'selected source and exact shared library bytes saved in manual mode, restored after reload and Cassette import, measured 440 Hz';
}

async function checkSoundCapture(page) {
	await page.reload();
	const mode = page.locator('#ndsMode');
	const master = page.locator('#master');
	const status = page.locator('#ndsCaptureStatus');
	const record = page.locator('#ndsCaptureRecord');
	const load = page.locator('#ndsCaptureLoad');
	const lengthWords = 4096;
	const requestedRate = 16000;
	const period = Math.round(16756991 / requestedRate);
	const sampleRate = 16756991 / period;
	const setMaster = (value) => master.evaluate((input, value) => {
		input.value = value;
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}, value);
	const quiet = () => until(() => output(page), ({ channels }) => channels.length === 2 &&
		channels.every(({ peak }) => peak < 1e-7), 'Master zero should silence the Synth output');

	await channelButton(page, 0).click(); // CH1 does not share Capture 0's CH2 timer.
	await mode.selectOption('pcm16');
	await page.locator('#ndsShape').selectOption('sine');
	await page.locator('#ndsPan').evaluate(input => {
		input.value = '0';
		input.dispatchEvent(new Event('input', { bubbles: true }));
	});
	await page.locator('#ndsSoundCapture > summary').click();
	await page.locator('#ndsCaptureUnit').selectOption('0');
	await page.locator('#ndsCaptureFormat').selectOption('pcm16');
	await page.locator('#ndsCaptureRate').fill(String(requestedRate));
	await page.locator('#ndsCaptureWords').fill(String(lengthWords));
	await record.focus();
	const initialMaster = await master.inputValue();
	await holdC4(page, async () => {
		await measureSide(page, 0, 261.626);
		await setMaster('0');
		await quiet();
		await record.click();
		await until(() => status.textContent(), text => /^Captured ·/.test(text), 'Capture 0 should complete at Master zero');
		assert(await page.locator('#ndsCaptureStop').isDisabled());
		await quiet();
	});
	await load.click();
	await until(() => status.textContent(), text => /^Loaded Capture 0/.test(text), 'The captured sample should load into the editor');
	await page.locator('#ndsSampleRangeFields').waitFor();
	assert.equal(await mode.inputValue(), 'pcm16');
	assert.equal(await page.locator('#ndsSampleRoot').inputValue(), '60');
	assert.equal(await page.locator('#ndsSampleStart').inputValue(), '0');
	assert.equal(await page.locator('#ndsSampleEnd').inputValue(), String(lengthWords * 2));
	assert.equal(await page.locator('#ndsLoop').isChecked(), false);
	const rateLabel = await page.evaluate(rate => `${rate.toLocaleString()} Hz`, sampleRate);
	assert((await page.locator('#ndsSampleInfo').textContent()).includes(rateLabel), 'The editor should keep the timer-derived rate');
	await setMaster(initialMaster);
	await holdC4(page, () => measureSide(page, 0, 261.626));

	await page.locator('#synthInputCodeTab').click();
	const files = page.locator('#ndsFilesPanel');
	if (!(await files.isVisible())) await page.locator('#ndsFilesToggle').click();
	const index = files.locator('button[data-file-path="/index.js"]');
	await index.click();
	const editor = page.locator('#synthCodeEditor');
	await until(() => editor.inputValue(), Boolean, 'The index file should be open before running the capture script');
	await editor.fill(`const nds = await useSoundChip("nds");
const timer = ${65536 - period};
await nds.noteOn(CH1, "C4", { mode: "pcm16", shape: "sine", loop: true, pan: 0 });
await nds.startCapture(0, { format: "pcm16", lengthWords: 256, timer });
await nds.startCapture(1, { format: "pcm8", lengthWords: 32768, timer });
for (let i = 0; i < 30; i++) {
  if (!(await nds.getCaptureState(0)).active && (await nds.getCaptureState(1)).byteLength >= 4) break;
  await sleep(0.02);
}
const stopped = await nds.stopCapture(1);
const left = await nds.readCapture(0);
const right = await nds.readCapture(1);
const leftSignal = left.bytes.some(byte => byte !== 0);
const rightSignal = right.bytes.some(byte => byte !== 0);
if (left.timerChannel !== CH2 || right.timerChannel !== CH4 || left.timer !== timer || right.timer !== timer ||
    left.active || left.format !== "pcm16" || left.recordedFrames !== 512 || left.byteLength !== 1024 ||
    left.bytes.length !== 1024 || !leftSignal || stopped.active || right.active || right.format !== "pcm8" ||
    right.bytes.length === 0 || right.bytes.length >= 32768 * 4 || right.bytes.length !== right.byteLength || rightSignal) {
  throw new Error("Unexpected DS capture data: " + JSON.stringify({
    left: { ...left, bytes: left.bytes.length, signal: leftSignal },
    right: { ...right, bytes: right.bytes.length, signal: rightSignal },
  }));
}
await nds.noteOff(CH1);
console.log("DS capture units verified");`);
	if (!(await page.locator('#ndsAutoApply').isChecked())) {
		await index.getByLabel('Unsaved changes').waitFor();
		await editor.press('Control+s');
		await index.getByLabel('Unsaved changes').waitFor({ state: 'hidden' });
	}
	await page.locator('#synthCodeRunButton').click();
	try {
		const code = await until(() => page.evaluate(() => ({
			log: document.getElementById('synthCodeLog').textContent,
			error: document.getElementById('synthCodeError').textContent,
		})), value => value.log.includes('DS capture units verified') || Boolean(value.error.trim()), 'Code should read both capture units');
		assert(code.log.includes('DS capture units verified'), code.error);
	} finally { await page.locator('#synthCodeStopButton').click(); }
	return 'PCM16 recorded before Master, loaded and replayed at C4; Code verified both units and stopped an unfinished PCM8 take';
}

async function checkFixedTimer(page) {
	await page.reload();
	const mode = page.locator('#ndsMode'), tracking = page.locator('#ndsKeyTracking'), hz = page.locator('#ndsTimerHz');
	const rateLabel = page.locator('#ndsTimerRateLabel'), timerValue = page.locator('#ndsTimerValue');
	const setRate = async (value) => {
		await hz.fill(String(value));
		await hz.press('Enter');
	};
	const timerCode = (rate, steps = 1) => (65536 - Math.round(16756991 / (rate * steps)))
		.toString(16).toUpperCase().padStart(4, '0');
	const panLeft = () => page.locator('#ndsPan').evaluate(input => {
		input.value = '0';
		input.dispatchEvent(new Event('input', { bubbles: true }));
	});
	await channelButton(page, 8).click(); // First channel that supports Pulse.
	assert.equal(await tracking.isChecked(), true);
	assert.match(await rateLabel.textContent(), /PCM playback rate/i);
	await mode.selectOption('pulse');
	assert.match(await rateLabel.textContent(), /Pulse frequency/i);
	await panLeft();
	await setRate(440);
	assert.equal(await tracking.isChecked(), false, 'Entering an explicit rate should select manual control');

	await page.evaluate(() => {
		const post = MessagePort.prototype.postMessage;
		const events = [];
		MessagePort.prototype.postMessage = function (message, ...options) {
			if (message?.args && /^(?:note|key)(?:On|Off)$/.test(message.method))
				events.push([message.args[0], message.method]);
			return post.call(this, message, ...options);
		};
		window.readNdsTimerEvents = channel => events.filter(([target]) => target === channel).map(([, method]) => method);
	});
	const gateEvents = channel => page.evaluate(channel => window.readNdsTimerEvents(channel), channel);
	await holdC4(page, () => measureSide(page, 0, 440));
	await until(() => output(page), ({ channels }) => channels.every(({ peak }) => peak < 1e-7), 'C4 should be released before D4');
	await page.keyboard.down('8'); // D4.
	try {
		await measureSide(page, 0, 440);
		await setRate(330);
		await measureSide(page, 0, 330);
		assert.match(await timerValue.textContent(), new RegExp(`0x${timerCode(330, 8)}`, 'i'));
		await tracking.check();
		await measureSide(page, 0, 293.665);
		assert.deepEqual(await gateEvents(8), ['noteOn', 'noteOff', 'noteOn'],
			'Changing the timer or restoring key tracking must not release or retrigger D4');
	} finally { await page.keyboard.up('8'); }

	await setRate(330);
	await page.locator('#ndsSaveSound').click();
	await page.locator('#ndsSoundName').fill('Browser fixed timer');
	await page.locator('#ndsSaveSoundCommit').click();
	await page.locator('#ndsSaveSoundDialog').waitFor({ state: 'hidden' });
	await tracking.check();
	await page.locator('#ndsSavedSounds').selectOption('/presets/Browser fixed timer.nds.json');
	await until(() => tracking.isChecked(), checked => !checked, 'Loading the saved sound should restore its manual rate');
	await holdC4(page, () => measureSide(page, 0, 330));

	await channelButton(page, 14).click();
	await mode.selectOption('noise');
	assert.match(await rateLabel.textContent(), /Noise clock/i);
	assert.equal(await tracking.isChecked(), true);
	await panLeft();
	const noteStatus = page.locator('#ndsNoteStatus');
	const noiseTimer = (note, rate) => until(() => noteStatus.textContent(),
		text => text.includes(`${note} · CH 15 · Timer 0x${timerCode(rate)}`), `Expected ${rate} Hz noise clock from ${note}`);
	const viewport = page.viewportSize();
	const timerLayout = () => page.evaluate(() => {
		const timer = document.querySelector('.nds-timer-fields').getBoundingClientRect();
		const keyboard = document.getElementById('synthInputSection').getBoundingClientRect();
		return { timerHeight: timer.height, keyboardTop: keyboard.top + scrollY };
	});
	for (const width of [375, 720, 1200]) {
		await page.setViewportSize({ width, height: viewport.height });
		const idle = await timerLayout();
		await holdC4(page, async () => {
			await noiseTimer('C4', 4000);
			await until(() => timerValue.textContent(), value => value.includes(`0x${timerCode(4000)}`), 'Held key tracking rate should be visible');
			assert.deepEqual(await timerLayout(), idle, `Key tracking must not shift the keyboard at ${width}px`);
		});
	}
	await page.setViewportSize(viewport);
	for (const [key, note, midi] of [['z', 'E2', 40], ['x', 'F2', 41]]) {
		await page.keyboard.down(key);
		try { await noiseTimer(note, 4000 * 2 ** ((midi - 60) / 12)); }
		finally { await page.keyboard.up(key); }
	}
	const slider = page.locator('#ndsTimerSlider'), divider = page.locator('#ndsDivider');
	await slider.scrollIntoViewIfNeeded();
	await until(() => output(page), ({ channels }) => channels.every(({ peak }) => peak < 1e-7), 'The low test notes should be released before C4');
	const measureNoise = async (matches, description) => {
		const { channels } = await until(() => output(page), ({ channels }) => channels[0] && matches(channels[0]), description);
		return channels[0];
	};
	await holdC4(page, async () => {
		await noiseTimer('C4', 4000);
		const gates = await gateEvents(14);
		const initial = await measureNoise(({ peak, pitch }) => peak > .01 && pitch > 100, 'C4 noise should sound before editing');
		const { x, y, width, height } = await slider.boundingBox();
		await page.mouse.move(x + width * .25, y + height / 2);
		await page.mouse.down();
		try { await page.mouse.move(x + width * .39, y + height / 2, { steps: 8 }); }
		finally { await page.mouse.up(); }
		assert.equal(await tracking.isChecked(), false, 'Dragging should select manual rate control');
		assert.match(await timerValue.textContent(), /Hz · 0x[\da-f]{4}/i);
		await measureNoise(({ peak, pitch }) => peak > .01 && pitch > initial.pitch * 2,
			'Dragging the noise clock should speed up its audible transitions while the key stays down');
		await divider.locator('[data-divider="2"]').click();
		await measureNoise(({ peak }) => peak > initial.peak * .22 && peak < initial.peak * .28,
			'Dividing by 4 should reduce held noise amplitude to one quarter');
		await divider.locator('[data-divider="0"]').click();
		await measureNoise(({ peak }) => peak > initial.peak * .96 && peak < initial.peak * 1.04,
			'Dividing by 1 should restore held noise amplitude');
		await tracking.check();
		await noiseTimer('C4', 4000);
		assert.deepEqual(await gateEvents(14), gates, 'Live clock and divider edits must preserve the held noise voice');
	});
	await setRate(4000);
	await divider.locator('[data-divider="0"]').focus();
	await page.keyboard.down('8');
	try { await noiseTimer('D4', 4000); }
	finally { await page.keyboard.up('8'); }

	await channelButton(page, 0).click();
	await mode.selectOption('pcm16');
	assert.match(await rateLabel.textContent(), /PCM playback rate/i);
	await panLeft();
	await setRate(14080); // 64 frames × 220 Hz for the built-in PCM cycle.
	await holdC4(page, () => measureSide(page, 0, 220));
	return 'Manual Pulse and PCM rates, saved timer round trip, stable key-tracking layout, distinct low Noise keys, and pointer clock/divider edits without retriggering';
}

async function checkMixer(page, fixture) {
	await page.reload();
	const checkPeak = (peak, label) => until(() => output(page), ({ channels }) =>
		channels[0] && Math.abs(channels[0].peak - peak) < .025 * peak, label);
	const checkSilence = label => until(() => output(page), ({ channels }) =>
		channels.length === 2 && channels.every(({ peak }) => peak < 1e-7), label);
	const master = page.locator('#master'), level = page.locator('#ndsOutputLevel');
	const balance = page.locator('#ndsOutputBalance'), mute = page.locator('#ndsOutputMute');
	await channelButton(page, 0).click();
	await page.locator('#ndsPan').fill('0');
	await page.locator('#ndsMixerTab').click();
	const panel = page.locator('#ndsMixerPanel');
	await panel.waitFor();
	assert.equal(await panel.locator('.nds-mix-output').count(), 1, 'Mixer should have one DS stereo output');
	assert.equal(await panel.locator('.nds-mix-channel, #ndsReferenceMix').count(), 0, 'Individual CH and 2SF volume controls should be gone from Mixer');
	assert(await master.isVisible(), 'Master should stay available in Mixer');
	await level.fill('50');
	assert.equal((await output(page)).contexts, 0, 'Mix edits should wait for the normal audio gesture');
	await holdC4(page, async () => {
		const [half] = await measureSide(page, 0, 261.626);
		await level.fill('100');
		await checkPeak(2 * half.peak, 'DS Level should update held notes and apply on initial audio creation');
		await balance.fill('50');
		await checkPeak(half.peak, 'DS Balance should attenuate the held note on the left');
		await balance.fill('0');
		await mute.click();
		await checkSilence('Muting DS should silence the held note');
		await mute.click();
		await checkPeak(2 * half.peak, 'Unmuting should resume the held sound');
		await master.fill('35');
		await checkPeak(half.peak, 'Master and DS Level should multiply for keyboard notes');
	});
	await master.fill('70');
	await importFiles(page, '#loadTwoSfFolder', fixture);
	const entry = await until(async () => (await tracks(page)).find(({ value }) => value.includes('left-a4')),
		Boolean, 'Fixture song should be available');
	await page.locator('#songSelect').selectOption(entry.value);
	await page.locator('#play').click();
	const [reference] = await measureSide(page, 0, 440);
	await level.scrollIntoViewIfNeeded();
	const { width, height } = await level.boundingBox();
	await level.click({ position: { x: width / 4, y: height / 2 } });
	const songLevel = Number(await level.inputValue());
	assert(songLevel > 30 && songLevel < 70, 'Clicking the visible DS Level slider should change its value');
	await checkPeak(reference.peak * songLevel / 100, 'The same DS Level slider should work during reference playback');
	await balance.fill('50');
	await checkPeak(reference.peak * songLevel / 200, 'DS Balance should attenuate the song on the left');
	await balance.fill('0');
	const pause = page.locator('#pause');
	await pause.click();
	const referenceOutput = (await output(page)).outputs - 1;
	const frozen = await until(() => output(page, referenceOutput), ({ contextState }) => contextState === 'suspended', 'The song clock should pause');
	await until(() => page.locator('#twoSfAuditionStatus').textContent(), value => /Keyboard ready/i.test(value),
		'The selected reference channel should be ready for audition');
	await level.fill('100');
	await holdC4(page, async () => {
		const [audition] = await measureSide(page, 0, 440, referenceOutput + 1);
		await level.fill('50');
		await checkPeak(audition.peak * .5, 'The same DS Level slider should work during paused 2SF keyboard audition');
		await balance.fill('50');
		await checkPeak(audition.peak * .25, 'DS Balance should apply to the paused audition');
		await mute.click();
		await checkSilence('Muting DS should silence the held audition');
		await mute.click();
		await checkPeak(audition.peak * .25, 'Unmuting should restore the held audition');
	});
	assert.equal((await output(page, referenceOutput)).currentTime, frozen.currentTime, 'Shared mix adjustments should keep the reference song paused');
	await page.locator('#stop').click();
	return 'One DS stereo strip controls Level, Balance and Mute for the keyboard, 2SF playback and paused audition';
}

async function checkDrawPcm(page) {
	await page.reload();
	const canvas = page.locator('#ndsSampleCanvas');
	await canvas.waitFor();
	const readWave = () => canvas.evaluate(item => item.toDataURL());
	const original = await readWave();
	await page.locator('[data-nds-wave-tool="draw"]').click();
	await canvas.scrollIntoViewIfNeeded();
	const { x, y, width, height } = await canvas.boundingBox();
	await page.mouse.move(x + width * .15, y + height * .2);
	await page.mouse.down();
	await page.mouse.move(x + width * .65, y + height * .8, { steps: 8 });
	assert.notEqual(await readWave(), original, 'A stroke should preview before it is committed');
	await page.keyboard.press('Escape');
	await page.mouse.up();
	assert.equal(await readWave(), original, 'Escape should recover the previous encoded wave');
	await page.mouse.move(x + width * .15, y + height * .2);
	await page.mouse.down();
	await page.mouse.move(x + width * .65, y + height * .8, { steps: 8 });
	await page.mouse.up();
	await page.locator('#ndsSampleRangeFields').waitFor();
	assert.notEqual(await readWave(), original, 'A finished drawing should remain as an encoded sound');
	assert.equal(await page.locator('#ndsSampleEnd').inputValue(), '64');
	assert.equal(await page.locator('#ndsSampleRoot').inputValue(), '60');
	await page.locator('#ndsMode').selectOption('adpcm');
	assert.equal(await page.locator('#ndsSampleTitle').textContent(), 'IMA-ADPCM waveform');
	assert.equal(await page.locator('#ndsSampleEnd').inputValue(), '64');
	assert(await page.locator('#ndsLoop').isChecked());
	return 'A built-in wave previews a stroke, restores on Escape, encodes on release and keeps its range on format conversion';
}

async function checkCodeChannel(page) {
	await page.reload();
	const mode = page.locator('#ndsMode'), pan = page.locator('#ndsPan'), volume = page.locator('#ndsVolume');
	const setRange = (control, value) => control.evaluate((input, next) => {
		input.value = String(next);
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}, value);
	await channelButton(page, 0).click();
	await mode.selectOption('pcm16');
	await setRange(pan, 64);
	await setRange(volume, 37);
	await page.locator('#synthWorkspaceCodeButton').click();

	const path = '/live-channel-check.js';
	await page.locator('#ndsNewJs').click();
	await page.locator('#ndsFileName').fill(path);
	await page.locator('#ndsFileNameConfirm').click();
	await page.locator('#ndsFileNameDialog').waitFor({ state: 'hidden' });
	const editor = page.locator('#synthCodeEditor');
	await until(() => editor.inputValue(), value => value.includes('Write your DS performance'), 'Code channel test file should be editable');
	await editor.fill(`const nds = await useSoundChip("nds");
await nds.noteOn(CH1, "A4", { mode: "pcm8", shape: "sine", pan: 0, volume: 80, loop: true });`);
	if (!(await page.locator('#ndsAutoApply').isChecked())) {
		const unsaved = page.locator(`#ndsFilesPanel button[data-file-path="${path}"]`).getByLabel('Unsaved changes');
		await unsaved.waitFor();
		await editor.press('Control+s');
		await unsaved.waitFor({ state: 'hidden' });
	}
	await page.locator('#synthCodeRunButton').click();
	await measureSide(page, 0, 440);
	await page.locator('#ndsChipTab').click();
	await page.locator('#ndsInstrument').waitFor();
	await until(() => page.locator('#instrumentTitle').textContent(), value => /Code.*CH\s*1/.test(value), 'Code should show the selected physical channel');
	await until(async () => [await mode.inputValue(), await volume.inputValue(), await pan.inputValue()],
		values => values.join(',') === 'pcm8,80,0', 'The Synth controls should show the live PCM8 settings from Code');
	assert.match(await page.locator('#ndsTimerValue').textContent(), /0x[\da-f]{4}/i, 'The held note should show its hardware timer');
	assert(await pan.isEnabled() && await volume.isEnabled(), 'Code CH1 should allow live Pan and Volume edits');

	await setRange(pan, 127);
	const [, initial] = await measureSide(page, 1, 440);
	await setRange(volume, 40);
	await until(() => output(page), ({ channels }) => channels[1] && Math.abs(channels[1].rms / initial.rms - .5) < .08,
		'Changing live volume should halve the level of the held Code note');
	assert.match(await page.locator('#synthCodeState').textContent(), /Running|Playing/, 'Live CH edits should leave Code running');
	const [, beforeMix] = await measureSide(page, 1, 440);
	await page.locator('#ndsMixerTab').click();
	await page.locator('#ndsOutputLevel').fill('50');
	await until(() => output(page), ({ channels }) => channels[1] && Math.abs(channels[1].peak / beforeMix.peak - .5) < .025,
		'DS Level should also control the held Code note');
	await page.locator('#synthInputCodeTab').click();
	await page.locator('#synthCodeStopButton').click();
	await until(() => output(page), ({ channels }) => channels.length === 2 && channels.every(({ peak }) => peak < 1e-7),
		'Stopping Code should release its edited channel');
	await page.locator('#ndsChipTab').click();
	await until(async () => [await mode.inputValue(), await volume.inputValue(), await pan.inputValue()],
		values => values.join(',') === 'pcm16,37,64', 'Stopping Code should restore the authored CH1 settings');
	return 'Code CH1 shows PCM8 and its hardware timer; live Pan, Volume and DS Level reach the held note, and Stop restores the authored sound';
}

async function checkHeldRange(page) {
	await page.reload();
	await channelButton(page, 0).click();
	const { encodeWav } = await import('../../docs/js/wav.js');
	const sampleRate = 48000;
	const end = page.locator('#ndsSampleEnd'), canvas = page.locator('#ndsSampleCanvas');
	for (const [mode, frames] of [['pcm8', 15360], ['pcm16', 15360], ['adpcm', 262144]]) {
		const name = `Range ${mode}`;
		const quietFrames = frames / 6;
		const wave = Float32Array.from({ length: frames }, (_, frame) =>
			frame < quietFrames ? 0 : .7 * Math.sin(frame * Math.PI * 2 / 160));
		await page.locator('#ndsMode').selectOption(mode);
		await importFiles(page, '#ndsLoadWav', {
			name: name + '.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav({ sampleRate, channels: [wave] })),
		});
		await until(() => page.locator('#ndsSampleInfo').textContent(), text => text.includes(name), `${name} should load`);
		await page.locator('#ndsLoop').check();
		await canvas.scrollIntoViewIfNeeded();
		const { x, y, width, height } = await canvas.boundingBox();
		const drag = async (ratio, check) => {
			await page.mouse.move(x + width * .99, y + height / 2);
			await page.mouse.down();
			try {
				await page.mouse.move(x + width * ratio, y + height / 2, { steps: 6 });
				await until(() => end.inputValue(), value => Number(value) <= quietFrames,
					`${mode} end marker should move into the silent lead-in`);
				await check();
			} finally { await page.mouse.up(); }
		};
		const tone = () => until(() => output(page), ({ channels }) => channels.some(({ rms }) => rms > .012),
			`${mode} held loop should sound when its range includes the tone`, 3000);
		const quiet = label => {
			let since;
			return until(() => output(page), ({ currentTime, channels }) => {
				if (channels.length !== 2 || channels.some(({ rms }) => rms >= .001)) {
					since = undefined;
					return false;
				}
				since ??= currentTime;
				// The shorter unedited loops have only 53 ms of natural silence.
				// The long ADPCM loop cannot return to its lead-in within this timeout.
				return currentTime - since >= .18;
			}, `${mode} ${label}`, 2500);
		};
		await holdC4(page, async () => {
			await tone();
			await drag(.125, async () => {
				await quiet('should apply the silent preview before pointer-up');
				await page.keyboard.press('Escape');
				assert.equal(await end.inputValue(), String(frames), 'Escape should restore the original End');
				await tone();
			});
			await drag(.125, () => quiet('should preview the new drag'));
			await quiet('should keep the narrowed loop after pointer-up');
			await end.fill(String(frames));
			await end.press('Tab');
			assert.equal(await end.inputValue(), String(frames));
			await tone();
		});
	}
	return 'PCM8, PCM16 and long IMA-ADPCM update a held loop during drag, restore it on Escape and keep the range on pointer-up';
}

const directSoundWorklet = `
import { openSkyEmuSound } from '/synth-nitro-ds/nds-skyemu-wasm.js';
registerProcessor('tetorica-test-shared-ds', class extends AudioWorkletProcessor {
	constructor({ processorOptions: { module } }) {
		super();
		this.sound = openSkyEmuSound(module);
		this.sound.upload(256, new Uint8Array(32));
		if (this.sound.prepareAdpcm(256, 32, 8) || !this.sound.prepareAdpcm(256, 32))
			throw new Error('Expected bounded ADPCM preparation across two calls.');
		const bytes = new Uint8Array(128), pcm = new DataView(bytes.buffer);
		for (let frame = 0; frame < 64; frame++)
			pcm.setInt16(frame * 2, Math.round(12000 * Math.sin(frame * Math.PI / 32)), true);
		this.sound.upload(0, bytes);
		this.sound.write(4, 0x02000000);
		this.sound.write(8, 65536 - Math.round(16756991 / (440 * 64)));
		this.sound.write(12, 32);
		this.sound.write(0, 0xa8000064);
		this.port.onmessage = () => {
			const old = this.sound.read(0);
			this.sound.write(0, (old | (127 << 16)) >>> 0);
		};
	}
	process(_inputs, [[left, right]]) {
		this.sound.render(left, right);
		return true;
	}
});
`;

async function checkSharedSoundWorklet(page) {
	await page.evaluate(async () => {
		const { loadSkyEmuModule, SKYEMU_SAMPLE_RATE } = await import('/synth-nitro-ds/nds-skyemu-wasm.js');
		const module = await loadSkyEmuModule();
		const start = document.createElement('button');
		start.id = 'playDirectSkyEmuSound';
		start.textContent = 'Start direct DS verification';
		document.body.append(start);
		start.addEventListener('click', () => {
			window.directSkyEmuReady = (async () => {
				const context = new AudioContext({ sampleRate: SKYEMU_SAMPLE_RATE });
				try {
					await Promise.all([context.resume(), context.audioWorklet.addModule('/shared-ds-worklet-test.js')]);
					const node = new AudioWorkletNode(context, 'tetorica-test-shared-ds', {
						numberOfInputs: 0, outputChannelCount: [2], processorOptions: { module },
					});
					node.connect(context.destination);
					window.directSkyEmu = { context, node };
				} catch (error) {
					await context.close();
					return error.message;
				}
				return '';
			})();
		}, { once: true });
	});
	await page.locator('#playDirectSkyEmuSound').click();
	assert.equal(await page.evaluate(() => window.directSkyEmuReady), '', 'Open the 2SF WASM in a browser AudioWorklet');
	try {
		await measureSide(page, 0, 440);
		await page.evaluate(() => window.directSkyEmu.node.port.postMessage('pan right'));
		await measureSide(page, 1, 440);
	} finally {
		await page.evaluate(() => window.directSkyEmu.context.close());
	}
	return 'The 2SF WASM runs a direct PCM note in the AudioWorklet and updates pan while held';
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
		const live = page.locator('#twoSfLiveEnabled');
		const readLive = () => readReferenceChannel(page);
		await until(() => live.isChecked(), Boolean, 'Reference Live should be enabled by default');
		assert.equal(await page.locator('#ndsChannelButtons [data-channel]:not([data-channel="-1"])').count(), 16,
			'All physical DS channels should be selectable in the shared picker');
		assert(await channelButton(page, -1).isVisible(), 'Synth can allocate channels automatically');
		assert.equal((await readLive()).visible, false, 'No channel data is shown before playback');
		await select.selectOption(fixtureChoice('left-a4'));
		await play.click();
		const left = await measureSide(page, 0, 440);
		assert.equal(await channelButton(page, -1).getAttribute('aria-pressed'), 'true', 'Starting a song should keep Auto selected');
		await channelButton(page, 0).click();
		await until(readLive, state => /Live/i.test(state.status) && fixtureChannel(state, 440, 0), 'Expected CH1 settings of the audible left-A4 song');
		await assertReferenceInstrument(page, 440, 0);
		assert(await channelButton(page, -1).isVisible(), 'Auto remains available during 2SF playback');
		assert.equal(await page.locator('#ndsSynthView, #ndsReferenceView').count(), 0, 'The shared row should be the only channel picker');
		await pause.click();
		const freeze = await until(() => output(page), (state) => state.contextState === 'suspended', 'Paused audio context expected');
		const pausedPosition = await readPosition(page);
		const frozenChannel = await until(readLive, state => /Paused/.test(state.status) && fixtureChannel(state, 440, 0), 'Reference CH1 should freeze when paused');
		await channelButton(page, 15).click();
		await until(readLive, state => state.visible && /Paused/.test(state.status) && state.active === 'Idle',
			'Selecting CH16 should show its idle state from the paused frame');
		await live.uncheck();
		await until(readLive, state => !state.visible && /Off/i.test(state.status), 'Turning Live off should hide the channel readings');
		await live.check();
		await until(readLive, state => state.visible && /Paused/.test(state.status) && state.active === 'Idle',
			'Turning Live back on should restore the paused CH16');
		await channelButton(page, 0).click();
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
		await measureSide(page, 0, 440, 0);
		assert.equal(await channelButton(page, 0).getAttribute('aria-pressed'), 'true', 'Resume should keep the selected channel');
		await holdC4(page, async () => {
			await wait(120);
			assert((await output(page, 1)).channels.every(({ peak }) => peak < 1e-7), 'A playing song channel should wait for Pause to audition');
		});
		await channelButton(page, -1).click();
		await holdC4(page, () => measureSide(page, 1, 261.626));
		await stop.click();
		await until(() => output(page, 0), (state) => state.channels.every(({ peak }) => peak < 1e-7), 'Stop should silence the output');
		await until(readLive, state => !state.visible, 'Stop should clear the previous channel observation');
		assert.equal(await channelButton(page, -1).getAttribute('aria-pressed'), 'true', 'Stop should keep Auto selected');

		await importFiles(page, '#loadTwoSfFolder', fixture);
		const restored = await until(() => tracks(page), (entries) => entries.some(({ value, label }) =>
			value.includes('right-e5') || label.includes('right-e5')), 'Original folder should be selectable again');
		await select.selectOption(restored.find(({ value, label }) => value.includes('right-e5') || label.includes('right-e5')).value);
		await play.click();
		const right = await measureSide(page, 1, 659.255, 0);
		await channelButton(page, 0).click();
		await until(readLive, state => /Live/i.test(state.status) && fixtureChannel(state, 659.255, 127), 'Reference CH1 should reflect the new right-E5 song');
		await assertReferenceInstrument(page, 659.255, 127);
		await stop.click();
		assert.equal(await channelButton(page, 0).getAttribute('aria-pressed'), 'true', 'Stop should keep a physical channel selected for the Synth');

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
		const referenceFiles = await checkReferenceFiles(page, fixture, name);
		const soundCapture = await checkSoundCapture(page);
		const fixedTimer = await checkFixedTimer(page);
		const mixer = await checkMixer(page, fixture);
		const drawPcm = await checkDrawPcm(page);
		const codeChannel = await checkCodeChannel(page);
		const heldRange = await checkHeldRange(page);
		const sharedSound = await checkSharedSoundWorklet(page);
		assert.deepEqual(errors, []);
		assert.deepEqual(fetchFailures, []);
		return { browser: name, left, right, realSongs, realAudition, synthModes, workspace, sample, referenceFiles, soundCapture, fixedTimer, mixer, drawPcm, codeChannel, heldRange, sharedSound,
			selectFocus: 'musical key sounds without changing the focused source select',
			referenceLive: 'The same channel picker and read-only Synth controls during playback and pause, PCM from the paused channel, frozen position and missing library',
			referenceAudition: 'automatic paused audition with Live on or off, frozen 440 Hz sample, C5-root transposition, idle channel silence, and authored keyboard on Auto',
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
			if (requested === '/shared-ds-worklet-test.js') return response.writeHead(200, {
				'Content-Type': 'text/javascript',
			}).end(directSoundWorklet);
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
