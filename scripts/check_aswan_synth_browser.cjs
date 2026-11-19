// SPDX-License-Identifier: BSD-3-Clause
// Actual ASWAN keyboard, Code, VGM and stereo output checks. Every physical destination is muted.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');
const { chromium, webkit } = require('playwright');

const startedAt = Date.now();
const repo = path.resolve(__dirname, '..');
const config = {
	root: path.join(repo, 'docs'),
	entry: '/synth-aswan/index.html',
	engines: 'chromium,webkit',
	out: path.join(tmpdir(), 'aswan-synth-browser.json'),
	screenshots: path.join(tmpdir(), 'aswan-synth-browser'),
};
for (const argument of process.argv.slice(2)) {
	const match = /^--(root|entry|engines|out|screenshots)=(.+)$/.exec(argument);
	assert(match, 'Unknown argument ' + argument);
	config[match[1]] = match[2];
}
config.root = path.resolve(config.root);
assert(config.entry.startsWith('/') && !/[?#]/.test(config.entry));
const engines = config.engines.split(',');
assert(engines.length && engines.every((name) => ['chromium', 'webkit'].includes(name)));
const results = [],
	missing = [],
	external = [],
	blockedMonaco = [];
const mime = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.wasm': 'application/wasm',
	'.json': 'application/json',
	'.webp': 'image/webp',
	'.txt': 'text/plain',
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function until(predicate, label, timeout = 25000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await wait(25);
	}
	throw Error('Timeout waiting for ' + label);
}

function installSilentAudit() {
	const Context = window.AudioContext ?? window.webkitAudioContext,
		Worklet = window.AudioWorkletNode;
	const connect = AudioNode.prototype.connect,
		post = MessagePort.prototype.postMessage;
	const audit = (window.__aswanAudit = {
		contexts: [],
		nodes: [],
		meters: [],
		commands: [],
		serial: 0,
		bufferEvents: [],
		bufferSerial: 0,
		highlightEvents: [],
		intervalCalls: 0,
	});
	const interval = window.setInterval;
	window.setInterval = function (...args) {
		audit.intervalCalls++;
		return interval.apply(this, args);
	};
	new MutationObserver((records) => {
		for (const record of records) {
			const element = record.target;
			if (
				!element.dataset?.liveParameter ||
				!element.classList.contains('is-live-changed') ||
				String(record.oldValue ?? '')
					.split(/\s+/)
					.includes('is-live-changed')
			)
				continue;
			audit.highlightEvents.push({
				key: element.dataset.liveParameter,
				frame: Number(document.getElementById('aswanChannelControls')?.dataset.songFrame),
				position: Number(document.getElementById('aswanSongSeek')?.value),
				origin: document.getElementById('aswanChannelControls')?.dataset.origin,
			});
		}
	}).observe(document, {
		subtree: true,
		attributes: true,
		attributeOldValue: true,
		attributeFilter: ['class'],
	});
	window.AudioContext = class extends Context {
		constructor(...args) {
			super(...args);
			audit.contexts.push(this);
		}
		createBufferSource(...args) {
			const node = super.createBufferSource(...args),
				id = ++audit.bufferSerial;
			for (const name of ['start', 'stop']) {
				const original = node[name].bind(node);
				node[name] = (...values) => {
					audit.bufferEvents.push({ method: name, id, time: this.currentTime });
					return original(...values);
				};
			}
			return node;
		}
	};
	if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
	window.AudioWorkletNode = class extends Worklet {
		constructor(context, name, ...args) {
			super(context, name, ...args);
			audit.nodes.push({ node: this, name });
		}
	};
	AudioNode.prototype.connect = function (destination, ...args) {
		if (destination !== this.context.destination)
			return connect.call(this, destination, ...args);
		const analyser = this.context.createAnalyser(),
			mute = this.context.createGain();
		analyser.fftSize = 4096;
		mute.gain.value = 0;
		connect.call(this, analyser, ...args);
		connect.call(analyser, mute);
		connect.call(mute, destination);
		audit.meters.push({ analyser, mute });
		return destination;
	};
	MessagePort.prototype.postMessage = function (data, ...args) {
		if (data?.method) audit.commands.push({ method: data.method, args: data.args });
		if (data?.method === audit.holdNextMethod) {
			audit.holdNextMethod = null;
			audit.held = { port: this, data, args };
			return;
		}

		return post.call(this, data, ...args);
	};
	audit.request = (method, args = []) =>
		new Promise((resolve, reject) => {
			const node = audit.nodes.find((item) => item.name === 'tetorica-aswan-synth')?.node;
			if (!node) return reject(Error('ASWAN Worklet missing'));
			const id = --audit.serial,
				timer = setTimeout(() => {
					node.port.removeEventListener('message', receive);
					reject(Error('ASWAN read timeout'));
				}, 5000);
			function receive({ data }) {
				if (data?.id !== id) return;
				clearTimeout(timer);
				node.port.removeEventListener('message', receive);
				data.error ? reject(Error(data.error)) : resolve(data.value);
			}
			node.port.addEventListener('message', receive);
			node.port.start();
			node.port.postMessage({ id, method, args });
		});
	audit.releaseHeld = () => {
		const held = audit.held;
		if (!held) return false;
		audit.held = null;
		post.call(held.port, held.data, ...held.args);
		return true;
	};
	audit.read = () => audit.request('read');
	audit.audition = () => {
		const token = audit.commands.filter((command) => command.method === 'loadAudition').at(-1)
			?.args?.[1]?.token;
		return token
			? audit.request('readAudition', [token]).catch(() => null)
			: Promise.resolve(null);
	};
	audit.graph = () => ({
		contexts: audit.contexts.length,
		destinations: audit.meters.length,
		muted: audit.meters.every((item) => item.mute.gain.value === 0),
		worklets: audit.nodes.map((item) => item.name),
	});
	audit.output = () => {
		const samples = new Float32Array(4096);
		audit.meters[0]?.analyser.getFloatTimeDomainData(samples);
		let square = 0,
			peak = 0,
			jump = 0;
		for (let i = 0; i < samples.length; i++) {
			square += samples[i] ** 2;
			peak = Math.max(peak, Math.abs(samples[i]));
			if (i) jump = Math.max(jump, Math.abs(samples[i] - samples[i - 1]));
		}
		return {
			finite: samples.every(Number.isFinite),
			rms: Math.sqrt(square / samples.length),
			peak,
			normalizedJump: peak ? jump / peak : 0,
		};
	};
}
async function check(browser, engine, origin, fixture) {
	const context = await browser.newContext({
		viewport: { width: 1240, height: 1100 },
		acceptDownloads: true,
	});
	const page = await context.newPage();
	page.setDefaultTimeout(20000);
	const errors = [],
		checks = [],
		measurements = {};
	let stage = 'startup';
	page.on('pageerror', (error) => errors.push(error.message));
	await page.route('**/*', (route) => {
		const url = new URL(route.request().url());
		if (url.hostname === '127.0.0.1' || url.protocol === 'blob:' || url.protocol === 'data:')
			return route.continue();
		if (/monaco|jsdelivr/.test(url.href)) blockedMonaco.push(url.href);
		else external.push(url.href);
		return route.abort();
	});
	await page.addInitScript(installSilentAudit);
	const state = () => page.evaluate(() => __aswanAudit.read()),
		graph = () => page.evaluate(() => __aswanAudit.graph());
	const step = (label) => {
		stage = label;
		console.log('CHECK ' + engine + ': ' + label);
	};
	const choose = (id, value) =>
		page.click(`[data-choice-for="${id}"][data-choice-value="${value}"]`);
	const channel = (value) => page.click(`#aswanChannelTabs [data-channel="${value}"]`);
	async function key(note = 'C4') {
		await page.evaluate(() => document.activeElement?.blur());
		const letter = await page
			.locator('#keyboard .key')
			.filter({ hasText: new RegExp('\\b' + note + '\\b') })
			.first()
			.getAttribute('data-key');
		assert(letter);
		await page.keyboard.down(letter);
		await until(
			async () =>
				(await state()).voices.some((voice) => voice.kind !== 'code' && !voice.released),
			'held keyboard voice',
		);
		return letter;
	}
	const audition = () => page.evaluate(() => __aswanAudit.audition());
	async function previewKey(note = 'C4') {
		await page.evaluate(() => document.activeElement?.blur());
		const letter = await page
			.locator('#keyboard .key')
			.filter({ hasText: new RegExp('\\b' + note + '\\b') })
			.first()
			.getAttribute('data-key');
		assert(letter);
		await page.keyboard.down(letter);
		await until(async () => {
			const state = await audition();
			return state?.voices.some((voice) => !voice.released);
		}, 'paused independent voice held');
		return letter;
	}
	async function releasePreview(letter) {
		await page.keyboard.up(letter);
		await until(async () => {
			const state = await audition();
			return !state || !state.voices.some((voice) => !voice.released);
		}, 'paused independent voice released');
		await output(false);
	}
	async function release(letter) {
		await page.keyboard.up(letter);
		await until(
			async () =>
				!(await state()).voices.some((voice) => voice.kind !== 'code' && !voice.released),
			'keyboard released',
		);
		await wait(100);
	}
	async function output(sounding = true) {
		let result;
		await until(
			async () => {
				result = await page.evaluate(() => __aswanAudit.output());
				return result.finite && (sounding ? result.rms > 1e-5 : result.peak < 1e-7);
			},
			sounding ? 'nonzero actual output' : 'silent output',
		);
		return result;
	}
	async function importVgm(name, bytes) {
		if (!(await page.locator('#synthMenu').evaluate((node) => node.open)))
			await page.click('#synthMenuButton');
		const pending = page.waitForEvent('filechooser');
		await page.click('#loadVgm');
		await (
			await pending
		).setFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
		await until(
			() =>
				page
					.locator('#vgmStatus')
					.textContent()
					.then((text) => /Current instrument kept/.test(text)),
			'VGM import complete',
		);
	}
	async function checkLiveHighlights() {
		const events = () => page.evaluate(() => __aswanAudit.highlightEvents.slice());
		const clearEvents = () =>
			page.evaluate(() => {
				__aswanAudit.highlightEvents.length = 0;
			});
		const active = () => page.locator('[data-live-parameter].is-live-changed').count();
		const eventFor = async (key) => (await events()).find((event) => event.key === key);
		const at = (seconds) =>
			until(
				() =>
					page
						.locator('#aswanSongSeek')
						.inputValue()
						.then((value) => Number(value) >= seconds),
				'highlight reference reaches ' + seconds,
			);
		async function toggle(enabled) {
			const popup = page.locator('#aswanChannelControls details.spu-code-help');
			if (!(await popup.evaluate((node) => node.open)))
				await popup.locator('summary').click();
			if (enabled) await page.check('#aswanHighlightEnabled');
			else await page.uncheck('#aswanHighlightEnabled');
			assert.notEqual(
				await page.evaluate(() => document.activeElement?.id),
				'aswanHighlightEnabled',
			);
			assert.equal(await active(), 0, 'toggle clears prior pulses immediately');
			await popup.locator('summary').click();
		}
		step('heard VGM controls highlight only changed fields; Off, Pause and frozen Live rebase');
		const authored = (await state()).preset;
		await importVgm('highlight.vgm', fixture.highlight);
		await page.selectOption('#aswanSongSelect', '/vgm/highlight.vgm');
		await channel(0);
		await clearEvents();
		await page.click('#aswanSongPlayButton', { delay: 120 });
		await until(
			() =>
				page
					.locator('#aswanChannelControls')
					.getAttribute('data-origin')
					.then((value) => value === 'vgm'),
			'new highlight reference baseline',
		);
		await at(0.65);
		assert.deepEqual(await events(), [], 'initial observed controls do not all flash');
		await until(() => eventFor('volumeLeft'), 'left-only VGM volume pulse');
		let seen = await events();
		assert(
			seen.every((event) => event.key === 'volumeLeft'),
			'unchanged right and Wave stay quiet',
		);
		assert(
			seen.every((event) => event.frame >= 1.2 * 44100),
			'rendered-ahead future change never flashes early',
		);
		await until(() => eventFor('wave'), 'actual VGM Wave RAM pulse');
		assert((await eventFor('wave')).frame >= 1.8 * 44100);
		await until(() => eventFor('volumeRight'), 'right-only VGM volume pulse');
		assert((await eventFor('volumeRight')).frame >= 2.4 * 44100);
		await channel(2);
		assert.equal(
			await active(),
			0,
			'CH selection clears old pulses without flashing its baseline',
		);
		await clearEvents();
		await until(() => eventFor('sweepStep'), 'selected CH3 hardware Sweep step pulse');
		assert((await events()).every((event) => event.key === 'sweepStep'));
		await until(() => eventFor('sweepTime'), 'selected CH3 hardware Sweep time pulse');
		await channel(3);
		assert.equal(await active(), 0);
		await clearEvents();
		await until(() => eventFor('noiseType'), 'selected CH4 Noise feedback pulse');
		assert((await events()).every((event) => event.key === 'noiseType'));
		await page.click('#aswanSongPlayButton', { delay: 120 });
		assert.equal(await page.locator('#aswanSongPlayer').getAttribute('data-state'), 'paused');
		assert.equal(await active(), 0, 'Pause immediately clears animated controls');
		await clearEvents();
		await choose('noiseType', '4');
		await wait(160);
		assert.deepEqual(await events(), [], 'paused/manual preview edits are not live automation');
		await page.click('#aswanSongPlayButton', { delay: 120 });
		await channel(0);
		await clearEvents();
		const intervalCount = await page.evaluate(() => __aswanAudit.intervalCalls);
		const stopsBefore = await page.evaluate(
			() => __aswanAudit.bufferEvents.filter((event) => event.method === 'stop').length,
		);
		await toggle(false);
		await at(5.15);
		assert.deepEqual(
			await events(),
			[],
			'Off performs no pulses while registers keep changing',
		);
		assert.equal(
			await page.evaluate(() => __aswanAudit.intervalCalls),
			intervalCount,
			'toggle adds no polling interval',
		);
		await toggle(true);
		assert.deepEqual(
			await events(),
			[],
			'On establishes a current baseline instead of replaying missed changes',
		);
		await until(() => eventFor('volumeLeft'), 'new VGM change pulses after re-enabling');
		assert((await eventFor('volumeLeft')).frame >= 5.5 * 44100);
		await page.uncheck('#aswanLiveEnabled');
		assert.equal(await active(), 0, 'frozen Auto update clears pulses');
		await clearEvents();
		await at(6.75);
		assert.deepEqual(
			await events(),
			[],
			'frozen observation does not follow hidden driver updates',
		);
		await page.check('#aswanLiveEnabled');
		assert.equal(
			await active(),
			0,
			'unfreeze rebases instead of flashing changed frozen fields',
		);
		await channel('auto');
		assert.equal(await active(), 0);
		assert.equal(await page.locator('#aswanSongPlayer').getAttribute('data-state'), 'playing');
		assert.equal(
			await page.evaluate(
				() => __aswanAudit.bufferEvents.filter((event) => event.method === 'stop').length,
			),
			stopsBefore,
			'display settings never cancel reference buffers',
		);
		await page.click('#aswanSongStopButton');
		assert.equal(await active(), 0);
		assert.deepEqual(
			(await state()).preset,
			authored,
			'highlight and reference observation never replace Auto',
		);
		checks.push(
			'Heard VGM Wave/stereo/Sweep/Noise changes pulse only their existing controls; initial/CH/Pause/Resume/Off/On/frozen/Auto/Stop baselines stay quiet, with no new polling interval or buffer cancellation',
		);

		step(
			'Code register changes highlight through the same controls and display preference persists',
		);
		await channel(0);
		if (!(await page.locator('#aswanFilesPanel').isVisible()))
			await page.click('#aswanFilesToggle');
		await page.click('#aswanFilesPanel button[data-file-path="/index.js"]');
		await page.click('#synthInputCodeTab');
		await until(
			() => page.locator('#synthCodeRunButton').isEnabled(),
			'selected runnable index.js',
		);
		await page
			.locator('#synthCodeEditor')
			.fill(
				'const ws = await useSoundChip("wonderswan");\nsetBpm(120);\nawait ws.setVolume(CH1, 15, 15);\nawait ws.setFrequency(CH1, 220);\nawait ws.keyOn(CH1);\nliveLoop("highlight", async () => {\n await beat(1); await ws.writeRegister(0x88, 0xef);\n await beat(1); await ws.writeRegister(0x88, 0xcf);\n});\n',
			);
		await clearEvents();
		await page.click('#synthCodeRunButton');
		await until(async () => (await state()).codeActive, 'Code highlight source runs');
		await until(
			async () =>
				(await events()).some(
					(event) => event.origin === 'code' && event.key === 'volumeLeft',
				),
			'raw Code register change reaches the existing highlighted field',
		);
		seen = (await events()).filter((event) => event.origin === 'code');
		assert(
			seen.every((event) => event.key === 'volumeLeft'),
			'new Code baseline does not flash unchanged source/right/Wave fields',
		);
		await page.click('#synthInputKeyboardTab');
		assert((await state()).codeActive, 'view tab does not stop the highlighted performance');
		await toggle(false);
		await clearEvents();
		await wait(650);
		assert.deepEqual(await events(), [], 'Code does not pulse while highlight Off');
		assert((await state()).codeActive);
		await page.click('#synthInputCodeTab');
		await page.click('#synthCodeStopButton');
		await until(async () => !(await state()).codeActive, 'Code stops normally');
		assert.equal(await active(), 0);
		for (const fresh of [false, true]) {
			const siblingContext = fresh ? await browser.newContext() : context;
			const sibling = await siblingContext.newPage();
			try {
				await sibling.addInitScript(installSilentAudit);
				await sibling.route('**/*', (route) =>
					new URL(route.request().url()).origin === origin
						? route.continue()
						: route.abort(),
				);
				await sibling.goto(origin + config.entry);
				await sibling.locator('#aswanHighlightEnabled').waitFor({ state: 'attached' });
				assert.equal(
					await sibling.locator('#aswanHighlightEnabled').isChecked(),
					fresh,
					fresh ? 'fresh storage defaults On' : 'Off survives a same-origin new page',
				);
				assert.equal(
					await sibling.evaluate(() => __aswanAudit.graph().contexts),
					0,
					'preference restoration does not start audio',
				);
			} finally {
				await sibling.close();
				if (fresh) await siblingContext.close();
			}
		}
		checks.push(
			'Raw Code stereo-register changes share the Live highlight fields without restarting Code; Off stays silent, releases keyboard focus, persists per origin and fresh storage defaults On',
		);
	}
	try {
		step('passive startup, four physical channels and wave edits keep a held note');
		await page.goto(origin + config.entry);
		await until(
			() =>
				page
					.locator('#aswanFilesPanel')
					.getAttribute('aria-busy')
					.then((value) => value === 'false'),
			'Files ready',
		);
		assert.equal((await graph()).contexts, 0);
		assert(await page.locator('#aswanHighlightEnabled').isChecked(), 'highlight defaults On');
		assert.equal(await page.locator('#aswanChannelTabs button').count(), 5);
		await choose('source', 'noise');
		assert.equal((await graph()).contexts, 0);
		await choose('source', 'wave');
		await page.evaluate(() => {
			__aswanAudit.holdNextMethod = 'setPitch';
			const input = document.getElementById('pitchBend');
			input.value = '.5';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await page.click('#startAudio');
		await until(
			() => page.evaluate(() => Boolean(__aswanAudit.held)),
			'cold-start Pitch ACK deliberately held',
		);
		await page.evaluate(() => {
			const input = document.getElementById('pitchBend');
			input.value = '2';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		assert.equal(Number(await page.locator('#pitchBend').inputValue()), 2);
		await page.evaluate(() => __aswanAudit.releaseHeld());
		await until(
			() =>
				page
					.locator('#startAudio')
					.textContent()
					.then((value) => value === 'Audio ready'),
			'cold startup publishes only the reconciled audio',
		);
		assert.equal(
			(await state()).pitch,
			2,
			'newer authored Pitch replaces the delayed startup ACK',
		);
		assert.equal(Number(await page.locator('#pitchBend').inputValue()), 2);
		await page.evaluate(() => {
			const input = document.getElementById('pitchBend');
			input.value = '0';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await until(
			async () => (await state()).pitch === 0,
			'baseline Pitch restored after causal startup test',
		);
		checks.push(
			'Cold-start delayed Pitch ACK cannot overwrite a newer UI bend: startup reconciles .5→+2 before publishing audio, then baseline reset works',
		);

		await until(async () => {
			try {
				return (await state()).initialized;
			} catch {
				return false;
			}
		}, 'native audio ready');
		let letter = await key();
		await wait(150);
		measurements.sine = await output();
		const before = await state(),
			owner = before.voices.find((voice) => !voice.released);
		await page.click('[data-shape="square"]');
		await until(async () => {
			const now = await state();
			return (
				now.voices.some((voice) => voice.id === owner.id && !voice.released) &&
				now.channels[owner.channel].preset.wave[0] === 15
			);
		}, 'held native PCM updated');
		await wait(150);
		measurements.square = await output();
		assert(
			measurements.square.normalizedJump > measurements.sine.normalizedJump * 2,
			'actual held timbre changes from Sine to Square',
		);
		await release(letter);
		await output(false);
		await channel(1);
		await page.click('[data-shape="saw"]');
		await page.click('[data-stepper-for="volumeLeft"][data-stepper-delta="-1"]');
		await until(
			async () => (await state()).channels[1].preset.left === 8,
			'physical left edit',
		);
		assert.equal((await state()).preset.left, 9);
		assert.deepEqual(
			(await state()).preset.wave,
			before.preset.wave.map((_, i) => (i < 16 ? 15 : 0)),
		);
		await channel('auto');
		assert.equal(await page.locator('#volumeLeft').getAttribute('aria-valuenow'), '9');
		checks.push(
			'No audio before Enable; all four channels share one chip, held drawing/shape edits reach native RAM and physical edits preserve Auto',
		);

		step('hardware Noise/Sweep and software-fed unsigned PCM use their real physical channels');
		await choose('source', 'noise');
		letter = await key();
		let now = await state();
		assert.equal(now.voices.find((voice) => !voice.released).channel, 3);
		assert.equal(now.registers[16] & 0x88, 0x88);
		await output();
		await release(letter);
		await choose('source', 'wave');
		await page.check('#sweepEnabled');
		await page.click('[data-stepper-for="sweepStep"][data-stepper-delta="1"]');
		letter = await key();
		now = await state();
		assert.equal(now.voices.find((voice) => !voice.released).channel, 2);
		assert(now.registers[16] & 64);
		await output();
		await release(letter);
		await page.uncheck('#sweepEnabled');
		await choose('source', 'pcm');
		letter = await key();
		now = await state();
		assert.equal(now.voices.find((voice) => !voice.released).channel, 1);
		assert(now.registers[16] & 32);
		measurements.pcm = await output();
		await release(letter);
		checks.push(
			'Noise uses CH4, hardware Sweep uses CH3 and unsigned software-fed Voice PCM uses CH2, with real finite nonzero output',
		);

		step('Code and manual edits share the chip across tabs and preset selection');
		await choose('source', 'wave');
		await page.click('#synthInputCodeTab');
		await page.locator('#synthCodeEditor').waitFor({ state: 'visible' });
		await page
			.locator('#synthCodeEditor')
			.fill(
				'const ws = await useSoundChip("wonderswan");\nsetBpm(120);\nliveLoop("hold",async()=>{await ws.noteOn(CH1,"E3");await beat(4);await ws.noteOff(CH1);await beat(.1);});\n',
			);
		const beforeTyping = await page.evaluate(
			() => __aswanAudit.commands.filter((command) => command.method === 'noteOn').length,
		);
		await page.locator('#synthCodeEditor').focus();
		await page.keyboard.press('End');
		await page.keyboard.type('// text input stays in the editor\n');
		assert.equal(
			await page.evaluate(
				() => __aswanAudit.commands.filter((command) => command.method === 'noteOn').length,
			),
			beforeTyping,
		);
		await page.click('#synthCodeRunButton');
		await until(async () => (await state()).codeActive, 'Code active');
		await output();
		await page.click('#synthInputKeyboardTab');
		assert((await state()).codeActive);
		await page.click('[data-shape="triangle"]');
		await until(
			async () => (await state()).channels[0].preset.wave[0] === 0,
			'Code sound edited',
		);
		assert((await state()).codeActive);
		await page.click('#aswanSaveSoundAs');
		await until(
			() =>
				page
					.locator('#aswanPresetSelect option')
					.count()
					.then((count) => count > 1),
			'saved preset',
		);
		const presetPath = await page
			.locator('#aswanPresetSelect option')
			.nth(1)
			.getAttribute('value');
		await page.selectOption('#aswanPresetSelect', presetPath);
		assert((await state()).codeActive, 'preset selection keeps Code');
		await page.click('#synthInputCodeTab');
		await page.evaluate(() => document.activeElement?.blur());
		letter = await key('C4');
		assert((await state()).codeActive);
		await release(letter);
		await page.click('#synthCodeStopButton');
		await until(async () => !(await state()).codeActive, 'Code stopped');
		await output(false);
		checks.push(
			'Code keeps running across Keyboard/Code tabs, live shape edits and Files preset selection; keyboard still works outside the Code editor',
		);

		step('VGM import, reference playback, physical Live and mixer share the same host');
		const authored = (await state()).preset;
		await importVgm('original.vgm', fixture.a);
		assert.deepEqual((await state()).preset, authored);
		assert((await page.locator('#aswanSongSelect option').count()) > 1);
		assert((await page.locator('#aswanPresetSelect option').count()) > 2);
		await page.click('#aswanSongPlayButton', { delay: 120 });
		await until(
			() =>
				page
					.locator('#aswanSongPlayer')
					.getAttribute('data-state')
					.then((value) => value === 'playing'),
			'song playing',
		);
		await output();
		await channel(0);
		await until(
			() =>
				page
					.locator('#aswanChannelStatus')
					.textContent()
					.then((text) => /VGM CH1/.test(text)),
			'Live CH1',
		);
		assert(
			!(await page.locator('[data-shape="square"]').isDisabled()),
			'playing selected Wave allows hardware edits',
		);
		const position = await page.locator('#aswanSongSeek').inputValue();
		await page.click('#aswanSongPlayButton', { delay: 120 });
		await until(
			() =>
				page
					.locator('#aswanSongPlayer')
					.getAttribute('data-state')
					.then((value) => value === 'paused'),
			'song paused',
		);
		await output(false);
		let frozen = await page.locator('#aswanSongSeek').inputValue();
		await wait(150);
		assert.equal(await page.locator('#aswanSongSeek').inputValue(), frozen);
		step('queued paused edits do not revive after CH1→CH2→CH1');
		const revisionBeforeAba = Number(
			await page.locator('#aswanChannelControls').getAttribute('data-manual-revision'),
		);
		await channel('auto');
		await page.evaluate(() => {
			__aswanAudit.holdNextMethod = 'setPitch';
			const input = document.getElementById('pitchBend');
			input.value = '.25';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await until(
			() => page.evaluate(() => Boolean(__aswanAudit.held)),
			'native command deliberately held before root queue',
		);
		await channel(0);
		await page.click('[data-stepper-for="volumeLeft"][data-stepper-delta="-1"]');
		await channel(1);
		await channel(0);
		await page.click('[data-shape="triangle"]');
		await page.evaluate(() => __aswanAudit.releaseHeld());
		await until(
			async () =>
				Number(
					await page
						.locator('#aswanChannelControls')
						.getAttribute('data-manual-revision'),
				) >=
				revisionBeforeAba + 1,
			'current-generation wave edit drains the queued work',
		);
		assert.equal(
			Number(
				await page.locator('#aswanChannelControls').getAttribute('data-manual-revision'),
			),
			revisionBeforeAba + 1,
			'only the fresh edit writes, not the stale pre-ABA volume',
		);
		assert.equal(
			await page.locator('#volumeLeft').getAttribute('aria-valuenow'),
			'15',
			'stale queued volume remains uncommitted',
		);
		checks.push(
			'Holding a native ACK then switching CH1→CH2→CH1 cancels the stale queued hardware edit; a fresh edit still commits exactly once',
		);
		step(
			'paused selected-channel keyboard and same-voice parameter edits preserve Auto and song position',
		);
		assert(
			!(await page.locator('[data-shape="saw"]').isDisabled()),
			'eligible paused Wave is editable',
		);
		const authorBeforePreview = await state();
		const baseFrequency = Number(
			(await page.locator('#aswanChannelStatus').textContent()).match(
				/(?:base|=) ([0-9.]+) Hz/,
			)?.[1],
		);
		assert(baseFrequency > 0);
		letter = await previewKey('C4');
		let preview = await audition();
		const firstToken = preview.audition.token;
		assert.equal(preview.audition.channel, 0);
		assert(
			Math.abs(preview.channels[0].frequency - baseFrequency) < baseFrequency * 0.005,
			'C4 uses the frozen hardware frequency',
		);
		assert.equal(
			(await state()).voices.length,
			0,
			'paused keys do not start the author instrument',
		);
		await output();
		const revisionBefore = Number(
			await page.locator('#aswanChannelControls').getAttribute('data-manual-revision'),
		);
		await page.click('[data-shape="saw"]');
		await until(async () => {
			const value = await audition();
			return value?.channels[0].preset.wave[0] === 0;
		}, 'held preview Wave RAM edited');
		assert.equal(
			(await audition()).audition.token,
			firstToken,
			'same target edit keeps the preview lease',
		);
		assert(
			(await audition()).voices.some((voice) => !voice.released),
			'same target edit keeps the held key',
		);
		await page.click('[data-stepper-for="volumeLeft"][data-stepper-delta="-1"]');
		await until(async () => {
			const value = await audition();
			return value?.preset.left === 14;
		}, 'paused hardware volume edit reaches preview');
		assert(
			Number(
				await page.locator('#aswanChannelControls').getAttribute('data-manual-revision'),
			) > revisionBefore,
			'song receives the sparse hardware edit',
		);
		const hardwareRevision = Number(
			await page.locator('#aswanChannelControls').getAttribute('data-manual-revision'),
		);
		assert(
			await page.locator('#envelopeEnabled').isChecked(),
			'paused preview enables its own software release',
		);
		await page.uncheck('#envelopeEnabled');
		await until(
			async () => !(await audition())?.preset.envelope.enabled,
			'preview-only envelope edit',
		);
		assert.equal(
			Number(
				await page.locator('#aswanChannelControls').getAttribute('data-manual-revision'),
			),
			hardwareRevision,
			'software Envelope does not create a VGM hardware write',
		);
		await page.check('#envelopeEnabled');
		await until(
			async () => (await audition())?.preset.envelope.enabled,
			'preview Envelope restored',
		);
		assert.deepEqual(
			(await state()).preset,
			authorBeforePreview.preset,
			'selected song edit keeps Auto',
		);
		assert.equal(await page.locator('#aswanSongSeek').inputValue(), frozen);
		await releasePreview(letter);
		await channel(1);
		await channel(0);
		assert.equal(
			await page.locator('#volumeLeft').getAttribute('aria-valuenow'),
			'14',
			'paused CH edits survive switching',
		);
		letter = await previewKey('C4');
		preview = await audition();
		assert.notEqual(preview.audition.token, firstToken);
		assert.equal(preview.preset.left, 14);
		assert.equal(preview.preset.wave[0], 0);
		await page.selectOption('#aswanReferenceKey', '72');
		await until(
			async () => !(await audition()),
			'reference change retires the old held preview',
		);
		await page.keyboard.up(letter);
		await output(false);
		letter = await previewKey('C4');
		preview = await audition();
		assert.equal(preview.audition.referenceMidi, 72);
		assert(
			Math.abs(preview.channels[0].frequency - baseFrequency / 2) < baseFrequency * 0.005,
			'C4 is one octave below the chosen Reference C5',
		);
		await releasePreview(letter);
		await page.selectOption('#aswanReferenceKey', '60');
		letter = await previewKey('C4');

		await channel(1);
		await until(
			async () => !(await audition()),
			'changing the selected CH retires the old audition',
		);
		await page.keyboard.up(letter);
		await output(false);
		await channel(0);
		letter = await previewKey('C4');
		await output();
		await page.click('#aswanSongPlayButton', { delay: 120 });
		await until(
			() =>
				page
					.locator('#aswanSongPlayer')
					.getAttribute('data-state')
					.then((value) => value === 'playing'),
			'Resume retires the audition',
		);
		await until(async () => !(await audition()), 'no audition survives Resume');
		await page.keyboard.up(letter);
		await output();
		await page.click('#aswanSongPlayButton', { delay: 120 });
		await until(
			() =>
				page
					.locator('#aswanSongPlayer')
					.getAttribute('data-state')
					.then((value) => value === 'paused'),
			'edited song pauses again',
		);
		assert.equal(
			await page.locator('#volumeLeft').getAttribute('aria-valuenow'),
			'14',
			'resumed native song retains edits until a driver write',
		);
		await output(false);
		frozen = await page.locator('#aswanSongSeek').inputValue();
		checks.push(
			'Paused C4 auditions selected physical CH on an independent handle in the same Worklet; held edits retain its token, sparse song edits survive CH switching/Resume, Auto is unchanged and Resume retires preview',
		);
		await importVgm('original-b.vgm', fixture.b);
		assert.equal(await page.locator('#aswanSongPlayer').getAttribute('data-state'), 'paused');
		assert.equal(await page.locator('#aswanSongSeek').inputValue(), frozen);
		await page.selectOption('#aswanSongSelect', '/vgm/original-b.vgm');
		assert(
			await page.locator('#aswanSongSeek').isDisabled(),
			'new song cannot seek the previous paused machine',
		);
		assert.equal(await page.locator('#aswanSongPlayButton').textContent(), 'Play');
		assert.equal(await page.locator('#aswanSongPlayer').getAttribute('data-state'), 'stopped');
		await page.click('#aswanSongPlayButton', { delay: 120 });
		await until(
			() =>
				page
					.locator('#aswanSongPlayer')
					.getAttribute('data-state')
					.then((value) => value === 'playing'),
			'song B starts, without resuming A',
		);
		await channel(0);
		await until(
			() =>
				page
					.locator('#aswanChannelStatus')
					.textContent()
					.then((text) => /VGM CH1.*Gate Off/.test(text)),
			'song B CH1 is off',
		);
		await channel(1);
		await until(
			() =>
				page
					.locator('#aswanChannelStatus')
					.textContent()
					.then((text) => /VGM CH2.*Gate On/.test(text)),
			'song B physical CH2 is on',
		);
		await page.click('#aswanSongPlayButton', { delay: 120 });
		await until(
			() =>
				page
					.locator('#aswanSongPlayer')
					.getAttribute('data-state')
					.then((value) => value === 'paused'),
			'song B pauses',
		);
		await page.locator('#aswanSongSeek').evaluate((input) => {
			input.value = '0.75';
			input.dispatchEvent(new Event('change', { bubbles: true }));
		});
		await until(
			async () =>
				(await page.locator('#aswanSongPlayer').getAttribute('data-state')) === 'paused' &&
				Number(await page.locator('#aswanSongSeek').inputValue()) >= 0.749 &&
				!(await page.locator('#aswanSongSeek').isDisabled()),
			'native song B seek finished while paused',
		);
		await until(
			() =>
				page
					.locator('#aswanChannelStatus')
					.textContent()
					.then((text) => /Paused · CH2 keyboard audition/.test(text)),
			'Live follows the seeked source',
		);
		letter = await previewKey('C4');
		preview = await audition();
		assert.equal(preview.audition.channel, 1);
		assert(
			Math.abs(preview.channels[1].frequency - 330) < 3,
			'seeked B audition uses its physical CH2 frequency',
		);
		await releasePreview(letter);
		frozen = await page.locator('#aswanSongSeek').inputValue();
		checks.push(
			'Selecting song B from paused A clears A: Seek stays disabled until B Play, then native paused Seek and physical Live use B',
		);
		await page.click('#aswanCaptureButton');
		await until(
			() =>
				page
					.locator('#aswanChannelAutoTab')
					.getAttribute('aria-selected')
					.then((value) => value === 'true'),
			'copied to Auto',
		);
		assert.equal(await page.locator('#aswanSongSeek').inputValue(), frozen);
		letter = await key();
		await output();
		await release(letter);
		await page.click('#aswanSongPlayButton', { delay: 120 });
		await until(
			() =>
				page
					.locator('#aswanSongPlayer')
					.getAttribute('data-state')
					.then((value) => value === 'playing'),
			'song resumed',
		);
		await until(
			() =>
				page
					.locator('#aswanSongSeek')
					.inputValue()
					.then((value) => Number(value) > Number(frozen)),
			'song position advances',
		);
		await page.click('#aswanMixerTab');
		for (let i = 0; i < 4; i++) await page.click(`[data-mix-channel="${i}"]`);
		await wait(150);
		await output(false);
		for (let i = 0; i < 4; i++) await page.click(`[data-mix-channel="${i}"]`);
		assert.equal(await page.locator('#aswanSongPlayer').getAttribute('data-state'),'playing','mute/unmute probe must finish before the test song ends');
		await output();
		await page.click('#aswanSongStopButton');
		await until(
			() =>
				page
					.locator('#aswanSongPlayer')
					.getAttribute('data-state')
					.then((value) => value === 'stopped'),
			'song stopped',
		);
		await output(false);
		await page.click('#aswanChipTab');
		checks.push(
			'VGM import preserves authored sound and saves source/presets; shared-context playback, Pause/Resume, playing hardware Live editing, paused audition/editing, Copy to Auto and per-channel mute work',
		);
		step(
			'playing keys and hardware edits share the selected song CH without restarting buffers',
		);
		await channel('auto');
		await page.evaluate(() => {
			const input = document.getElementById('pitchBend');
			input.value = '2';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await until(async () => (await state()).pitch === 2, 'persistent authored Pitch set to +2');
		assert.equal(Number(await page.locator('#pitchBend').inputValue()), 2);
		await importVgm('manual-live.vgm', fixture.manual);
		await page.selectOption('#aswanSongSelect', '/vgm/manual-live.vgm');
		await channel(0);
		await page.click('#aswanSongPlayButton', { delay: 120 });
		await until(
			() =>
				page
					.locator('#aswanSongPlayer')
					.getAttribute('data-state')
					.then((value) => value === 'playing'),
			'manual reference playing',
		);
		await until(
			() =>
				page
					.locator('#aswanChannelControls')
					.getAttribute('data-playing-editable')
					.then((value) => value === 'true'),
			'playing controls editable',
		);
		assert(
			await page.locator('#envelopeEnabled').isDisabled(),
			'software Envelope does not become a song envelope',
		);
		assert(
			!(await page.locator('#aswanReferenceControl').isVisible()),
			'playing keys use ordinary MIDI rather than paused Reference mapping',
		);
		assert.equal(
			Number(await page.locator('#pitchBend').inputValue()),
			0,
			'reference keyboard starts with its own zero bend',
		);
		assert.equal((await state()).pitch, 2, 'entering reference preserves authored native bend');
		const unchangedAuthor = (await state()).preset;
		const baselineLoads = await page.evaluate(
			() =>
				__aswanAudit.commands.filter((command) => command.method === 'loadAudition').length,
		);
		const referenceSquare = await page
			.locator('#waveCanvas')
			.evaluate((canvas) => canvas.toDataURL());
		const sourceStops = await page.evaluate(
			() => __aswanAudit.bufferEvents.filter((event) => event.method === 'stop').length,
		);
		await page.evaluate(() => {
			const audit = __aswanAudit,
				transport = document.getElementById('aswanSongPlayer');
			audit.playStates = [transport.dataset.state];
			audit.playPositions = [];
			audit.playObserver = new MutationObserver(() =>
				audit.playStates.push(transport.dataset.state),
			);
			audit.playObserver.observe(transport, {
				attributes: true,
				attributeFilter: ['data-state'],
			});
			audit.playTimer = setInterval(
				() =>
					audit.playPositions.push(
						Number(document.getElementById('aswanSongSeek').value),
					),
				10,
			);
		});
		async function playingKey(note) {
			await page.evaluate(() => document.activeElement?.blur());
			const letter = await page
				.locator('#keyboard .key')
				.filter({ hasText: new RegExp('\\b' + note + '\\b') })
				.first()
				.getAttribute('data-key');
			assert(letter);
			await page.keyboard.down(letter);
			await until(
				() =>
					page
						.locator('#aswanChannelControls')
						.getAttribute('data-song-key-owner')
						.then((value) => Boolean(value)),
				'playing manual keyboard gate',
			);
			return letter;
		}
		letter = await playingKey('D4');
		const firstLiveOwner = await page
			.locator('#aswanChannelControls')
			.getAttribute('data-song-key-owner');
		await until(
			() =>
				page
					.locator('#aswanChannelControls')
					.getAttribute('data-song-frequency')
					.then((value) => Math.abs(Number(value) - 293.6648) < 3),
			'ordinary MIDI D4 in actual song',
		);
		assert.equal(
			(await state()).voices.length,
			0,
			'playing key never starts the primary author instrument',
		);
		await page.click('[data-shape="saw"]');
		await page.click('[data-stepper-for="volumeLeft"][data-stepper-delta="-1"]');
		await page.click('[data-stepper-for="volumeRight"][data-stepper-delta="-1"]');
		await until(
			() =>
				page
					.locator('#volumeRight')
					.getAttribute('aria-valuenow')
					.then((value) => value === '14'),
			'playing stereo edit visible',
		);
		assert.equal(
			await page.locator('#aswanChannelControls').getAttribute('data-song-key-owner'),
			firstLiveOwner,
			'Wave/stereo edits preserve the held gate owner',
		);
		const manualSaw = await page
			.locator('#waveCanvas')
			.evaluate((canvas) => canvas.toDataURL());
		assert.notEqual(manualSaw, referenceSquare);
		await page.uncheck('#aswanLiveEnabled');
		const frozenLiveFrame = await page
			.locator('#aswanChannelControls')
			.getAttribute('data-song-frame');
		const frozenLiveFrequency = await page
			.locator('#aswanChannelControls')
			.getAttribute('data-song-frequency');
		await page.click('[data-stepper-for="volumeLeft"][data-stepper-delta="-1"]');
		await until(
			() =>
				page
					.locator('#volumeLeft')
					.getAttribute('aria-valuenow')
					.then((value) => value === '13'),
			'explicit edit updates frozen field',
		);
		assert.equal(
			await page.locator('#aswanChannelControls').getAttribute('data-song-frame'),
			frozenLiveFrame,
			'manual edit does not replace the frozen snapshot',
		);
		await until(
			() =>
				page
					.locator('#aswanSongSeek')
					.inputValue()
					.then((value) => Number(value) >= 3.65),
			'driver control overwrites manual gate during continuous playback',
		);
		await until(
			() =>
				page
					.locator('#aswanChannelControls')
					.getAttribute('data-song-key-owner')
					.then((value) => !value),
			'driver control took the gate owner',
		);
		assert.equal(
			await page.locator('#aswanChannelControls').getAttribute('data-song-frequency'),
			frozenLiveFrequency,
			'Auto update Off keeps untargeted frozen pitch',
		);
		assert.equal(
			await page.locator('#waveCanvas').evaluate((canvas) => canvas.toDataURL()),
			manualSaw,
			'driver Wave RAM does not secretly unfreeze display',
		);
		assert.equal(await page.locator('#volumeLeft').getAttribute('aria-valuenow'), '13');
		await page.keyboard.up(letter);
		await page.check('#aswanLiveEnabled');
		await until(
			() =>
				page
					.locator('#volumeLeft')
					.getAttribute('aria-valuenow')
					.then((value) => value === '15'),
			'driver volume visible after unfreeze',
		);
		await until(
			() =>
				page
					.locator('#aswanChannelControls')
					.getAttribute('data-song-frequency')
					.then((value) => Math.abs(Number(value) - 440) < 3),
			'driver pitch visible after unfreeze',
		);
		assert.equal(
			await page.locator('#aswanChannelControls').getAttribute('data-song-gate'),
			'true',
			'old keyboard KeyUp cannot cut the new driver gate',
		);
		assert.equal(
			await page.locator('#waveCanvas').evaluate((canvas) => canvas.toDataURL()),
			referenceSquare,
		);
		await output();
		const firstLetter = await playingKey('C4');
		const earlierOwner = await page
			.locator('#aswanChannelControls')
			.getAttribute('data-song-key-owner');
		const secondLetter = await playingKey('D4');
		await until(
			() =>
				page
					.locator('#aswanChannelControls')
					.getAttribute('data-song-key-owner')
					.then((value) => value && value !== earlierOwner),
			'new human key steals the same selected CH',
		);
		const latestOwner = await page
			.locator('#aswanChannelControls')
			.getAttribute('data-song-key-owner');
		await page.keyboard.up(firstLetter);
		assert.equal(
			await page.locator('#aswanChannelControls').getAttribute('data-song-key-owner'),
			latestOwner,
			'old human KeyUp cannot release the replacement',
		);
		await page.keyboard.up(secondLetter);
		await until(
			() =>
				page
					.locator('#aswanChannelControls')
					.getAttribute('data-song-gate')
					.then((value) => value === 'false'),
			'current manual KeyUp releases only its gate',
		);
		const continuity = await page.evaluate(() => {
			const audit = __aswanAudit;
			clearInterval(audit.playTimer);
			audit.playObserver.disconnect();
			return {
				states: audit.playStates,
				positions: audit.playPositions,
				stops: audit.bufferEvents.filter((event) => event.method === 'stop').length,
			};
		});
		assert(
			continuity.states.every((value) => value === 'playing'),
			'no edit or key pauses/stops/restarts the transport',
		);
		assert(
			continuity.positions.length > 10 &&
				continuity.positions.at(-1) > continuity.positions[0],
		);
		assert(
			continuity.positions.every(
				(value, index, array) => !index || value >= array[index - 1],
			),
			'song clock remains monotonic',
		);
		assert.equal(
			continuity.stops,
			sourceStops,
			'manual input never cancels scheduled AudioBufferSources',
		);
		assert.deepEqual(
			(await state()).preset,
			unchangedAuthor,
			'live song manipulation keeps Auto unchanged',
		);
		assert.equal(
			await page.evaluate(
				() =>
					__aswanAudit.commands.filter((command) => command.method === 'loadAudition')
						.length,
			),
			baselineLoads,
			'playing does not load a private preview',
		);
		await channel('auto');
		assert.equal(
			Number(await page.locator('#pitchBend').inputValue()),
			2,
			'returning Auto restores authored Pitch UI',
		);
		assert.equal((await state()).pitch, 2, 'returning Auto matches its unchanged native bend');
		await channel(0);
		assert.equal(
			Number(await page.locator('#pitchBend').inputValue()),
			0,
			'returning reference restores manual zero bend',
		);
		assert.equal((await state()).pitch, 2);

		await page.click('#aswanSongPlayButton', { delay: 120 });
		await until(
			() =>
				page
					.locator('#aswanSongPlayer')
					.getAttribute('data-state')
					.then((value) => value === 'paused'),
			'manual song pauses normally',
		);
		letter = await previewKey('C4');
		assert.equal((await audition()).audition.channel, 0);
		await output();
		await releasePreview(letter);
		await page.click('#aswanSongStopButton');
		checks.push(
			'Playing Wave/stereo edits and same-CH keys keep monotonic clock and scheduled buffers; frozen fields stay frozen, driver writes win, stale KeyUps are harmless, Auto sound/bend unchanged and Pause still auditions privately',
		);
		step('queued key highlight clears when a driver makes the target PCM before its NoteOn');
		await importVgm('pcm-transition.vgm', fixture.pcmTransition);
		await page.selectOption('#aswanSongSelect', '/vgm/pcm-transition.vgm');
		await channel('auto');
		await page.click('#aswanSongPlayButton', { delay: 120 });
		await until(
			() =>
				page
					.locator('#aswanSongPlayer')
					.getAttribute('data-state')
					.then((value) => value === 'playing'),
			'queued-key reference starts',
		);
		// Freeze the renderer while selecting/pressing the key. UI round trips
		// must not race the fixture's driver write on a slower Linux runner.
		await page.evaluate(async()=>{await __aswanAudit.contexts[0].suspend();});
		await page.evaluate(() => {
			__aswanAudit.holdNextMethod = 'setPitch';
			const input = document.getElementById('pitchBend');
			input.value = '1';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await until(
			() => page.evaluate(() => Boolean(__aswanAudit.held)),
			'primary ACK blocks the queued live key',
		);
		await channel(1);
		await page.evaluate(() => document.activeElement?.blur());
		const pendingKey = page
				.locator('#keyboard .key')
				.filter({ hasText: /\bD4\b/ })
				.first(),
			pendingLetter = await pendingKey.getAttribute('data-key');
		assert(pendingLetter);
		await page.keyboard.down(pendingLetter);
		await until(
			() => pendingKey.evaluate((node) => node.classList.contains('is-active')),
			'pending key lights before the mode transition',
		);
		await page.evaluate(async()=>{await __aswanAudit.contexts[0].resume();});
		await until(
			() =>
				page
					.locator('#voiceCapacity')
					.textContent()
					.then((value) => /Voice PCM/.test(value)),
			'driver changes the still-queued target to transient PCM',
		);
		await page.evaluate(() => __aswanAudit.releaseHeld());
		await until(
			() => pendingKey.evaluate((node) => !node.classList.contains('is-active')),
			'invalidated pending key clears without KeyUp',
		);
		assert.equal(
			await page.locator('#aswanChannelControls').getAttribute('data-song-key-owner'),
			'',
		);
		assert.equal((await state()).voices.length, 0);
		assert.equal(await page.locator('#aswanSongPlayer').getAttribute('data-state'), 'playing');
		await page.keyboard.up(pendingLetter);
		await page.click('#aswanSongStopButton');
		checks.push(
			'A driver Wave→PCM transition while native ACK holds a queued key skips its NoteOn and clears the pending highlight before KeyUp, without stopping playback',
		);
		step('paused hardware Sweep and Noise audition; transient DAC snapshots stay unavailable');
		async function pauseFixture(name, bytes, ch) {
			await importVgm(name, bytes);
			await page.selectOption('#aswanSongSelect', '/vgm/' + name);
			await page.click('#aswanSongPlayButton', { delay: 120 });
			await until(
				() =>
					page
						.locator('#aswanSongPlayer')
						.getAttribute('data-state')
						.then((value) => value === 'playing'),
				'extra source starts',
			);
			await channel(ch);
			if (name === 'sweep.vgm' || name === 'noise.vgm') {
				const startsAt = Number(await page.locator('#aswanSongSeek').inputValue());
				const stopsBefore = await page.evaluate(
					() =>
						__aswanAudit.bufferEvents.filter((event) => event.method === 'stop').length,
				);
				const liveLetter = await playingKey('D4');
				const ownerBefore = await page
					.locator('#aswanChannelControls')
					.getAttribute('data-song-key-owner');
				if (name === 'sweep.vgm') {
					await page.click('[data-stepper-for="sweepStep"][data-stepper-delta="1"]');
					await until(
						() =>
							page
								.locator('#sweepStep')
								.getAttribute('aria-valuenow')
								.then((value) => value === '2'),
						'playing Sweep step edit',
					);
				} else {
					await choose('noiseType', '3');
					await until(
						() =>
							page
								.locator('[data-choice-for="noiseType"][data-choice-value="3"]')
								.getAttribute('aria-checked')
								.then((value) => value === 'true'),
						'playing Noise feedback edit',
					);
				}
				await until(
					() =>
						page
							.locator('#aswanSongSeek')
							.inputValue()
							.then((value) => Number(value) > startsAt + 0.1),
					'effect edit keeps the song clock moving',
				);
				assert.equal(
					await page.locator('#aswanChannelControls').getAttribute('data-song-key-owner'),
					ownerBefore,
					'effect changes retain the current keyboard gate',
				);
				assert.equal(
					await page.locator('#aswanSongPlayer').getAttribute('data-state'),
					'playing',
				);
				assert.equal(
					await page.evaluate(
						() =>
							__aswanAudit.bufferEvents.filter((event) => event.method === 'stop')
								.length,
					),
					stopsBefore,
					'effect edit does not replace reference buffers',
				);
				await output();
				await page.keyboard.up(liveLetter);
			}
			await page.click('#aswanSongPlayButton', { delay: 120 });
			await until(
				() =>
					page
						.locator('#aswanSongPlayer')
						.getAttribute('data-state')
						.then((value) => value === 'paused'),
				'extra source pauses',
			);
			await output(false);
		}
		await pauseFixture('sweep.vgm', fixture.sweep, 2);
		letter = await previewKey();
		preview = await audition();
		assert.equal(preview.audition.channel, 2);
		assert(preview.channels[2].preset.sweep.enabled);
		assert(preview.registers[16] & 64);
		await output();
		await releasePreview(letter);
		await pauseFixture('noise.vgm', fixture.noise, 3);
		letter = await previewKey();
		preview = await audition();
		assert.equal(preview.audition.channel, 3);
		assert.equal(preview.channels[3].preset.source, 'noise');
		assert(preview.registers[16] & 128);
		await output();
		await releasePreview(letter);
		await pauseFixture('voice.vgm', fixture.voice, 1);
		assert(
			await page.locator('#aswanCaptureButton').isDisabled(),
			'transient DAC cannot be captured as a fictitious sample',
		);
		const loadsBefore = await page.evaluate(
			() =>
				__aswanAudit.commands.filter((command) => command.method === 'loadAudition').length,
		);
		await page.evaluate(() => document.activeElement?.blur());
		const unsupportedLetter = await page
			.locator('#keyboard .key')
			.filter({ hasText: /\bC4\b/ })
			.first()
			.getAttribute('data-key');
		await page.keyboard.down(unsupportedLetter);
		await wait(200);
		await page.keyboard.up(unsupportedLetter);
		assert.equal(
			await page.evaluate(
				() =>
					__aswanAudit.commands.filter((command) => command.method === 'loadAudition')
						.length,
			),
			loadsBefore,
			'no default PCM stream is substituted',
		);
		assert.equal((await state()).voices.length, 0);
		await output(false);
		await page.click('#aswanSongStopButton');
		await channel('auto');
		checks.push(
			'Frozen hardware Sweep uses CH3 and Noise uses CH4 on the private preview; transient Voice DAC state never becomes a default PCM sample or author note',
		);
		await checkLiveHighlights();
		for (const width of [1240, 390]) {
			await page.setViewportSize({ width, height: 1000 });
			await page.locator('#aswanChannelTabs').scrollIntoViewIfNeeded();
			assert(
				await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
			);
			await fs.mkdir(config.screenshots, { recursive: true });
			await page.screenshot({
				path: path.join(config.screenshots, engine + '-' + width + '.png'),
			});
		}
		assert.equal((await graph()).contexts, 1);
		assert.equal((await graph()).destinations, 1);
		assert((await graph()).muted);
		assert.deepEqual(errors, []);
		return {
			browser: engine,
			passed: true,
			checks,
			measurements,
			graph: await graph(),
			physicalOutputMuted: true,
			listeningPerformed: false,
		};
	} catch (error) {
		await fs.mkdir(config.screenshots, { recursive: true });
		await page
			.screenshot({
				path: path.join(config.screenshots, engine + '-failure.png'),
				fullPage: true,
			})
			.catch(() => {});
		error.receipt = {
			browser: engine,
			passed: false,
			stage,
			error: error.stack,
			checks,
			measurements,
			errors,
			status: await page
				.locator('#audioStatus')
				.textContent()
				.catch(() => ''),
			codeError: await page
				.locator('#synthCodeError')
				.textContent()
				.catch(() => ''),
			commands: await page.evaluate(() => __aswanAudit.commands.slice(-15)).catch(() => []),
			graph: await graph().catch(() => null),
		};
		throw error;
	} finally {
		await page.close();
		await context.close();
	}
}
const server = http.createServer(async (request, response) => {
	try {
		const pathname = new URL(request.url, 'http://localhost').pathname;
		if (pathname === '/favicon.ico') {
			response.writeHead(204).end();
			return;
		}
		const filename = path.resolve(config.root, '.' + decodeURIComponent(pathname));
		assert(filename.startsWith(config.root + path.sep));
		response.setHeader(
			'Content-Type',
			mime[path.extname(filename)] ?? 'application/octet-stream',
		);
		response.end(await fs.readFile(filename));
	} catch (error) {
		missing.push({ url: request.url, error: error.message });
		response.writeHead(404).end();
	}
});
(async () => {
	const { createWonderSwanVgm } = await import(
		pathToFileURL(path.join(repo, 'test/helpers/wonderswan_vgm_fixture.mjs'))
	);
	const { createWonderSwanManualVgm, createWonderSwanPcmTransitionVgm } = await import(
		pathToFileURL(path.join(repo, 'test/helpers/wonderswan_manual_vgm_fixture.mjs'))
	);
	const { createWonderSwanHighlightVgm } = await import(
		pathToFileURL(path.join(repo, 'test/helpers/wonderswan_highlight_vgm_fixture.mjs'))
	);
	const fixture = {
		a: createWonderSwanVgm({ seconds: 3, loop: false }),
		// Song B must outlast the Resume + eight mute-toggle browser actions.
		b: createWonderSwanVgm({ channel: 1, seconds: 30, loop: false }),
		sweep: createWonderSwanVgm({ mode: 'sweep', seconds: 3, loop: false }),
		noise: createWonderSwanVgm({ mode: 'noise', seconds: 3, loop: false }),
		voice: createWonderSwanVgm({ mode: 'voice', seconds: 3, loop: false }),
		manual: createWonderSwanManualVgm(),
		pcmTransition: createWonderSwanPcmTransitionVgm({transitionSeconds:2}),
		manualNoise: createWonderSwanManualVgm({ mode: 'noise' }),
		manualSweep: createWonderSwanManualVgm({ mode: 'sweep' }),
		highlight: createWonderSwanHighlightVgm(),
	};
	let failure = null;
	try {
		await new Promise((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', resolve);
		});
		const origin = 'http://127.0.0.1:' + server.address().port;
		for (const engine of engines) {
			const browser = await { chromium, webkit }[engine].launch({
				headless: true,
				...(engine === 'chromium' ? { args: ['--mute-audio'] } : {}),
			});
			try {
				results.push(await check(browser, engine, origin, fixture));
			} catch (error) {
				results.push(
					error.receipt ?? { browser: engine, passed: false, error: error.stack },
				);
				throw error;
			} finally {
				await browser.close();
			}
		}
		assert.deepEqual(missing, []);
		assert.deepEqual(external, []);
	} catch (error) {
		failure = error;
	} finally {
		server.closeIdleConnections?.();
		server.closeAllConnections?.();
		if (server.listening) await new Promise((resolve) => server.close(resolve));
	}
	const receipt = {
		schemaVersion: 1,
		elapsedSeconds: (Date.now() - startedAt) / 1000,
		passed: !failure,
		root: config.root,
		entry: config.entry,
		results,
		missing,
		external,
		expectedBlockedMonaco: blockedMonaco,
		physicalOutputMuted: true,
		listeningPerformed: false,
		...(failure ? { error: failure.stack } : {}),
	};
	await fs.mkdir(path.dirname(config.out), { recursive: true });
	await fs.writeFile(config.out, JSON.stringify(receipt, null, 2) + '\n');
	if (failure) throw failure;
	console.log('PASS receipt ' + config.out);
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
