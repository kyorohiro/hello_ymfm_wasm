// SPDX-License-Identifier: BSD-3-Clause
// Actual SSF playback and paused-audition parameter edits, with physically muted stereo PCM capture.
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
	entry: '/synth-scsp/index.html',
	engines: 'chromium,webkit',
	out: path.join(tmpdir(), 'scsp-synth-paused-edit-browser.json'),
	screenshots: path.join(tmpdir(), 'scsp-synth-paused-edit-browser'),
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
	const posted = new WeakMap(),
		pointerEvents = [];
	for (const type of ['pointerdown', 'pointerup', 'click'])
		document.addEventListener(
			type,
			(event) => {
				const button = event.target.closest?.('button');
				if (button?.id?.startsWith('scspSong'))
					pointerEvents.push({
						type,
						id: button.id,
						text: button.textContent,
						trusted: event.isTrusted,
						time: performance.now(),
					});
			},
			true,
		);
	let stereoCapture = null;
	const stereoMutes = [];
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
		meters.push({ source: this, analyser, mute });
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
	async function beginStereo() {
		if (stereoCapture) throw Error('Capture already active');
		const source = meters[0]?.source;
		if (!source) throw Error('Audio output missing');
		const name = 'scsp-paused-edit-capture-' + Math.abs(--sequence);
		const url = URL.createObjectURL(
			new Blob(
				[
					`class Capture extends AudioWorkletProcessor{constructor(){super();this.frame=0;}process(inputs){if(inputs[0]?.[0]){this.port.postMessage({frame:this.frame,left:inputs[0][0].slice(),right:(inputs[0][1]??inputs[0][0]).slice()});this.frame+=inputs[0][0].length;}return true;}}registerProcessor('${name}',Capture);`,
				],
				{ type: 'text/javascript' },
			),
		);
		try {
			await source.context.audioWorklet.addModule(url);
		} finally {
			URL.revokeObjectURL(url);
		}
		const node = new AudioWorkletNode(source.context, name, {
				numberOfInputs: 1,
				numberOfOutputs: 1,
				outputChannelCount: [1],
			}),
			mute = source.context.createGain();
		mute.gain.value = 0;
		stereoMutes.push(mute);
		const item = (stereoCapture = { source, node, mute, blocks: [] });
		node.port.onmessage = ({ data }) => {
			if (item.blocks.length < 1024) item.blocks.push(data);
		};
		connect.call(source, node);
		connect.call(node, mute);
		connect.call(mute, source.context.destination);
	}
	function finishStereo() {
		const item = stereoCapture;
		stereoCapture = null;
		if (!item) throw Error('No capture');
		item.source.disconnect(item.node);
		item.node.disconnect();
		item.mute.disconnect();
		item.node.port.close();
		const blocks = item.blocks.sort((a, b) => a.frame - b.frame);
		if (!blocks.length) throw Error('Empty capture');
		const first = blocks[0].frame,
			last = blocks.at(-1),
			length = last.frame + last.left.length - first;
		const left = new Float32Array(length),
			right = new Float32Array(length);
		let expected = first;
		for (const block of blocks) {
			if (block.frame !== expected) throw Error('Discontinuous recorder sequence');
			left.set(block.left, block.frame - first);
			right.set(block.right, block.frame - first);
			expected += block.left.length;
		}
		return {
			sampleRate: item.source.context.sampleRate,
			left: Array.from(left),
			right: Array.from(right),
		};
	}
	window.__scspLiveAudit = {
		read,
		beginStereo,
		finishStereo,
		armDelay(method, milliseconds) {
			delay = { method, milliseconds };
		},
		delayed: () => delayed,
		armAckDelay(method, milliseconds) {
			ackDelay = { method, milliseconds };
		},
		ackDelayed: () => ackDelayed,
		commands: () => commands.slice(),
		pointerEvents: () => pointerEvents.slice(),
		graph: () => ({
			contexts: contexts.length,
			destinationEdges: meters.length,
			worklets: worklets.map((item) => item.name),
			muted:
				meters.every((item) => item.mute.gain.value === 0) &&
				stereoMutes.every((mute) => mute.gain.value === 0),
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
				muted:
					meters.every((item) => item.mute.gain.value === 0) &&
					stereoMutes.every((mute) => mute.gain.value === 0),
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
			slot: document.querySelector('#scspChannelTabs [aria-selected="true"]')?.dataset
				.scspChannel,
			frame: section?.dataset.frame,
			voiceSlot: voice?.dataset.ssfSlot,
			liveStatus: document.getElementById('scspSsfLiveStatus')?.textContent,
			reference: document.getElementById('scspSsfReference')?.value,
			captureStatus: document.getElementById('scspSsfCaptureStatus')?.textContent,
			captureError: document.getElementById('scspSsfCaptureStatus')?.dataset.error,
			activity: [...document.querySelectorAll('#scspChannelTabs [data-scsp-channel]')]
				.filter((button) => button.dataset.scspChannel !== 'auto')
				.map((button) => ({
					slot: Number(button.dataset.scspChannel),
					active: button.dataset.active,
					gate: button.dataset.gate,
					selected: button.getAttribute('aria-selected'),
				})),
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
	await page.click('#scspChannelTabs [data-scsp-channel="' + slot + '"]');
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

const rms = (values) =>
	Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / Math.max(1, values.length));
function stereoStats(pcm) {
	assert(pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite));
	const energy = pcm.left.map((value, index) => Math.hypot(value, pcm.right[index]));
	const onset = energy.findIndex((value) => value > 1e-8),
		bins = [],
		window = Math.max(1, Math.round(pcm.sampleRate * 0.02));
	for (let first = 0; first + window <= energy.length; first += window)
		bins.push(rms(energy.slice(first, first + window)));
	const late = rms(energy.slice(Math.max(0, energy.length - window * 2)));
	return {
		frames: energy.length,
		left: rms(pcm.left),
		right: rms(pcm.right),
		minimumEnvelope: Math.min(...bins),
		maximumEnvelope: Math.max(...bins),
		attackRatio:
			onset < 0
				? 0
				: rms(energy.slice(onset, onset + Math.round(pcm.sampleRate * 0.006))) /
					(late || 1),
	};
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
		if (url.hostname === '127.0.0.1' || ['blob:', 'data:'].includes(url.protocol))
			return route.continue();
		(/monaco|jsdelivr/.test(url.href) ? blockedMonaco : external).push(url.href);
		return route.abort();
	});
	await page.addInitScript(installSilentAudit);
	const read = () => page.evaluate(() => __scspLiveAudit.read());
	const preview = () => page.evaluate(() => __scspLiveAudit.read('readAudition'));
	const patch = () => page.evaluate(() => __scspLiveAudit.read('exportPatch'));
	const step = (label) => {
		stage = label;
		console.log('CHECK ' + engine + ': ' + label);
	};
	async function change(name, value) {
		const field = control(page, name);
		if (typeof value === 'boolean') await field.setChecked(value);
		else if (await field.evaluate((input) => input.tagName === 'SELECT'))
			await field.selectOption(String(value));
		else {
			await field.fill(String(value));
			await field.dispatchEvent('change');
		}
	}
	async function selected(slot) {
		await page.click('#scspChannelTabs [data-scsp-channel="' + slot + '"]');
		await until(
			() =>
				view(page).then(
					(current) =>
						current.slot === String(slot) && current.voiceSlot === String(slot),
				),
			'selected SSF CH' + (slot + 1),
		);
	}
	async function capture(milliseconds) {
		await page.evaluate(() => __scspLiveAudit.beginStereo());
		await wait(milliseconds);
		return stereoStats(await page.evaluate(() => __scspLiveAudit.finishStereo()));
	}
	async function key(note = 'C4') {
		await page.evaluate(() => document.activeElement?.blur());
		const button = page
				.locator('#keyboard .key')
				.filter({ hasText: new RegExp('\\b' + note + '\\b') })
				.first(),
			letter = await button.getAttribute('data-key');
		assert(letter);
		await page.keyboard.down(letter);
		await until(
			async () => (await preview()).voiceGroups.some((group) => group.held),
			'preview key held',
		);
		return letter;
	}
	async function release(letter) {
		await page.keyboard.up(letter);
		await until(
			async () => !(await preview()).voiceGroups.some((group) => group.held),
			'preview key released',
		);
		await wait(80);
	}
	async function frozen(before) {
		const current = await view(page);
		assert.equal(current.pause, 'Resume');
		assert.equal(current.position, before.position);
		assert.equal(current.frame, before.frame);
		return current;
	}
	async function sameAuthor(expected) {
		assert.deepEqual(await patch(), expected);
	}
	async function menu(id) {
		if (!(await page.locator('#synthMenu').evaluate((node) => node.open)))
			await page.click('#synthMenuButton');
		await page.click(id);
	}
	async function saved() {
		const pending = page.waitForEvent('download');
		await menu('#save');
		return JSON.parse(await fs.readFile(await (await pending).path(), 'utf8'));
	}
	try {
		step('authored draft is independent from editable song parameters');
		await page.goto(origin + config.entry);
		await until(
			() =>
				page
					.locator('#scspFilesPanel')
					.getAttribute('aria-busy')
					.then((value) => value === 'false'),
			'Files ready',
		);
		await page.click('[data-chip-action="scsp-square"]');
		await page.click('[data-chip-action="scsp-apply"]');
		await until(
			() => page.locator('[data-chip-action="scsp-apply"]').isDisabled(),
			'authored Square applied',
		);
		await page.click('[data-chip-action="scsp-triangle"]');
		await change('root', 500);
		const authoredWave = await canvas(page);
		await load(page, 'edit.ssf', fixture.bytes);
		assert.equal((await graph(page)).contexts, 0);
		await page.click('#scspSongPlay', { delay: 5 });
		await pcm(page);
		await until(
			() => view(page).then((value) => value.liveActive === 'true'),
			'SSF Live ready',
		);
		const authoredBefore = await patch();
		await selected(1);
		await until(
			() => control(page, 'directLevel').isEnabled(),
			'playing song parameter editable',
		);
		await change('directLevel', 0);
		await selected(0);
		await change('pan', 0);
		await change('lfo-pitchDepth', 0);
		await change('lfo-amplitudeDepth', 0);
		await wait(400);
		const playingStart = await view(page),
			sourceWave = await canvas(page);
		for (const name of ['root', 'bits', 'sample', 'modulation-depth'])
			assert(await control(page, name).isDisabled(), name + ' stays source-only');
		measurements.playingCenter = await capture(120);
		assert(
			Math.abs(measurements.playingCenter.left - measurements.playingCenter.right) <
				measurements.playingCenter.right * 0.1,
		);
		await change('pan', 15);
		await wait(400);
		measurements.playingPan = await capture(120);
		assert(
			measurements.playingPan.right > measurements.playingPan.left * 30,
			'live song pan changes actual stereo output',
		);
		await change('lfo-frequencyCode', 20);
		await change('lfo-amplitudeWave', 0);
		await change('lfo-amplitudeDepth', 7);
		await wait(400);
		measurements.playingLfo = await capture(440);
		assert(
			measurements.playingLfo.maximumEnvelope > measurements.playingLfo.minimumEnvelope * 1.5,
			'live song LFO changes actual amplitude',
		);
		assert((await view(page)).position > playingStart.position);
		assert.equal((await view(page)).pause, 'Pause');
		assert.equal(await canvas(page), sourceWave);
		await sameAuthor(authoredBefore);
		checks.push(
			'Playing CH mix and LFO change real song stereo audio after lookahead while time, waveform RAM and the authored instrument are preserved',
		);

		step('paused edits update held preview mix/LFO while keeping frozen source data');
		await page.click('#scspSongPause', { delay: 120 });
		await until(() => view(page).then((value) => value.pause === 'Resume'), 'song paused');
		await pcm(page, false);
		await change('pan', 0);
		await change('lfo-amplitudeDepth', 0);
		const paused = await view(page),
			pausedWave = await canvas(page),
			playbackRate = await control(page, 'root').inputValue();
		await page.evaluate(() => __scspLiveAudit.beginStereo());
		let held = await key();
		await wait(250);
		measurements.fastAttack = stereoStats(
			await page.evaluate(() => __scspLiveAudit.finishStereo()),
		);
		await change('pan', 15);
		await until(async () => {
			const current = await preview(),
				group = current.voiceGroups.find((group) => group.held);
			return group && current.slots[group.slots[0]].pan === 15;
		}, 'held preview pan committed');
		measurements.pausedPan = await capture(120);
		assert(measurements.pausedPan.right > measurements.pausedPan.left * 30);
		await change('lfo-amplitudeDepth', 7);
		await until(async () => {
			const current = await preview(),
				group = current.voiceGroups.find((group) => group.held);
			return group && current.slots[group.slots[0]].lfo.amplitudeDepth === 7;
		}, 'held preview LFO committed');
		measurements.pausedLfo = await capture(440);
		assert(
			measurements.pausedLfo.maximumEnvelope > measurements.pausedLfo.minimumEnvelope * 1.5,
		);
		await change('lfo-amplitudeDepth', 0);
		await change('attackRate', 18);
		const changed = await preview(),
			oldGroup = changed.voiceGroups.find((group) => group.held);
		assert.equal(changed.slots[0].envelope.attackRate, 18);
		assert.equal(
			changed.slots[oldGroup.slots[0]].envelope.attackRate,
			31,
			'held EG is not restarted',
		);
		await release(held);
		await page.evaluate(() => __scspLiveAudit.beginStereo());
		held = await key();
		await wait(250);
		measurements.slowAttack = stereoStats(
			await page.evaluate(() => __scspLiveAudit.finishStereo()),
		);
		const fresh = await preview(),
			newGroup = fresh.voiceGroups.find((group) => group.held);
		assert.equal(fresh.slots[newGroup.slots[0]].envelope.attackRate, 18);
		assert(
			measurements.slowAttack.attackRatio < measurements.fastAttack.attackRatio * 0.75,
			'new key uses the slower native attack',
		);
		const oldToken = await page.evaluate(
			() =>
				__scspLiveAudit.commands().findLast((command) => command.method === 'loadAudition')
					.args[1],
		);
		await frozen(paused);
		assert.equal(await canvas(page), pausedWave);
		await sameAuthor(authoredBefore);
		checks.push(
			'Held paused preview pan/LFO changes actual stereo PCM; Envelope is staged for the next note, with frozen PCM/frame and authored state unchanged',
		);

		step(
			'CH/reference edits persist, invalid or stale operations cannot reach another preview',
		);
		await selected(1);
		await page.keyboard.up(held);
		await until(
			async () => !(await preview()).voiceGroups.some((group) => group.held),
			'CH change releases the old preview',
		);
		await change('directLevel', 7);
		await change('pan', 9);
		await change('attackRate', 31);
		await change('loopLink', true);
		let other = await key();
		const current = await preview(),
			group = current.voiceGroups.find((value) => value.held);
		assert.equal(current.slots[group.slots[0]].envelope.loopLink, true);
		const currentToken = await page.evaluate(
			() =>
				__scspLiveAudit.commands().findLast((command) => command.method === 'loadAudition')
					.args[1],
		);
		const beforeInvalid = JSON.stringify(current.slots);
		await page.evaluate(async (token) => {
			try {
				await __scspLiveAudit.read('invokeAudition', [token, 'setMix', [0, { pan: 32 }]]);
			} catch {}
		}, currentToken);
		assert.equal(
			JSON.stringify((await preview()).slots),
			beforeInvalid,
			'invalid audition parameter is atomic',
		);
		await page.evaluate(async (token) => {
			try {
				await __scspLiveAudit.read('invokeAudition', [token, 'setMix', [0, { pan: 31 }]]);
			} catch {}
		}, oldToken);
		assert.equal(
			(await preview()).slots[0].pan,
			9,
			'old CH token cannot mutate current preview',
		);
		await release(other);
		await selected(2);
		assert(await control(page, 'totalLevel').isEnabled(), 'Noise parameters remain editable');
		await change('totalLevel', 88);
		assert(
			await page.locator('#scspSsfCapture').isDisabled(),
			'Noise remains unsupported for PCM Capture',
		);
		await selected(0);
		await until(
			() =>
				control(page, 'attackRate')
					.inputValue()
					.then((value) => value === '18'),
			'CH1 draft restored',
		);
		assert.equal(await control(page, 'pan').inputValue(), '15');
		await page.selectOption('#scspSsfReference', '48');
		assert.equal(await control(page, 'attackRate').inputValue(), '18');
		assert.equal(await control(page, 'pan').inputValue(), '15');
		assert.equal(await control(page, 'root').inputValue(), playbackRate);
		await frozen(paused);
		assert.equal(await canvas(page), pausedWave);
		await sameAuthor(authoredBefore);
		checks.push(
			'Each CH and Reference retain their edited parameters, including loopLink; invalid/stale audition updates cannot change a different preview',
		);

		step('delayed preview load cannot survive an A to B to A selection');
		const delayedBefore = await page.evaluate(() => __scspLiveAudit.ackDelayed());
		await page.evaluate(() => __scspLiveAudit.armAckDelay('loadAudition', 1200));
		await page.evaluate(() => document.activeElement?.blur());
		const pendingKey = await page
			.locator('#keyboard .key')
			.filter({ hasText: /\bC4\b/ })
			.first()
			.getAttribute('data-key');
		await page.keyboard.down(pendingKey);
		await until(
			async () => (await page.evaluate(() => __scspLiveAudit.ackDelayed())) > delayedBefore,
			'pending preview load ACK held',
		);
		await selected(1);
		await selected(0);
		await page.keyboard.up(pendingKey);
		await wait(1250);
		assert(
			!(await preview()).voiceGroups.some((group) => group.held),
			'cancelled A-B-A key cannot begin after its delayed ACK',
		);
		await frozen(paused);
		const freshKey = await key();
		assert.equal((await preview()).slots[0].envelope.attackRate, 18);
		assert.equal((await preview()).slots[0].pan, 15);
		await release(freshKey);
		await sameAuthor(authoredBefore);
		checks.push(
			'A delayed preview-load reply is fenced across A to B to A selection; releasing the pending key leaves no orphan and the next key succeeds',
		);

		step('Resume continues the edited machine and Stop restores the authored draft');
		await page.click('#scspSongPause', { delay: 120 });
		await until(
			() =>
				view(page).then(
					(value) =>
						value.pause === 'Pause' && Number(value.frame) > Number(paused.frame),
				),
			'edited song resumed',
		);
		await wait(400);
		assert.equal(await control(page, 'attackRate').inputValue(), '18');
		assert.equal(await control(page, 'pan').inputValue(), '15');
		assert.equal(await canvas(page), sourceWave);
		await sameAuthor(authoredBefore);
		await page.click('#scspSongStop');
		await page.click('#scspChannelTabs [data-scsp-channel="auto"]');
		await until(async () => (await canvas(page)) === authoredWave, 'authored draft restored');
		assert.equal(await control(page, 'root').inputValue(), '500');
		assert(await page.locator('[data-chip-action="scsp-apply"]').isEnabled());
		await sameAuthor(authoredBefore);
		checks.push(
			'Resume continues forward with the edited song parameters; Stop restores the exact independent unapplied Auto waveform',
		);

		step('Capture copies edited parameters and full PCM while retaining Pause');
		await load(page, 'capture-edits.ssf', fixture.bytes);
		await page.check('#scspSsfLiveEnabled');
		await page.click('#scspSongPlay', { delay: 5 });
		await until(
			() => view(page).then((value) => value.liveActive === 'true'),
			'fresh SSF Live',
		);
		await page.click('#scspSongPause', { delay: 120 });
		await until(
			() => view(page).then((value) => value.pause === 'Resume'),
			'fresh song paused',
		);
		await selected(1);
		await change('attackRate', 31);
		await change('loopLink', true);
		await change('pan', 15);
		await change('totalLevel', 45);
		await change('lfo-frequencyCode', 12);
		await page.selectOption('#scspSsfReference', '48');
		const pendingCaptureKey = await key();
		const editRepliesBefore = await page.evaluate(() => __scspLiveAudit.ackDelayed());
		await page.evaluate(() => __scspLiveAudit.armAckDelay('invokeAudition', 1200));
		await change('attackRate', 19);
		await until(
			async () =>
				(await page.evaluate(() => __scspLiveAudit.ackDelayed())) > editRepliesBefore,
			'first preview-edit ACK held',
		);
		await change('attackRate', 31);
		const beforeCapture = await view(page);
		await page.click('#scspSsfCapture', { delay: 120 });
		await until(
			() =>
				page
					.locator('#status')
					.textContent()
					.then((text) => /^Captured SSF Slot 2/.test(text)),
			'edited Capture committed',
		);
		await page.keyboard.up(pendingCaptureKey);
		const document = await saved(),
			op = document.operators.carrier;
		assert.equal(op.bits, 8);
		assert.equal(op.pcm.length, 64);
		assert.equal(op.options.loopStartSamples, 8);
		assert.equal(op.options.baseFrequencyHz, 440 * 2 ** ((48 - 69) / 12));
		assert.equal(op.voice.envelope.attackRate, 31);
		assert.equal(op.voice.envelope.loopLink, true);
		assert.equal(op.voice.totalLevel, 45);
		assert.equal(op.voice.pan, 15);
		assert.equal(op.voice.lfo.frequencyCode, 12);
		const original = Array.from({ length: 64 }, (_, index) =>
			new DataView(fixture.image.buffer).getInt8(0x1100 + index),
		);
		assert.deepEqual(op.pcm, original);
		assert.equal((await view(page)).pause, 'Resume');
		assert.equal((await view(page)).position, beforeCapture.position);
		checks.push(
			'Capture waits for queued parameter edits, including a delayed preview ACK, and copies the last requested attack rate',
		);
		await page.check('#scspSsfLiveEnabled');
		await selected(1);
		const seeking = await page.evaluate(async () => {
			const seek = document.getElementById('scspSongSeek');
			seek.value = '1.75';
			seek.dispatchEvent(new Event('change', { bubbles: true }));
			await Promise.resolve();
			return {
				status: document.getElementById('scspSongStatus').textContent,
				attackDisabled: document.querySelector('[data-chip-control="scsp-attackRate"]')
					.disabled,
				captureDisabled: document.getElementById('scspSsfCapture').disabled,
			};
		});
		assert.match(seeking.status, /Seeking/);
		assert(
			seeking.attackDisabled && seeking.captureDisabled,
			'seeking source cannot receive parameter or Capture writes',
		);
		await until(
			async () =>
				(await view(page)).pause === 'Resume' &&
				(await control(page, 'attackRate').isEnabled()),
			'seek completed with editable source',
		);
		checks.push(
			'Parameter and Capture controls are read-only during seek and restore after the new paused source is ready',
		);
		for (const width of [1240, 390]) {
			await page.setViewportSize({ width, height: 1000 });
			await page.locator('#scspSsfLive').scrollIntoViewIfNeeded();
			assert(
				await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
			);
			await fs.mkdir(config.screenshots, { recursive: true });
			await page.screenshot({
				path: path.join(config.screenshots, engine + '-' + width + '.png'),
			});
		}
		await page.click('#scspSongStop');
		await pcm(page, false);
		assert.equal((await graph(page)).contexts, 1);
		assert.equal((await graph(page)).destinationEdges, 1);
		assert.deepEqual(errors, []);
		checks.push(
			'Capture and portable preset preserve edited Envelope/loopLink/LFO/mix, reference tuning and original full PCM without moving the paused song',
		);
		return {
			browser: engine,
			passed: true,
			checks,
			measurements,
			graph: await graph(page),
			errors,
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
			error: error.stack,
			view: await view(page).catch(() => null),
			errors,
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
		pathToFileURL(path.join(repo, 'test/helpers/scsp_ssf_fixture.mjs'))
	);
	const fixture = createScspSsfCaptureFixture();
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
