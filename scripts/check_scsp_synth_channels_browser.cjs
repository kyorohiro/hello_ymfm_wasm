// SPDX-License-Identifier: BSD-3-Clause
// Auto and physical SCSP channel editing, Code and SSF checks. Every physical destination is muted.
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
	out: path.join(tmpdir(), 'scsp-synth-channels-browser.json'),
	screenshots: path.join(tmpdir(), 'scsp-synth-channels-browser'),
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
		pointerEvents: () => pointerEvents.slice(),
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

/** Code opens audio outside the editor queue. Hold its last startup reply so a
 * physical-only edit lands after the first native idle-bank snapshot. */
async function checkColdStartupRace(browser, engine, origin) {
	const page = await browser.newPage({ viewport: { width: 1240, height: 1100 } });
	page.setDefaultTimeout(25000);
	const errors = [];
	let stage = 'cold race setup';
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
	const read = () => page.evaluate(() => __scspLiveAudit.read('readPhysical', [7]));
	async function change(name, value) {
		await control(page, name).fill(String(value));
		await control(page, name).dispatchEvent('change');
	}
	try {
		console.log('CHECK ' + engine + ': physical-only edits during the last cold startup reply');
		await page.goto(origin + config.entry);
		await until(
			() =>
				page
					.locator('#scspFilesPanel')
					.getAttribute('aria-busy')
					.then((value) => value === 'false'),
			'cold race Files ready',
		);
		await page.click('#scspChannelTabs [data-scsp-channel="7"]');
		await page.click('[data-chip-action="scsp-sine"]');
		await page.click('[data-chip-action="scsp-apply"]');
		await until(
			() => page.locator('[data-chip-action="scsp-apply"]').isDisabled(),
			'initial physical Sine applied passively',
		);
		await change('totalLevel', 21);
		await change('attackRate', 13);
		assert.equal((await graph(page)).contexts, 0);
		await page.click('#synthInputCodeTab');
		await page.locator('#synthCodeEditor').waitFor({ state: 'visible' });
		await page.fill(
			'#synthCodeEditor',
			"const scsp = await useSoundChip('scsp');\nawait scsp.noteOn(CH1, 'C4');\nliveLoop('hold', async () => { await beat(128); });\n",
		);
		await page.evaluate(() => __scspLiveAudit.armAckDelay('setPitchBend', 1200));
		await page.click('#synthCodeRunButton');
		stage = 'physical edit while startup setPitchBend reply is withheld';
		await until(
			() => page.evaluate(() => __scspLiveAudit.ackDelayed() === 1),
			'last initial startup reply held',
		);
		const initial = await read();
		assert.equal(initial.voice.totalLevel, 21);
		assert.equal(initial.voice.envelope.attackRate, 13);
		assert.equal(initial.pcm[0], 0);
		await page.click('#scspChannelTabs [data-scsp-channel="7"]');
		await page.click('[data-chip-action="scsp-saw"]');
		await page.click('[data-chip-action="scsp-apply"]');
		await until(
			() => page.locator('[data-chip-action="scsp-apply"]').isDisabled(),
			'new physical Saw applied to the passive bank',
		);
		await change('totalLevel', 41);
		await change('attackRate', 17);
		const beforeReply = await read();
		assert.equal(
			beforeReply.voice.totalLevel,
			21,
			'native still has the earlier idle snapshot',
		);
		assert.equal(beforeReply.pcm[0], 0);
		stage = 'startup revision retry and Code start';
		await until(
			() =>
				page
					.locator('#synthCodeState')
					.textContent()
					.then((text) => /Playing|Running/.test(text)),
			'Code starts after consistent migration',
		);
		const final = await read();
		assert.deepEqual(
			Array.from(final.pcm),
			Array.from({ length: 64 }, (_, index) => Math.round(8192 * (index / 32 - 1))),
		);
		assert.equal(final.voice.totalLevel, 41);
		assert.equal(final.voice.envelope.attackRate, 17);
		assert.equal(final.voice.gate, false, 'the migrated CH8 was not played by Code CH1');
		const commands = await page.evaluate(() => __scspLiveAudit.commands());
		const migrations = commands.filter((command) => command.method === 'loadIdleState').length;
		assert(
			migrations >= 2,
			'physical-only mutation repeats the idle snapshot and pitch synchronization',
		);
		const current = await page.evaluate(async () => (await __scspLiveAudit.read()).state);
		assert.equal(current.codeLanes[0].slots[0], 6);
		const output = await pcm(page);
		await page.click('#synthCodeStopButton');
		await pcm(page, false);
		assert.deepEqual(errors, []);
		assert.equal((await graph(page)).contexts, 1);
		return {
			passed: true,
			migrations,
			initialTotalLevel: initial.voice.totalLevel,
			finalTotalLevel: final.voice.totalLevel,
			finalAttackRate: final.voice.envelope.attackRate,
			pcmSamples: final.pcm.length,
			output,
			graph: await graph(page),
		};
	} catch (error) {
		await fs.mkdir(config.screenshots, { recursive: true });
		await page
			.screenshot({
				path: path.join(config.screenshots, engine + '-cold-race-failure.png'),
				fullPage: true,
			})
			.catch(() => {});
		error.receipt = {
			browser: engine,
			passed: false,
			stage,
			error: error.stack,
			errors,
			graph: await graph(page).catch(() => null),
			commands: await page
				.evaluate(() => __scspLiveAudit.commands().map((command) => command.method))
				.catch(() => null),
		};
		throw error;
	} finally {
		await page.close();
	}
}

async function check(browser, engine, origin, fixture) {
	const page = await browser.newPage({ viewport: { width: 1240, height: 1100 } });
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
	const state = () => page.evaluate(async () => (await __scspLiveAudit.read()).state);
	const physical = (slot) =>
		page.evaluate((slot) => __scspLiveAudit.read('readPhysical', [slot]), slot);
	const preview = () =>
		page.evaluate(() => __scspLiveAudit.read('readAudition').catch(() => null));
	const point = () =>
		page.evaluate(() => ({
			status: document.getElementById('status').textContent,
			code: document.getElementById('synthCodeState').textContent,
			source: document.getElementById('scspChannelTabs').dataset.source,
			selected: document.querySelector('#scspChannelTabs [aria-selected="true"]')?.dataset
				.scspChannel,
			physical: document.getElementById('voice').dataset.physicalChannel,
			ssf: document.getElementById('voice').dataset.ssfLive,
			summary: document.getElementById('scspChannelSummary').textContent,
			channels: [...document.querySelectorAll('#scspChannelTabs [data-scsp-channel]')].map(
				(button) => ({
					channel: button.dataset.scspChannel,
					active: button.dataset.active,
					gate: button.dataset.gate,
					selected: button.getAttribute('aria-selected'),
				}),
			),
		}));
	const step = (label) => {
		stage = label;
		console.log('CHECK ' + engine + ': ' + label);
	};
	async function select(channel) {
		await page.click('#scspChannelTabs [data-scsp-channel="' + channel + '"]');
		await until(
			() => point().then((value) => value.selected === String(channel)),
			'channel ' + channel + ' selected',
		);
		if (channel !== 'auto')
			await until(
				() =>
					point().then(
						(value) => value.source === 'ssf' || value.physical === String(channel),
					),
				'physical target ' + channel,
			);
	}
	async function change(name, value) {
		await control(page, name).fill(String(value));
		await control(page, name).dispatchEvent('change');
	}
	async function code(text, apply = false) {
		await page.click('#synthInputCodeTab');
		await page.locator('#synthCodeEditor').waitFor({ state: 'visible' });
		await until(() => page.locator('#synthCodeEditor').isEditable(), 'Code textarea ready');
		await page.fill('#synthCodeEditor', text);
		await page.click(apply ? '#synthCodeApplyButton' : '#synthCodeRunButton');
		await until(
			() => point().then((value) => /Playing|Running/.test(value.code)),
			'Code running',
		);
	}
	const program = (note) =>
		`const scsp = await useSoundChip('scsp');\nsetBpm(120);\nawait scsp.noteOn(CH1, '${note}');\nliveLoop('keep', async () => { await beat(128); });\n`;
	async function press(note = 'C4') {
		await page.evaluate(() => document.activeElement?.blur());
		const key = page
			.locator('#keyboard .key')
			.filter({ hasText: new RegExp('\\b' + note + '\\b') })
			.first();
		assert(await key.count(), 'keyboard includes ' + note);
		const letter = await key.getAttribute('data-key');
		assert(letter);
		await page.keyboard.down(letter);
		return letter;
	}
	async function assertCode() {
		assert((await state()).codeActive);
		assert.match((await point()).code, /Playing|Running/);
	}
	try {
		step('permanent Auto / CH row and selection do not allocate samples');
		await page.goto(origin + config.entry);
		await until(
			() =>
				page
					.locator('#scspFilesPanel')
					.getAttribute('aria-busy')
					.then((value) => value === 'false'),
			'Files ready',
		);
		assert.equal(await page.locator('#scspChannelTabs [data-scsp-channel]').count(), 33);
		assert.equal((await point()).selected, 'auto');
		assert.equal(await page.locator('#scspSsfSlot,#scspSsfSlots').count(), 0);
		assert.equal((await graph(page)).contexts, 0);
		await select(31);
		assert.equal((await graph(page)).contexts, 0);
		await page.click('[data-chip-action="scsp-triangle"]');
		const emptyDraftWave = await canvas(page);
		await select('auto');
		await select(31);
		assert.equal(
			await canvas(page),
			emptyDraftWave,
			'an unapplied draft on an empty physical CH survives tab switches',
		);
		assert(await page.locator('[data-chip-action="scsp-apply"]').isEnabled());
		assert.equal((await graph(page)).contexts, 0);
		await select(29);
		await page.click('[data-chip-action="scsp-saw"]');
		await page.click('[data-chip-action="scsp-apply"]');
		await until(
			() => page.locator('[data-chip-action="scsp-apply"]').isDisabled(),
			'passive physical PCM applied',
		);
		await change('totalLevel', 41);
		await change('attackRate', 17);
		assert.equal(
			(await graph(page)).contexts,
			0,
			'physical PCM / parameter edits stay passive',
		);
		await select('auto');
		await page.click('[data-chip-action="scsp-square"]');
		await change('root', 500);
		const draftWave = await canvas(page);
		assert(await page.locator('[data-chip-action="scsp-apply"]').isEnabled());
		await page.click('#start');
		await until(
			() =>
				page
					.locator('#start')
					.textContent()
					.then((value) => /Audio ready/.test(value)),
			'audio ready',
		);
		const coldPhysical = await physical(29);
		assert.deepEqual(
			Array.from(coldPhysical.pcm),
			Array.from({ length: 64 }, (_, index) => Math.round(8192 * (index / 32 - 1))),
		);
		assert.equal(coldPhysical.voice.totalLevel, 41);
		assert.equal(coldPhysical.voice.envelope.attackRate, 17);
		assert.equal(coldPhysical.voice.gate, false, 'cold physical settings do not autoplay');
		await pcm(page, false);
		const authoredBefore = await authoring(page),
			emptyBefore = await physical(31),
			initial = await state();
		assert.equal(emptyBefore.sample, null);
		assert.equal(emptyBefore.pcm, null);
		await select(31);
		assert.equal(
			await canvas(page),
			emptyDraftWave,
			'empty CH draft survives audio startup too',
		);
		assert.deepEqual(await physical(31), emptyBefore);
		assert.equal((await state()).samples.length, initial.samples.length);
		await select('auto');
		assert.equal(await canvas(page), draftWave);
		assert.equal(await control(page, 'root').inputValue(), '500');
		assert(await page.locator('[data-chip-action="scsp-apply"]').isEnabled());
		assert.equal(await authoring(page), authoredBefore);
		checks.push(
			'Physical PCM/settings edits stay passive and survive audio startup; empty selection copies nothing, and Auto draft returns intact',
		);

		step('Code logical lane maps to physical CH7 and its values follow');
		await code(program('C4'));
		await until(async () => {
			const current = await state();
			return current.codeLanes[0].slots[0] === 6 && current.slots[6].gate;
		}, 'Code CH1 allocated to physical CH7');
		measurements.code = await pcm(page);
		await select(6);
		await until(
			() =>
				point().then(
					(value) =>
						value.channels.find((channel) => channel.channel === '6')?.gate === 'true',
				),
			'CH7 requested gate visible',
		);
		assert.match((await point()).summary, /CH\s*1.*CH\s*7/s);
		assert.match(
			await page.locator('#scspSaveSoundAs').textContent(),
			/Auto/,
			'physical overrides are not presented as the saved Auto instrument',
		);
		const runtime = await physical(6),
			sourceA = (await state()).slots[0];
		assert(runtime.sample && runtime.pcm.length);
		assert.equal(
			await control(page, 'totalLevel').inputValue(),
			String(runtime.voice.totalLevel),
		);
		assert.equal(
			await control(page, 'attackRate').inputValue(),
			String(runtime.voice.envelope.attackRate),
		);
		await assertCode();
		checks.push(
			'Running Code retains its logical API; CH1 maps to actualCH7 and the permanent gate row and inspector show that physical voice',
		);

		step('physical controls edit only the selected CH while Code continues');
		await change('totalLevel', 37);
		await until(
			async () => (await physical(6)).voice.totalLevel === 37,
			'physical total level',
		);
		assert.equal((await state()).slots[0].totalLevel, sourceA.totalLevel);
		await change('attackRate', 17);
		await page.selectOption('#voice [data-chip-control="scsp-lfo-frequencyCode"]', '12');
		await page.selectOption('#voice [data-chip-control="scsp-lfo-pitchDepth"]', '1');
		await page.fill('#scspPhysicalFrequency', '330');
		await page.locator('#scspPhysicalFrequency').dispatchEvent('change');
		await until(async () => {
			const voice = (await physical(6)).voice;
			return (
				voice.envelope.attackRate === 17 &&
				voice.lfo.frequencyCode === 12 &&
				voice.lfo.pitchDepth === 1 &&
				voice.frequencyHz === 330
			);
		}, 'physical Envelope, LFO and frequency edits');
		assert.equal((await state()).slots[0].envelope.attackRate, sourceA.envelope.attackRate);
		await change('modulation-depth', 3);
		await change('modulation-xOffset', 63);
		await change('modulation-yOffset', 31);
		await until(async () => {
			const modulation = (await physical(6)).voice.modulation;
			return modulation.depth === 3 && modulation.xOffset === 63 && modulation.yOffset === 31;
		}, 'physical stack modulation edits');
		await page.click('[data-chip-action="scsp-saw"]');
		await page.click('[data-chip-action="scsp-apply"]');
		await until(async () => (await physical(6)).pcm[0] === -8192, 'physical PCM edit applied');
		await until(
			() => page.locator('[data-chip-action="scsp-apply"]').isDisabled(),
			'physical Apply clears its draft',
		);
		assert((await physical(6)).voice.gate, 'PCM editing retains the current Code gate');
		await change('directLevel', 0);
		await until(
			async () => (await physical(6)).voice.directLevel === 0,
			'physical modulator muted',
		);
		assert.equal((await state()).slots[0].directLevel, sourceA.directLevel);
		await pcm(page, false);
		await assertCode();
		const beforeInvalid = await physical(6);
		const rejected = await page.evaluate(async () => {
			try {
				await __scspLiveAudit.read('invokePhysical', ['setMix', [6, { pan: 32 }]]);
				return false;
			} catch {
				return true;
			}
		});
		assert(rejected, 'invalid physical edit rejected');
		assert.deepEqual(await physical(6), beforeInvalid);
		assert.equal(await authoring(page), authoredBefore);
		checks.push(
			'Physical PCM, Envelope, LFO, frequency, mix and stack modulation edit oneCH without fanout or stopping Code; invalid edits leave it intact',
		);

		step('manual physical note is overwritten by Auto reuse and stale keyup is safe');
		const manualKey = await press('C4');
		await until(
			async () =>
				(await state()).manualVoices.some((voice) => voice.slot === 6 && voice.held),
			'manual CH7 key held',
		);
		assert.equal((await physical(6)).voice.directLevel, 0);
		await assertCode();
		await code(program('D4'), true);
		await until(async () => {
			const current = await state();
			return (
				current.codeLanes[0].slots[0] === 6 &&
				current.codeLanes[0].midi === 62 &&
				current.slots[6].gate
			);
		}, 'Auto reused CH7 despite the held silent manual note');
		assert.equal((await physical(6)).voice.totalLevel, sourceA.totalLevel);
		assert.equal((await physical(6)).voice.directLevel, sourceA.directLevel);
		await page.keyboard.up(manualKey);
		await wait(80);
		assert((await state()).slots[6].gate, 'stale manual release keeps the newer Auto voice');
		await assertCode();
		measurements.reused = await pcm(page);
		checks.push(
			'Auto allocation may overwrite held silent physical edits; releasing the older key cannot stop the replacement Code voice',
		);

		step('empty-channel keyboard initialization and independent releases');
		assert.equal((await physical(31)).sample, null);
		await select(31);
		assert.equal((await physical(31)).sample, null);
		const emptyKey = await press('C4');
		await until(
			async () =>
				(await state()).manualVoices.some((voice) => voice.slot === 31 && voice.held),
			'empty CH32 key initialized',
		);
		const initialized = await physical(31);
		assert(initialized.sample);
		assert.deepEqual(
			Array.from(initialized.pcm),
			Object.values(JSON.parse(authoredBefore).operators[0].pcm),
		);
		const initializedA = (await state()).slots[0];
		assert.equal(initialized.sample.id, initializedA.sample.id);
		await select(30);
		assert(
			(await state()).slots[31].gate,
			'selecting another tab cannot turn off the held physical CH',
		);
		const nextKey = await press('D4');
		await until(
			async () =>
				(await state()).manualVoices.some((voice) => voice.slot === 30 && voice.held),
			'independent CH31 key',
		);
		await page.keyboard.up(emptyKey);
		await wait(50);
		assert((await state()).slots[30].gate, 'old CH32 keyup leaves CH31 sounding');
		await page.keyboard.up(nextKey);
		await until(
			async () => !(await state()).manualVoices.some((voice) => voice.held),
			'physical keys released',
		);
		await select(29);
		await page.evaluate(() => __scspLiveAudit.armDelay('physicalNoteOn', 250));
		const pendingKey = await press('C4');
		await until(
			() => page.evaluate(() => __scspLiveAudit.delayed() === 1),
			'physical note preparation delayed',
		);
		await page.keyboard.up(pendingKey);
		await wait(400);
		assert(
			!(await state()).manualVoices.some((voice) => voice.held),
			'no delayed orphan manual key',
		);
		assert.equal((await state()).slots[29].gate, false, 'pending physical key is gated off');
		assert((await state()).slots[6].gate, 'Code still holds CH7');
		await assertCode();
		checks.push(
			'An empty CH copies AutoA only on its first actual note; tab changes and pending/stale releases cannot stop a different CH or leave orphan gates',
		);

		step('Auto draft, preset ownership and permanent row layout');
		await select('auto');
		assert.equal(await canvas(page), draftWave);
		assert.equal(await control(page, 'root').inputValue(), '500');
		assert(await page.locator('[data-chip-action="scsp-apply"]').isEnabled());
		assert.equal(await authoring(page), authoredBefore);
		for (const filesVisible of [false, true]) {
			if ((await page.locator('#scspFilesPanel').isVisible()) !== filesVisible)
				await page.click('#scspFilesToggle');
			for (const width of [1240, 390]) {
				await page.setViewportSize({ width, height: 1000 });
				await page.locator('#scspChannelTabs').scrollIntoViewIfNeeded();
				await page.evaluate(
					() =>
						new Promise((resolve) =>
							requestAnimationFrame(() => requestAnimationFrame(resolve)),
						),
				);
				assert(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth + 1,
					),
					'channel row fits ' + width,
				);
				const clipped = await page
					.locator('#scspChannelTabs button')
					.evaluateAll((buttons) =>
						buttons
							.filter((button) => button.scrollWidth > button.clientWidth + 1)
							.map((button) => ({
								label: button.textContent,
								width: button.clientWidth,
								content: button.scrollWidth,
								fontSize: getComputedStyle(button).fontSize,
								padding: getComputedStyle(button).padding,
							})),
					);
				assert.deepEqual(clipped, [], 'all channel labels fit ' + width);
				await fs.mkdir(config.screenshots, { recursive: true });
				await page.screenshot({
					path: path.join(
						config.screenshots,
						engine + '-' + width + (filesVisible ? '-files' : '') + '.png',
					),
				});
			}
		}
		if (await page.locator('#scspFilesPanel').isVisible()) await page.click('#scspFilesToggle');
		await page.setViewportSize({ width: 1240, height: 1100 });
		await page.click('#synthCodeStopButton');
		await until(async () => !(await state()).codeActive, 'Code stopped');
		await pcm(page, false);
		checks.push(
			'Physical runtime overrides never replace the grouped Auto draft or preset sources, and one compact row fits390px',
		);

		step('one shared selector owns SSF Live, paused audition and Capture');
		await load(page, 'channels.ssf', fixture.bytes);
		await page.check('#scspSsfLiveEnabled');
		await page.click('#scspSongPlay', { delay: 5 });
		await pcm(page);
		await until(() => point().then((value) => value.source === 'ssf'), 'row observes SSF');
		await page.click('#scspSongPause', { delay: 120 });
		await until(() => view(page).then((value) => value.pause === 'Resume'), 'SSF paused');
		await pcm(page, false);
		await select(1);
		await until(
			() =>
				view(page).then((value) => value.voiceSlot === '1' && value.liveActive === 'true'),
			'SSF CH2 inspection',
		);
		assert(await control(page, 'totalLevel').isEnabled());
		assert(await control(page, 'bits').isDisabled());
		assert.equal(await control(page, 'bits').inputValue(), '8');
		assert.equal(await page.locator('#scspSsfSlot,#scspSsfSlots').count(), 0);
		const frozen = await view(page),
			beforePreview = await authoring(page),
			ssfKey = await press('C4');
		await until(
			async () => (await preview())?.voiceGroups.some((group) => group.held),
			'paused selected SSF audition',
		);
		assert.equal((await view(page)).frame, frozen.frame);
		assert.equal((await view(page)).position, frozen.position);
		assert.equal(await authoring(page), beforePreview);
		await page.keyboard.up(ssfKey);
		await page.click('#scspSongPause', { delay: 5 });
		await until(
			() =>
				view(page).then(
					(value) => value.pause === 'Pause' && value.position > frozen.position,
				),
			'SSF resumed before held Capture',
		);
		await page.click('#scspSsfCapture', { delay: 120 });
		await until(
			() =>
				point().then(
					(value) =>
						/^Captured SSF Slot 2/.test(value.status) && value.selected === 'auto',
				),
			'Capture returns to grouped Auto',
		);
		assert.equal((await view(page)).pause, 'Resume');
		assert(
			(await view(page)).position >= frozen.position,
			'playing Capture pauses at the current position',
		);
		const capturePosition = (await view(page)).position;
		assert.equal((await state()).slots[0].sample.bits, 8);
		await page.check('#scspSsfLiveEnabled');
		await until(
			() =>
				view(page).then(
					(value) => Number(value.frame) >= Number(frozen.frame) && value.slot === '1',
				),
			'captured SSF physical CH restored',
		);
		assert.equal((await view(page)).position, capturePosition);
		assert.equal((await view(page)).pause, 'Resume');
		await page.click('#scspSongStop');
		await select('auto');
		await pcm(page, false);
		checks.push(
			'One row selects editable SSF parameters and paused previews; a held Capture click during playback pauses the song and selects editable Auto',
		);
		assert.equal((await graph(page)).contexts, 1);
		assert.equal((await graph(page)).destinationEdges, 1);
		assert.deepEqual(errors, []);
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
			view: await point().catch(() => null),
			song: await view(page).catch(() => null),
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
				const coldStartupRace = await checkColdStartupRace(browser, engine, origin);
				const checked = await check(browser, engine, origin, fixture);
				checked.coldStartupRace = coldStartupRace;
				checked.checks.unshift(
					'Physical-only PCM and mix edits during the last cold startup reply trigger a consistent native migration before Code starts',
				);
				results.push(checked);
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
