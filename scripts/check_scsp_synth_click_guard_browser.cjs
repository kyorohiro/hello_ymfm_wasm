// SPDX-License-Identifier: BSD-3-Clause
// SCSP Synth software Note Off guard: real Worklet PCM, headless and silent.
// The destination is intercepted before application code runs. A 44.1 kHz
// test context makes raw-key captures comparable at the same native phase.
// node scripts/check_scsp_synth_click_guard_browser.cjs --root=docs --entry=/synth-scsp/index.html
const assert = require('node:assert/strict'),
	fs = require('node:fs/promises'),
	http = require('node:http'),
	path = require('node:path');
const { createHash } = require('node:crypto'),
	{ tmpdir } = require('node:os');
const { chromium, webkit } = require('playwright');
const startedAt = Date.now();
const config = {
	root: path.resolve(__dirname, '../docs'),
	entry: '/synth-scsp/index.html',
	engines: 'chromium,webkit',
	out: path.join(tmpdir(), 'scsp-synth-click-guard-browser.json'),
	screenshots: path.join(tmpdir(), 'scsp-synth-click-guard-browser'),
};
for (const arg of process.argv.slice(2)) {
	const match = /^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);
	assert(match, 'Unknown argument ' + arg);
	config[match[1]] = match[2];
}
config.root = path.resolve(config.root);
assert(config.entry.startsWith('/') && !/[?#]/.test(config.entry));
const engines = config.engines.split(',');
assert(engines.length && engines.every((name) => ['chromium', 'webkit'].includes(name)));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex'),
	wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const served = new Map(),
	missing = [],
	external = [],
	httpErrors = [],
	blockedMonaco = [],
	results = [];
const mime = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.wasm': 'application/wasm',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
};
async function until(predicate, label, timeout = 20000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		if (await predicate()) return;
		await wait(30);
	}
	throw Error('Timeout: ' + label);
}

function installAudit() {
	const BaseContext = window.AudioContext ?? window.webkitAudioContext,
		BaseNode = window.AudioWorkletNode;
	const connect = AudioNode.prototype.connect,
		post = MessagePort.prototype.postMessage;
	const contexts = [],
		nodes = [],
		meters = [],
		commands = [],
		captureMutes = [],
		owners = new WeakMap();
	let serial = 0,
		capture = null;
	window.AudioContext = class extends BaseContext {
		constructor(options = {}) {
			super({ ...options, sampleRate: 44100 });
			contexts.push(this);
		}
	};
	if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
	window.AudioWorkletNode = class extends BaseNode {
		constructor(context, name, ...args) {
			super(context, name, ...args);
			nodes.push({ node: this, name });
			owners.set(this.port, context);
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
	MessagePort.prototype.postMessage = function (data, ...args) {
		if (data?.method) {
			commands.push({ method: data.method, args: data.args });
			if (commands.length > 10000) commands.shift();
		}
		if (capture && data?.method === 'code' && [0].includes(data.args?.[2]?.[0])) {
			const method = data.args[1],
				context = owners.get(this);
			if (['noteOn', 'keyOn'].includes(method))
				capture.on.push(Math.round(context.currentTime * context.sampleRate));
			if (['noteOff', 'keyOff'].includes(method))
				capture.off.push(Math.round(context.currentTime * context.sampleRate));
		}
		if (capture && ['noteOn', 'physicalNoteOn', 'auditionOn'].includes(data?.method))
			capture.on.push(Math.round(owners.get(this).currentTime * owners.get(this).sampleRate));
		if (capture && ['noteOff', 'physicalNoteOff', 'auditionOff'].includes(data?.method))
			capture.off.push(
				Math.round(owners.get(this).currentTime * owners.get(this).sampleRate),
			);
		return post.call(this, data, ...args);
	};
	const muted = () =>
		meters.every((item) => item.mute.gain.value === 0) &&
		captureMutes.every((item) => item.gain.value === 0);
	const source = () => meters.find((item) => item.source.context.state !== 'closed')?.source;
	async function read(method = 'readAuthoring', args = []) {
		const node = nodes.find((item) => item.name === 'tetorica-scsp-synth')?.node;
		if (!node) throw Error('SCSP Worklet missing');
		const id = --serial;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				node.port.removeEventListener('message', receive);
				reject(Error('SCSP read timed out'));
			}, 5000);
			function receive({ data }) {
				if (data?.id !== id) return;
				clearTimeout(timer);
				node.port.removeEventListener('message', receive);
				data.error
					? reject(Error(data.error))
					: resolve(method === 'readAuthoring' ? data.value.state : data.value);
			}
			node.port.addEventListener('message', receive);
			node.port.start();
			node.port.postMessage({ id, method, args });
		});
	}
	async function begin() {
		if (capture) throw Error('Capture already active');
		const input = source();
		if (!input) throw Error('No post-Master output');
		const name = 'scsp-guard-capture-' + Math.abs(--serial),
			url = URL.createObjectURL(
				new Blob(
					[
						`class Capture extends AudioWorkletProcessor{process(inputs){if(inputs[0]?.[0])this.port.postMessage({frame:currentFrame,values:inputs[0][0].slice()});return true;}}registerProcessor('${name}',Capture);`,
					],
					{ type: 'text/javascript' },
				),
			);
		try {
			await input.context.audioWorklet.addModule(url);
		} finally {
			URL.revokeObjectURL(url);
		}
		const node = new AudioWorkletNode(input.context, name, {
				numberOfInputs: 1,
				numberOfOutputs: 1,
				outputChannelCount: [1],
			}),
			mute = input.context.createGain();
		mute.gain.value = 0;
		captureMutes.push(mute);
		const item = (capture = { input, node, mute, blocks: [], on: [], off: [] });
		node.port.onmessage = ({ data }) => {
			if (item.blocks.length < 1024) item.blocks.push(data);
		};
		connect.call(input, node);
		connect.call(node, mute);
		connect.call(mute, input.context.destination);
	}
	function finish() {
		const item = capture;
		capture = null;
		if (!item || !item.off.length) throw Error('Gate capture has no Off');
		item.input.disconnect(item.node);
		item.node.disconnect();
		item.mute.disconnect();
		item.node.port.close();
		const blocks = item.blocks.sort((a, b) => a.frame - b.frame),
			rate = item.input.context.sampleRate;
		if (blocks.length < 20) throw Error('Gate capture too short');
		const first = blocks[0].frame,
			last = blocks.at(-1),
			values = new Float32Array(last.frame + last.values.length - first);
		let expected = first;
		for (const block of blocks) {
			if (block.frame !== expected) throw Error('Capture discontinuity');
			values.set(block.values, block.frame - first);
			expected += block.values.length;
		}
		const mark = item.off.at(-1) - first,
			start = item.on.at(-1) === undefined ? 0 : item.on.at(-1) - first;
		let peak = 0,
			regularJump = 0,
			releaseJump = 0,
			regularCurvature = 0,
			releaseCurvature = 0,
			tailPeak = 0,
			lastNonzero = null;
		for (let i = Math.max(1, mark - Math.round(0.08 * rate)); i < values.length; i++) {
			const level = Math.abs(values[i]),
				jump = Math.abs(values[i] - values[i - 1]),
				curvature = i > 1 ? Math.abs(values[i] - 2 * values[i - 1] + values[i - 2]) : 0;
			if (i < mark - 384) {
				peak = Math.max(peak, level);
				regularJump = Math.max(regularJump, jump);
				regularCurvature = Math.max(regularCurvature, curvature);
			}
			if (i >= mark - 384 && i < mark + 0.025 * rate) {
				releaseJump = Math.max(releaseJump, jump);
				releaseCurvature = Math.max(releaseCurvature, curvature);
			}
			if (i > mark + 0.04 * rate) tailPeak = Math.max(tailPeak, level);
			if (level > 1e-8) lastNonzero = first + i;
		}
		let onset = Math.max(0, start - 384);
		while (onset < values.length && Math.abs(values[onset]) <= 1e-8) onset++;
		return {
			sampleRate: rate,
			frames: values.length,
			peak,
			regularJump,
			releaseJump,
			normalizedJump: releaseJump / peak,
			regularCurvature,
			releaseCurvature,
			normalizedCurvature: releaseCurvature / peak,
			excessCurvature: Math.max(0, releaseCurvature - regularCurvature) / peak,
			tailPeak,
			lastNonzeroAfterOffMs:
				lastNonzero === null ? null : (1000 * (lastNonzero - item.off.at(-1))) / rate,
			periodError: (() => {
				let error = 0;
				for (let i = 256; i < Math.max(256, mark - 384); i++)
					error = Math.max(error, Math.abs(values[i] - values[i - 256]));
				return error;
			})(),
			prefix: Array.from(values.subarray(onset, onset + 2048)),
			onMarks: item.on.length,
			offMarks: item.off.length,
			muted: muted(),
		};
	}
	window.__scspGuardAudit = {
		read,
		begin,
		finish,
		marks: () => ({ on: capture?.on.length ?? 0, off: capture?.off.length ?? 0 }),
		commands: () => commands.slice(),
		drain: () => commands.splice(0),
		graph: () => ({
			contexts: contexts.length,
			editorWorklets: nodes.filter((item) => item.name === 'tetorica-scsp-synth').length,
			sampleRates: contexts.map((item) => item.sampleRate),
			destinationConnections: meters.length,
			muted: muted(),
		}),
	};
}

async function snapshot(page) {
	return page.evaluate(() => __scspGuardAudit.read());
}
async function source(page, code) {
	await page.click('#synthInputCodeTab');
	await page.locator('#synthCodeEditor').waitFor({ state: 'visible' });
	await page.fill('#synthCodeEditor', code);
}
async function stop(page) {
	if (await page.locator('#synthCodeStopButton').isEnabled())
		await page.click('#synthCodeStopButton');
	await wait(70);
}
async function guard(page, enabled) {
	await page.locator('#scspClickGuard').setChecked(enabled);
	await until(
		async () => Boolean((await snapshot(page)).clickGuard) === enabled,
		'guard preference',
	);
}
const settings = `const scsp=await useSoundChip('scsp');
await scsp.setConfig({mode:'pcm'});
await scsp.setPreset(0,{frequencyHz:440,totalLevel:12,directLevel:7,pan:0,envelope:{attackRate:31,decay1Rate:0,decay2Rate:0,decayLevel:0,releaseRate:31,keyRateScaling:15,loopLink:false},lfo:{frequencyCode:0,pitchWave:0,pitchDepth:0,amplitudeWave:0,amplitudeDepth:0,reset:false}});
`;
const compact = (pcm) => {
	const { prefix, ...result } = pcm;
	return result;
};
async function capturedRelease(page, { enabled, raw = false, hold = 0.18, releaseRate = 31 }) {
	await guard(page, enabled);
	const code =
		settings +
		`await scsp.setEnvelope(0,{releaseRate:${releaseRate}});\nawait sleep(.03);\n` +
		(raw
			? `await scsp.setNote(CH1,'E3');await scsp.keyOn(CH1);`
			: `await scsp.noteOn(CH1,'E3');`) +
		`\nawait sleep(${hold});\nawait scsp.${raw ? 'keyOff' : 'noteOff'}(CH1);\nawait sleep(.16);\nlog('released');`;
	await source(page, code);
	await page.evaluate(() => __scspGuardAudit.begin());
	await page.click('#synthCodeRunButton');
	await until(
		() => page.evaluate(() => __scspGuardAudit.marks().off > 0),
		'actual scoped Code Off',
	);
	await wait(180);
	const pcm = await page.evaluate(() => __scspGuardAudit.finish());
	assert(pcm.muted && pcm.peak > 0.0001 && Number.isFinite(pcm.normalizedJump));
	const state = await snapshot(page);
	assert.equal(
		state.slots[0].envelope.releaseRate,
		releaseRate,
		'authored RR never replaced by actual release guard',
	);
	await stop(page);
	return pcm;
}
async function keyboardRelease(page, { enabled, target = 'auto', hold = 0.18 }) {
	await guard(page, enabled);
	await page.click('#scspChannelTabs [data-scsp-channel="' + target + '"]');
	await page.click('#synthInputKeyboardTab');
	await page.evaluate(() => document.activeElement?.blur());
	const key = page
			.locator('#keyboard .key')
			.filter({ hasText: /\bE3\b/ })
			.first(),
		letter = await key.getAttribute('data-key');
	assert(letter);
	await page.evaluate(() => __scspGuardAudit.begin());
	await wait(40);
	await page.keyboard.down(letter);
	await wait(Math.round(hold * 1000));
	await page.keyboard.up(letter);
	await until(() => page.evaluate(() => __scspGuardAudit.marks().off > 0), 'actual keyboard Off');
	await wait(180);
	const pcm = await page.evaluate(() => __scspGuardAudit.finish());
	assert(pcm.muted && pcm.peak > 0.0001);
	return pcm;
}
async function check(browser, name, origin) {
	const page = await browser.newPage({
			viewport: { width: 1240, height: 1050 },
			serviceWorkers: 'block',
		}),
		errors = [],
		checks = [],
		measurements = {};
	let stage = 'startup';
	page.setDefaultTimeout(25000);
	page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
	await page.route('**/*', (route) => {
		const url = new URL(route.request().url());
		if (url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'cdn.jsdelivr.net') {
			blockedMonaco.push(url.href);
			return route.abort();
		}
		if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) {
			external.push(url.href);
			return route.abort();
		}
		return route.continue();
	});
	await page.addInitScript(installAudit);
	const step = (label) => {
		stage = label;
		console.log('CHECK ' + name + ': ' + label);
	};
	try {
		await page.goto(origin + config.entry);
		await until(
			() =>
				page
					.locator('#scspFilesPanel')
					.getAttribute('aria-busy')
					.then((value) => value === 'false'),
			'Files ready',
		);
		step('host preference defaults On, remains passive, and cold Off reaches the Worklet');
		assert(await page.locator('#scspClickGuard').isChecked());
		assert.match(
			await page
				.locator('#scspClickGuard')
				.evaluate((input) => input.closest('label').textContent),
			/Software/i,
		);
		assert.equal((await page.evaluate(() => __scspGuardAudit.graph())).contexts, 0);
		await page.uncheck('#scspClickGuard');
		assert.equal((await page.evaluate(() => __scspGuardAudit.graph())).contexts, 0);
		await page.click('#start');
		await until(
			() =>
				page
					.locator('#start')
					.textContent()
					.then((text) => /ready/i.test(text)),
			'audio ready',
		);
		assert.equal((await snapshot(page)).clickGuard, false);
		await page.click('#scspChannelTabs [data-scsp-channel="auto"]');
		await page.click('[data-chip-action="scsp-sine"]');
		await page.click('[data-chip-action="scsp-apply"]');
		await until(
			() => page.locator('[data-chip-action="scsp-apply"]').isDisabled(),
			'Sine applied',
		);
		checks.push(
			'Default On is passive; choosing Off before audio configures the existing Worklet without extra audio',
		);

		step('scoped Code noteOff reduces fast Sine release discontinuity across phases');
		const raw = [],
			smooth = [];
		for (const hold of [0.18, 0.183, 0.187])
			raw.push(await capturedRelease(page, { enabled: false, hold }));
		for (const hold of [0.18, 0.183, 0.187])
			smooth.push(await capturedRelease(page, { enabled: true, hold }));
		const rawMaximum = Math.max(...raw.map((p) => p.normalizedJump)),
			smoothMaximum = Math.max(...smooth.map((p) => p.normalizedJump));
		const rawCurve = Math.max(...raw.map((p) => p.excessCurvature)),
			smoothCurve = Math.max(...smooth.map((p) => p.excessCurvature));
		console.log(
			'MEASURE ' +
				name +
				': ' +
				JSON.stringify({ rawMaximum, smoothMaximum, rawCurve, smoothCurve }),
		);
		assert(
			rawCurve > smoothCurve * 2,
			'guard reduces release curvature beyond the natural Sine baseline',
		);
		assert(
			smoothMaximum <= rawMaximum + 1e-6,
			'guard does not increase the worst first difference',
		);
		for (const pcm of smooth)
			assert(pcm.tailPeak < 1e-7, 'fast guarded release finishes without a hanging tail');
		measurements.codeRelease = {
			raw: raw.map(compact),
			smooth: smooth.map(compact),
			rawMaximum,
			smoothMaximum,
			rawCurve,
			smoothCurve,
		};
		checks.push(
			'Actual post-Master PCM confirms reduced Code noteOff steps, preserving authored RR31 and completing the native tail',
		);

		step('raw keyOff bypass and long hardware release retain their semantics');
		const rawOff = await capturedRelease(page, { enabled: false, raw: true }),
			rawOn = await capturedRelease(page, { enabled: true, raw: true });
		assert.equal(rawOff.prefix.length, 2048);
		assert.equal(rawOn.prefix.length, 2048);
		const prefixDifference = Math.max(
			...rawOff.prefix.map((value, index) => Math.abs(value - rawOn.prefix[index])),
		);
		assert(prefixDifference < 1e-7, 'raw key attack and sustained samples are unchanged');
		assert(
			rawOn.lastNonzeroAfterOffMs <
				Math.min(...smooth.map((p) => p.lastNonzeroAfterOffMs)) * 0.6,
			'explicit raw keyOff keeps its shorter hardware release',
		);
		const long = await capturedRelease(page, { enabled: true, releaseRate: 5 });
		assert(
			long.tailPeak > long.peak * 0.05,
			'long hardware RR5 is not forced into a short software cut',
		);
		measurements.rawAndLong = {
			rawOff: compact(rawOff),
			rawOn: compact(rawOn),
			prefixDifference,
			long: compact(long),
		};
		checks.push(
			'Raw keyOff bypasses smoothing; raw PCM prefixes match and a programmed long release stays audible',
		);

		step('keyboard Auto and selected physical CH use the same release preference');
		// Restore ordinary fast settings after the deliberately long-release case.
		await source(page, settings);
		await page.click('#synthCodeRunButton');
		await until(
			async () => (await snapshot(page)).slots[0].envelope.releaseRate === 31,
			'fast author RR restored',
		);
		await stop(page);
		const keyboard = {};
		for (const target of ['auto', '19']) {
			const off = await keyboardRelease(page, { enabled: false, target }),
				on = await keyboardRelease(page, { enabled: true, target });
			keyboard[target] = { off: compact(off), on: compact(on) };
			assert(on.normalizedJump < 0.2);
			assert(on.tailPeak < 1e-7);
		}
		measurements.keyboard = keyboard;
		checks.push(
			'Trusted keyboard releases in Auto and direct physical CH use the host guard and leave no tail',
		);

		step('toggling while Code holds a voice keeps its phase, session and preset');
		await page.click('#scspChannelTabs [data-scsp-channel="auto"]');
		await guard(page, true);
		await source(
			page,
			settings +
				`await scsp.setFrequency(CH1,44100/256);await scsp.keyOn(CH1);liveLoop('hold',async()=>{await beat(128);});`,
		);
		await page.click('#synthCodeRunButton');
		await until(
			async () => (await snapshot(page)).voiceGroups.some((group) => group.held),
			'periodic held note',
		);
		await wait(100);
		const before = await snapshot(page),
			presetBefore = await page.evaluate(() => __scspGuardAudit.read('exportPatch'));
		assert(!JSON.stringify(presetBefore).includes('clickGuard'));
		await page.evaluate(() => __scspGuardAudit.begin());
		await wait(100);
		await guard(page, false);
		await wait(100);
		await guard(page, true);
		await wait(100);
		const after = await snapshot(page);
		assert.equal(after.codeSession, before.codeSession);
		assert.deepEqual(after.samples, before.samples);
		assert.deepEqual(after.config, before.config);
		assert(after.voiceGroups.some((group) => group.held));
		assert.deepEqual(
			await page.evaluate(() => __scspGuardAudit.read('exportPatch')),
			presetBefore,
			'host preference is not part of the instrument preset',
		);
		// Stop only after the held capture interval, using an explicit raw release.
		await source(
			page,
			`const scsp=await useSoundChip('scsp');await scsp.keyOff(CH1);liveLoop('hold',async()=>{await beat(128);});`,
		);
		await page.click('#synthCodeApplyButton');
		await until(
			() => page.evaluate(() => __scspGuardAudit.marks().off > 0),
			'held voice raw release',
		);
		await wait(60);
		const held = await page.evaluate(() => __scspGuardAudit.finish());
		assert(
			held.periodError < 1e-7,
			'toggling preference preserves the exact sustained sample phase',
		);
		measurements.preference = { periodError: held.periodError };
		await stop(page);
		assert.equal((await snapshot(page)).clickGuard, true);
		await guard(page, false);
		await page.setInputFiles('#open', {
			name: 'guard-preset-roundtrip.json',
			mimeType: 'application/json',
			buffer: Buffer.from(JSON.stringify(presetBefore)),
		});
		await until(
			() =>
				page
					.locator('#status')
					.textContent()
					.then((text) => /instrument loaded/i.test(text)),
			'preset round trip',
		);
		assert.equal(
			(await snapshot(page)).clickGuard,
			false,
			'loading a preset preserves the host preference',
		);
		checks.push(
			'Portable presets exclude the host preference, and loading a preset preserves the chosen setting',
		);

		await fs.mkdir(config.screenshots, { recursive: true });
		for (const width of [1240, 390]) {
			await page.setViewportSize({ width, height: 1050 });
			for (const mode of ['Code', 'Keyboard']) {
				await page.click('#synthInput' + mode + 'Tab');
				await page.locator('#scspClickGuard').scrollIntoViewIfNeeded();
				assert(await page.locator('#scspClickGuard').isVisible());
				assert(await page.locator('#scspClickGuard').isEnabled());
				assert(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth + 1,
					),
					'host preference fits ' + width + ' ' + mode,
				);
			}
			await page.screenshot({
				path: path.join(config.screenshots, name + '-guard-' + width + '.png'),
			});
		}
		checks.push(
			'A steady periodic Sine remains phase-identical across preference changes, and Stop retains the host setting',
		);
		const graph = await page.evaluate(() => __scspGuardAudit.graph());
		assert(graph.muted);
		assert.equal(graph.contexts, 1);
		assert.equal(graph.editorWorklets, 1);
		assert.deepEqual(errors, []);
		return { browser: name, passed: true, checks, measurements, graph, errors };
	} catch (error) {
		error.receipt = {
			browser: name,
			passed: false,
			stage,
			error: error.stack,
			checks,
			measurements,
			state: await snapshot(page).catch(() => null),
			errors,
		};
		throw error;
	} finally {
		await page.close();
	}
}

const server = http.createServer(async (req, res) => {
	try {
		const pathname = new URL(req.url, 'http://localhost').pathname;
		if (pathname === '/favicon.ico') {
			res.writeHead(204).end();
			return;
		}
		const filename = path.resolve(config.root, '.' + decodeURIComponent(pathname));
		assert(filename.startsWith(config.root + path.sep));
		const bytes = await fs.readFile(filename),
			key = path.relative(config.root, filename).split(path.sep).join('/'),
			metadata = { bytes: bytes.length, sha256: hash(bytes) };
		if (served.has(key))
			assert.deepEqual(served.get(key), metadata, 'Source changed during check');
		served.set(key, metadata);
		res.setHeader('Content-Type', mime[path.extname(filename)] ?? 'application/octet-stream');
		res.end(bytes);
	} catch (error) {
		missing.push({ url: req.url, error: error.message });
		res.writeHead(404).end(error.message);
	}
});
(async () => {
	let failure;
	try {
		await new Promise((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', resolve);
		});
		const origin = 'http://127.0.0.1:' + server.address().port;
		for (const name of engines) {
			const browser = await { chromium, webkit }[name].launch({
				headless: true,
				...(name === 'chromium' ? { args: ['--mute-audio'] } : {}),
			});
			try {
				results.push(await check(browser, name, origin));
			} catch (error) {
				results.push(error.receipt ?? { browser: name, passed: false, error: error.stack });
				throw error;
			} finally {
				await browser.close();
			}
		}
		assert.deepEqual(missing, []);
		assert.deepEqual(external, []);
		assert.deepEqual(httpErrors, []);
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
		httpErrors,
		expectedBlockedMonaco: blockedMonaco,
		assets: Object.fromEntries([...served].sort(([a], [b]) => a.localeCompare(b))),
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
