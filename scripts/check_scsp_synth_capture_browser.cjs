// SPDX-License-Identifier: BSD-3-Clause
// Paused SSF keyboard audition and portable Capture checks. Every physical destination is muted.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');
const { chromium, webkit } = require('playwright');

const repo = path.resolve(__dirname, '..');
const config = {
	root: path.join(repo, 'docs'),
	entry: '/synth-scsp/index.html',
	engines: 'chromium,webkit',
	out: path.join(tmpdir(), 'scsp-synth-capture-browser.json'),
	screenshots: path.join(tmpdir(), 'scsp-synth-capture-browser'),
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
	const Context = window.AudioContext ?? window.webkitAudioContext;
	const Worklet = window.AudioWorkletNode,
		connect = AudioNode.prototype.connect;
	let delay = null,
		delayed = 0,
		ackDelay = null,
		ackDelayed = 0;
	const posted = new WeakMap();
	const contexts = [],
		worklets = [],
		meters = [],
		commands = [];
	window.AudioContext = class extends Context {
		constructor(...args) {
			super(...args);
			contexts.push(this);
		}
	};
	if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
	window.AudioWorkletNode = class extends Worklet {
		constructor(context, name, ...args) {
			super(context, name, ...args);
			worklets.push({ name, node: this });
			this.port.addEventListener('message', (event) => {
				const method = posted.get(this.port)?.get(event.data?.id);
				if (!ackDelay || method !== ackDelay.method) return;
				const milliseconds = ackDelay.milliseconds;
				ackDelay = null;
				ackDelayed++;
				event.stopImmediatePropagation();
				setTimeout(
					() =>
						this.port.dispatchEvent(new MessageEvent('message', { data: event.data })),
					milliseconds,
				);
			});
			this.port.start();
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
		meters.push({ analyser, mute });
		return destination;
	};
	const post = MessagePort.prototype.postMessage;
	MessagePort.prototype.postMessage = function (data, ...args) {
		if (data?.method) {
			commands.push({ method: data.method, args: data.args });
			let requests = posted.get(this);
			if (!requests) posted.set(this, (requests = new Map()));
			requests.set(data.id, data.method);
			if (data.method === delay?.method) {
				const milliseconds = delay.milliseconds;
				delay = null;
				delayed++;
				setTimeout(() => post.call(this, data, ...args), milliseconds);
				return;
			}
		}
		return post.call(this, data, ...args);
	};
	let sequence = 0;
	const read = (method = 'readAuthoring', args = []) =>
		new Promise((resolve, reject) => {
			const node = worklets.findLast((item) => item.name === 'tetorica-scsp-synth')?.node;
			if (!node) return reject(Error('Editor AudioWorklet missing'));
			const id = --sequence;
			const timer = setTimeout(() => {
				node.port.removeEventListener('message', receive);
				reject(Error('Editor read timed out'));
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
	window.__scspLiveAudit = {
		read,
		armDelay(method, milliseconds) {
			delay = { method, milliseconds };
		},
		delayed: () => delayed,
		armAckDelay(method, milliseconds) {
			ackDelay = { method, milliseconds };
		},
		ackDelayed: () => ackDelayed,
		commands: () => commands.slice(),
		graph: () => ({
			contexts: contexts.length,
			destinationEdges: meters.length,
			worklets: worklets.map((item) => item.name),
			muted: meters.every((item) => item.mute.gain.value === 0),
		}),
		output: () => {
			const values = meters
				.map(({ analyser }) => {
					const pcm = new Float32Array(analyser.fftSize);
					analyser.getFloatTimeDomainData(pcm);
					let square = 0,
						peak = 0;
					for (const value of pcm) {
						square += value * value;
						peak = Math.max(peak, Math.abs(value));
					}
					return {
						rms: Math.sqrt(square / pcm.length),
						peak,
						finite: pcm.every(Number.isFinite),
					};
				})
				.sort((a, b) => b.rms - a.rms);
			return {
				...(values[0] ?? { rms: 0, peak: 0, finite: true }),
				muted: meters.every((item) => item.mute.gain.value === 0),
			};
		},
	};
}
const graph = (page) => page.evaluate(() => __scspLiveAudit.graph());
const control = (page, name) => page.locator('#voice [data-chip-control="scsp-' + name + '"]');
async function pcm(page, audible = true) {
	let output;
	await until(
		async () => {
			output = await page.evaluate(() => __scspLiveAudit.output());
			return (
				output.muted &&
				output.finite &&
				(audible ? output.rms > 0.00005 : output.peak < 1e-7)
			);
		},
		audible ? 'finite final-Master PCM' : 'final-Master silence',
	);
	return output;
}
const view = (page) =>
	page.evaluate(() => {
		const section = document.getElementById('scspSsfLive'),
			voice = document.getElementById('voice');
		return {
			status: document.getElementById('status').textContent,
			song: document.getElementById('scspSongStatus').textContent,
			position: Number(document.getElementById('scspSongSeek').value),
			pause: document.getElementById('scspSongPause').textContent,
			code: document.getElementById('synthCodeState').textContent,
			liveVisible: Boolean(section && !section.hidden),
			liveActive: section?.dataset.active,
			enabled: document.getElementById('scspSsfLiveEnabled')?.checked,
			slot: document.getElementById('scspSsfSlot')?.value,
			frame: section?.dataset.frame,
			voiceSlot: voice?.dataset.ssfSlot,
			liveStatus: document.getElementById('scspSsfLiveStatus')?.textContent,
			reference: document.getElementById('scspSsfReference')?.value,
			captureStatus: document.getElementById('scspSsfCaptureStatus')?.textContent,
			captureError: document.getElementById('scspSsfCaptureStatus')?.dataset.error,
			activity: [...document.querySelectorAll('#scspSsfSlots [data-ssf-slot]')].map(
				(button) => ({
					slot: Number(button.dataset.ssfSlot),
					active: button.dataset.active,
					gate: button.dataset.gate,
					selected: button.getAttribute('aria-pressed'),
				}),
			),
		};
	});
async function canvas(page) {
	return page.locator('#voice canvas').evaluate(async (node) => {
		const bytes = node.getContext('2d').getImageData(0, 0, node.width, node.height).data;
		const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
		return [node.width, node.height, ...hash].join(',');
	});
}
async function authoring(page) {
	return page.evaluate(async () => {
		const read = await __scspLiveAudit.read();
		return JSON.stringify({ config: read.state.config, operators: read.operators });
	});
}
async function selectSlot(page, slot) {
	await page.selectOption('#scspSsfSlot', String(slot));
	await until(
		() =>
			view(page).then(
				(value) => value.slot === String(slot) && value.voiceSlot === String(slot),
			),
		'Live slot ' + slot,
	);
}
async function load(page, name, bytes) {
	if (!(await page.locator('#synthMenu').evaluate((node) => node.open)))
		await page.click('#synthMenuButton');
	const chooser = page.waitForEvent('filechooser');
	await page.click('#loadSsf');
	await (
		await chooser
	).setFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
	await until(() => page.locator('#scspSongPlay').isEnabled(), 'SSF source ready');
}

async function check(browser, engine, origin, fixture) {
	const page = await browser.newPage({
		viewport: { width: 1240, height: 1100 },
		acceptDownloads: true,
	});
	page.setDefaultTimeout(25000);
	const errors = [],
		checks = [],
		measurements = {};
	let stage = 'startup';
	page.on('pageerror', (error) => errors.push(error.message));
	await page.route('**/*', (route) => {
		const url = new URL(route.request().url());
		if (url.hostname !== '127.0.0.1') {
			(/monaco|jsdelivr/.test(url.href) ? blockedMonaco : external).push(url.href);
			return route.abort();
		}
		return route.continue();
	});
	await page.addInitScript(installSilentAudit);
	const read = () => page.evaluate(() => __scspLiveAudit.read());
	const audition = () =>
		page.evaluate(() => __scspLiveAudit.read('readAudition').catch(() => null));
	const commands = () => page.evaluate(() => __scspLiveAudit.commands());
	const step = (label) => {
		stage = label;
		console.log('CHECK ' + engine + ': ' + label);
	};
	async function paused(before) {
		const after = await view(page);
		assert.equal(after.pause, 'Resume');
		assert.equal(after.position, before.position);
		if (after.liveActive === 'true') assert.equal(after.frame, before.frame);
		return after;
	}
	async function noHeld() {
		await until(
			async () => !(await audition())?.voiceGroups.some((group) => group.held),
			'no temporary held voices',
		);
	}
	async function keyFor(note = 'C4') {
		const button = page
			.locator('#keyboard .key')
			.filter({ hasText: new RegExp('\\b' + note + '\\b') })
			.first();
		assert(await button.count(), 'onscreen ' + note + ' exists');
		const letter = await button.getAttribute('data-key');
		assert(letter);
		return letter;
	}
	async function press(note = 'C4') {
		await page.evaluate(() => document.activeElement?.blur());
		const letter = await keyFor(note);
		await page.keyboard.down(letter);
		return letter;
	}
	async function held(expected, midi = 60) {
		let current;
		await until(async () => {
			current = await audition();
			return current?.voiceGroups.some((group) => group.held);
		}, 'selected-slot keyboard preview');
		const groups = current.voiceGroups.filter((group) => group.held);
		assert.equal(groups.length, 1);
		assert.equal(groups[0].midi, midi);
		assert.equal(current.config.mode, 'pcm');
		const source = current.slots[0],
			voice = current.slots[groups[0].slots[0]];
		assert.equal(source.sample.bits, expected.bits);
		assert.equal(source.sample.length, expected.pcm.length);
		assert.equal(source.sample.sourceSampleRate, expected.options.sourceSampleRate);
		assert.equal(source.sample.loopStartSamples, expected.options.loopStartSamples ?? null);
		assert(Math.abs(source.sample.rootFrequencyHz - expected.options.baseFrequencyHz) < 1e-7);
		assert.equal(voice.frequencyHz, 440 * 2 ** ((midi - 69) / 12));
		assert.deepEqual(source.envelope, expected.voice.envelope);
		assert.deepEqual(source.lfo, expected.voice.lfo);
		for (const name of ['totalLevel', 'directLevel', 'pan'])
			assert.equal(source[name], expected.voice[name], name);
		measurements['audition' + expected.bits] = await pcm(page);
		const last = (await commands()).findLast((command) => command.method === 'loadAudition');
		assert(last, 'temporary instrument was loaded through the actual Worklet');
		assert.deepEqual(last.args[0], expected);
		return { source, voice, groups };
	}
	async function menu(id) {
		if (!(await page.locator('#synthMenu').evaluate((node) => node.open)))
			await page.click('#synthMenuButton');
		await page.click(id);
	}
	async function save() {
		const pending = page.waitForEvent('download');
		await menu('#save');
		const downloaded = await pending;
		return JSON.parse(await fs.readFile(await downloaded.path(), 'utf8'));
	}
	async function captured(expected) {
		const loaded = await read(),
			op = loaded.operators[0];
		assert.equal(loaded.state.config.mode, 'pcm');
		assert.equal(op.sample.bits, expected.bits);
		assert.equal(op.sample.length, expected.pcm.length);
		assert.equal(op.sample.loopStartSamples, expected.options.loopStartSamples ?? null);
		assert(Math.abs(op.sample.rootFrequencyHz - expected.options.baseFrequencyHz) < 1e-7);
		assert.deepEqual(Array.from(op.pcm), expected.pcm);
		assert.deepEqual(op.voice.envelope, expected.voice.envelope);
		assert.deepEqual(op.voice.lfo, expected.voice.lfo);
		for (const name of ['totalLevel', 'directLevel', 'pan'])
			assert.equal(op.voice[name], expected.voice[name], name);
		return loaded;
	}
	try {
		step('authored unapplied draft and silent SSF import');
		await page.goto(origin + config.entry);
		await until(
			() =>
				page
					.locator('#scspFilesPanel')
					.getAttribute('aria-busy')
					.then((value) => value === 'false'),
			'Files ready',
		);
		assert.equal((await graph(page)).contexts, 0);
		assert.equal(await page.locator('#scspSsfReference').inputValue(), '60');
		assert(await page.locator('#scspSsfCapture').isDisabled());
		await page.click('[data-chip-action="scsp-square"]');
		await page.click('[data-chip-action="scsp-apply"]');
		await until(
			() => page.locator('[data-chip-action="scsp-apply"]').isDisabled(),
			'square applied',
		);
		await control(page, 'attackRate').fill('19');
		await control(page, 'attackRate').dispatchEvent('change');
		const sourceCanvas = page.locator('#voice canvas');
		await sourceCanvas.scrollIntoViewIfNeeded();
		const bounds = await sourceCanvas.boundingBox();
		await page.mouse.move(bounds.x + 15, bounds.y + 20);
		await page.mouse.down();
		await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height - 20, {
			steps: 8,
		});
		await page.mouse.up();
		await control(page, 'root').fill('500');
		await control(page, 'root').dispatchEvent('change');
		const draftWave = await canvas(page);
		assert(await page.locator('[data-chip-action="scsp-apply"]').isEnabled());
		await load(page, 'capture.ssf', fixture.bytes);
		assert.equal((await graph(page)).contexts, 0);
		checks.push('Import remains silent with Capture disabled until a native snapshot exists');

		step('paused physical-slot audition leaves authored state and draft intact');
		await page.click('#scspSongPlay');
		await pcm(page);
		await until(
			() =>
				view(page).then((value) => value.liveActive === 'true' && Number(value.frame) > 0),
			'native snapshot ready',
		);
		await page.click('#scspSongPause');
		await until(() => view(page).then((value) => value.pause === 'Resume'), 'paused song');
		await pcm(page, false);
		await selectSlot(page, 0);
		await until(() => page.locator('#scspSsfCapture').isEnabled(), 'PCM16 Capture available');
		const frozen = await view(page),
			authoredBefore = await authoring(page);
		const firstKey = await press();
		const first = await held(fixture.captures[60][0].preset);
		await paused(frozen);
		assert.equal(await authoring(page), authoredBefore);
		await page.keyboard.up(firstKey);
		await noHeld();
		await selectSlot(page, 1);
		await until(() => page.locator('#scspSsfCapture').isEnabled(), 'PCM8 Capture available');
		const secondKey = await press();
		const second = await held(fixture.captures[60][1].preset);
		assert.notEqual(first.source.sample.bits, second.source.sample.bits);
		assert.notEqual(
			first.source.sample.sourceSampleRate,
			second.source.sample.sourceSampleRate,
		);
		await page.keyboard.up(secondKey);
		await noHeld();
		await pcm(page, false);
		await paused(frozen);
		assert.equal(await authoring(page), authoredBefore);
		await page.uncheck('#scspSsfLiveEnabled');
		assert.equal(await canvas(page), draftWave);
		assert.equal(await control(page, 'root').inputValue(), '500');
		assert.equal(await control(page, 'attackRate').inputValue(), '19');
		assert(await page.locator('[data-chip-action="scsp-apply"]').isEnabled());
		await page.check('#scspSsfLiveEnabled');
		checks.push(
			'PCM16 and PCM8 selected-slot auditions use distinct samples and pitch while Pause, authored state and dirty draft remain intact',
		);

		step('pending preparation keyup and slot-change cancellation');
		await selectSlot(page, 0);
		await page.selectOption('#scspSsfReference', '48');
		await page.evaluate(() => __scspLiveAudit.armDelay('loadAudition', 250));
		const pendingKey = await press();
		await until(
			() => page.evaluate(() => __scspLiveAudit.delayed() === 1),
			'preview preparation delayed',
		);
		await page.keyboard.up(pendingKey);
		await wait(400);
		await noHeld();
		await pcm(page, false);
		await page.selectOption('#scspSsfReference', '60');
		await page.evaluate(() => __scspLiveAudit.armDelay('loadAudition', 250));
		const switchedKey = await press();
		await until(
			() => page.evaluate(() => __scspLiveAudit.delayed() === 2),
			'second preparation delayed',
		);
		await selectSlot(page, 1);
		await wait(400);
		await page.keyboard.up(switchedKey);
		await noHeld();
		await pcm(page, false);
		await paused(frozen);
		assert.equal(await authoring(page), authoredBefore);
		checks.push(
			'Key release and slot changes during pending preparation cannot leave an orphan preview voice',
		);

		step('unsupported source retains authored patch and paused transport');
		await selectSlot(page, fixture.unsupportedSlot);
		await until(() => page.locator('#scspSsfCapture').isDisabled(), 'Noise Capture disabled');
		await until(
			() => view(page).then((value) => Boolean(value.captureStatus)),
			'unsupported explanation',
		);
		assert.match((await view(page)).captureStatus, /noise|source|PCM|unsupported/i);
		const unsupportedKey = await press();
		await wait(200);
		await page.keyboard.up(unsupportedKey);
		await noHeld();
		await pcm(page, false);
		await paused(frozen);
		assert.equal(await authoring(page), authoredBefore);
		checks.push(
			'Unsupported Noise has an explanation and preserves the previous authored patch and Pause',
		);

		step('reference pitch and complete PCM capture');
		await selectSlot(page, 1);
		await page.selectOption('#scspSsfReference', '48');
		await until(
			() => page.locator('#scspSsfCapture').isEnabled(),
			'reference C3 Capture available',
		);
		const referenceKey = await press('C3');
		await held(fixture.captures[48][1].preset, 48);
		await page.keyboard.up(referenceKey);
		await noHeld();
		await page.click('#scspSsfCapture');
		await until(
			() => view(page).then((value) => value.liveActive === 'false'),
			'editable captured view',
		);
		await until(() => control(page, 'attackRate').isEnabled(), 'captured controls editable');
		await captured(fixture.captures[48][1].preset);
		assert.equal((await view(page)).enabled, false);
		await page.check('#scspSsfLiveEnabled');
		await until(
			() => view(page).then((value) => value.frame === frozen.frame),
			'frozen snapshot survives Capture',
		);
		await page.uncheck('#scspSsfLiveEnabled');
		await paused(frozen);
		assert.equal(await page.locator('#voice canvas').count(), 1);
		assert.equal(await control(page, 'bits').inputValue(), '8');
		assert.equal(await control(page, 'loop').inputValue(), '8');
		checks.push(
			'Capture copies full PCM8, loop start8, reference C3, Envelope, LFO and direct mix into the editable Synth without discarding Pause',
		);

		step('saved portable preset and Files round trip');
		const saved = await save(),
			expected = fixture.captures[48][1].preset;
		assert.equal(saved.format, 'tetorica-scsp-voice');
		assert.equal(saved.mode, 'pcm');
		assert.deepEqual(saved.operators.carrier.pcm, expected.pcm);
		assert.equal(saved.operators.carrier.bits, 8);
		assert.deepEqual(saved.operators.carrier.options, expected.options);
		assert.deepEqual(saved.operators.carrier.voice, expected.voice);
		await page.click('#scspSaveSoundAs');
		await page.fill('#scspFileNameInput', 'captured-slot-2');
		await page.click('#scspFileNameConfirm');
		await until(
			() =>
				page
					.locator('#scspFilesStatus')
					.textContent()
					.then((value) => /saved|presets/i.test(value)),
			'captured preset in Files',
		);
		await page.setInputFiles('#open', {
			name: 'capture-roundtrip.json',
			mimeType: 'application/json',
			buffer: Buffer.from(JSON.stringify(saved)),
		});
		await until(
			() =>
				page
					.locator('#status')
					.textContent()
					.then((value) => /instrument loaded/i.test(value)),
			'portable preset reload',
		);
		await captured(expected);
		await paused(frozen);
		checks.push(
			'The captured sound saves through Files and portable JSON, then reloads with the same PCM and hardware settings',
		);

		step('captured keyboard, Resume, and layout');
		const regularKey = await press('C3');
		await until(async () => {
			const state = (await read()).state;
			return state.voiceGroups.some((group) => group.held && group.midi === 48);
		}, 'ordinary authored keyboard after Capture');
		measurements.capturedKeyboard = await pcm(page);
		await page.keyboard.up(regularKey);
		await page.click('#scspSongPause');
		await until(
			() =>
				view(page).then(
					(value) => value.pause === 'Pause' && value.position > frozen.position,
				),
			'Resume preserved song',
		);
		measurements.resumed = await pcm(page);
		await page.click('#scspSongPause');
		await pcm(page, false);
		for (const width of [1240, 390]) {
			await page.setViewportSize({ width, height: 1000 });
			await page.evaluate(
				() =>
					new Promise((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(resolve)),
					),
			);
			assert(
				await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
				'layout fits ' + width,
			);
			await fs.mkdir(config.screenshots, { recursive: true });
			await page.locator('#scspSsfLive').scrollIntoViewIfNeeded();
			await page.screenshot({
				path: path.join(config.screenshots, engine + '-' + width + '.png'),
			});
		}
		await page.setViewportSize({ width: 1240, height: 1100 });
		checks.push('Captured keyboard and Resume work, and controls fit 390px');

		step('Capture native commit stays truthful across Resume before its reply');
		await page.check('#scspSsfLiveEnabled');
		await selectSlot(page, 0);
		await until(
			() => page.locator('#scspSsfCapture').isEnabled(),
			'commit-race Capture available',
		);
		await wait(50);
		await page.evaluate(() => __scspLiveAudit.armAckDelay('loadPatch', 800));
		await page.click('#scspSsfCapture');
		await until(
			() => page.evaluate(() => __scspLiveAudit.ackDelayed() === 1),
			'native load committed, reply withheld',
		);
		await captured(fixture.captures[48][0].preset);
		await page.click('#scspSongPause', { delay: 5 });
		await until(
			() => view(page).then((value) => value.pause === 'Pause'),
			'Resume changed paused state before load reply',
		);
		await until(
			() => view(page).then((value) => /^Captured SSF Slot 1/.test(value.status)),
			'committed Capture reported truthfully',
		);
		assert.doesNotMatch((await view(page)).captureStatus, /cancelled|failed/i);
		await captured(fixture.captures[48][0].preset);
		await pcm(page);
		await page.click('#scspSongPause', { delay: 5 });
		await until(
			() => view(page).then((value) => value.pause === 'Resume'),
			'paused after commit race',
		);
		await pcm(page, false);
		checks.push(
			'Resume while the native load reply is pending cannot label a committed Capture as cancelled',
		);

		step('Stop before Capture commit cancels without changing the authored sound');
		await page.check('#scspSsfLiveEnabled');
		await selectSlot(page, 1);
		await until(
			() => page.locator('#scspSsfCapture').isEnabled(),
			'precommit Capture available',
		);
		await wait(50);
		const beforeCancel = await authoring(page),
			loadsBeforeCancel = (await commands()).filter(
				(command) => command.method === 'loadPatch',
			).length;
		await page.evaluate(() => __scspLiveAudit.armDelay('stopAudition', 350));
		await page.click('#scspSsfCapture');
		await until(
			() => page.evaluate(() => __scspLiveAudit.delayed() === 3),
			'precommit preparation held',
		);
		await page.click('#scspSongStop', { delay: 5 });
		await until(
			() => view(page).then((value) => /cancelled/i.test(value.captureStatus)),
			'stale precommit Capture cancelled',
		);
		assert.equal(await authoring(page), beforeCancel);
		assert.equal(
			(await commands()).filter((command) => command.method === 'loadPatch').length,
			loadsBeforeCancel,
		);
		assert.equal((await view(page)).pause, 'Pause');
		await noHeld();
		await pcm(page, false);
		checks.push('Stop during precommit preparation cancels Capture before any authored load');
		assert.equal((await graph(page)).contexts, 1);
		assert.equal((await graph(page)).destinationEdges, 1);
		assert.deepEqual(errors, []);
		checks.push(
			'All audition, capture and cancellation paths share one muted AudioContext without page errors',
		);
		return {
			browser: engine,
			passed: true,
			checks,
			measurements,
			graph: await graph(page),
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
			checks,
			measurements,
			errors,
			error: error.stack,
			view: await view(page).catch(() => null),
			graph: await graph(page).catch(() => null),
		};
		throw error;
	} finally {
		await page.close();
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
	const { createScspSsfCaptureFixture } = await import(
		pathToFileURL(path.join(repo, 'test/helpers/scsp_ssf_fixture.mjs')).href
	);
	const fixture = createScspSsfCaptureFixture();
	const { prepareScspSsfSource } = await import(
		pathToFileURL(path.join(repo, 'docs/synth-scsp/ssf_source.js'))
	);
	const { createScspSsfRenderer } = await import(
		pathToFileURL(path.join(repo, 'docs/synth-scsp/ssf_renderer.js'))
	);
	const { createScspSsfCapture } = await import(
		pathToFileURL(path.join(repo, 'docs/synth-scsp/ssf_capture.js'))
	);
	const source = await prepareScspSsfSource(fixture.files, '/ssf/capture.ssf');
	const renderer = await createScspSsfRenderer(source, {
		wasmBinary: await fs.readFile(
			path.join(config.root, 'generated/ssf-player/ssf_player.wasm'),
		),
	});
	try {
		const left = new Float32Array(4096),
			right = new Float32Array(4096);
		renderer.process(left, right, 4096);
		const snapshot = renderer.readSnapshot();
		fixture.captures = Object.fromEntries(
			[48, 60].map((referenceMidi) => [
				referenceMidi,
				[0, 1].map((slot) => createScspSsfCapture(snapshot, slot, { referenceMidi })),
			]),
		);
	} finally {
		renderer.dispose();
	}
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
		passed: !failure,
		root: config.root,
		entry: config.entry,
		physicalOutputMuted: true,
		listeningPerformed: false,
		results,
		missing,
		external,
		expectedBlockedMonaco: blockedMonaco,
		...(failure ? { error: failure.stack } : {}),
	};
	await fs.mkdir(path.dirname(path.resolve(config.out)), { recursive: true });
	await fs.writeFile(config.out, JSON.stringify(receipt, null, 2) + '\n');
	if (failure) throw failure;
	console.log('PASS receipt ' + config.out);
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
