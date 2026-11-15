// SPDX-License-Identifier: BSD-3-Clause
// Real SCSP SSF Live inspector checks. Every physical destination is muted.
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
	out: path.join(tmpdir(), 'scsp-synth-live-browser.json'),
	screenshots: path.join(tmpdir(), 'scsp-synth-live-browser'),
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
		if (data?.method) commands.push({ method: data.method, args: data.args });
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
	const page = await browser.newPage({ viewport: { width: 1240, height: 1100 } });
	page.setDefaultTimeout(25000);
	const errors = [],
		checks = [],
		measurements = {};
	let stage = 'initial layout';
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
		assert(await page.locator('#scspSsfLiveEnabled').isChecked());
		assert.equal((await graph(page)).contexts, 0);
		assert.equal(await page.locator('#voice canvas').count(), 1);
		assert.match(
			await page.locator('.product-icon').getAttribute('src'),
			/tetorica-scsp-synth\.webp$/,
		);
		checks.push(
			'Live defaults On with one source waveform canvas and no audio created before Play',
		);

		stage = 'prepare authored sound';
		await page.click('[data-chip-action="scsp-square"]');
		await page.click('[data-chip-action="scsp-apply"]');
		await until(
			() => page.locator('[data-chip-action="scsp-apply"]').isDisabled(),
			'authored square applied',
		);
		await control(page, 'attackRate').fill('19');
		await control(page, 'attackRate').dispatchEvent('change');
		await control(page, 'totalLevel').fill('18');
		await control(page, 'totalLevel').dispatchEvent('change');
		const appliedWave = await canvas(page);
		const sourceCanvas = page.locator('#voice canvas');
		await sourceCanvas.scrollIntoViewIfNeeded();
		const drawingBounds = await sourceCanvas.boundingBox();
		await page.mouse.move(drawingBounds.x + 12, drawingBounds.y + 20);
		await page.mouse.down();
		await page.mouse.move(
			drawingBounds.x + drawingBounds.width / 2,
			drawingBounds.y + drawingBounds.height - 20,
			{ steps: 8 },
		);
		await page.mouse.up();
		await control(page, 'root').fill('500');
		await control(page, 'root').dispatchEvent('change');
		assert(await page.locator('[data-chip-action="scsp-apply"]').isEnabled());
		const authoredWave = await canvas(page);
		assert.notEqual(authoredWave, appliedWave);
		await load(page, 'live-driver.ssf', fixture.bytes);
		assert.equal((await graph(page)).contexts, 0);
		assert((await view(page)).liveVisible);
		assert.equal(await page.locator('#scspSsfSlots [data-ssf-slot]').count(), 32);
		checks.push('Loading SSF silently reveals 32 physical slot controls');

		stage = 'Live activity and changing values';
		await page.click('#scspSongPlay');
		measurements.playing = await pcm(page);
		await until(
			() =>
				view(page).then(
					(value) =>
						value.liveActive === 'true' &&
						value.activity[0]?.active === 'true' &&
						value.activity[1]?.active === 'true',
				),
			'two active native slots',
		);
		await selectSlot(page, 0);
		await until(
			() =>
				control(page, 'attackRate')
					.inputValue()
					.then((value) => value === '31'),
			'Slot 1 attack',
		);
		assert.equal(await control(page, 'bits').inputValue(), '16');
		assert.equal(await control(page, 'lfo-frequencyCode').inputValue(), '10');
		assert.equal(await control(page, 'lfo-pitchWave').inputValue(), '1');
		assert.equal(await control(page, 'lfo-pitchDepth').inputValue(), '2');
		const levels = new Set(),
			waveforms = new Set();
		await until(async () => {
			levels.add(await control(page, 'totalLevel').inputValue());
			waveforms.add(await canvas(page));
			return levels.has('12') && levels.has('36') && waveforms.size > 1;
		}, 'CPU-driven Slot 1 TL and waveform changes');
		assert.notEqual(await canvas(page), authoredWave);
		let authoredState = await authoring(page);
		assert.equal((await graph(page)).contexts, 1);
		assert.equal((await graph(page)).destinationEdges, 1);
		checks.push(
			'Two active physical slots and CPU parameter / RAM updates appear through the existing panel',
		);

		stage = 'Pause freeze and slot switching';
		await page.click('#scspSongPause');
		await until(() => view(page).then((value) => value.pause === 'Resume'), 'paused');
		await pcm(page, false);
		const first = await view(page),
			firstWave = await canvas(page);
		assert(
			Number(first.frame) <= Math.round((first.position + 0.005) * 44100) + 1,
			'snapshot is at or before the rounded audible-position UI',
		);
		await wait(180);
		assert.equal((await view(page)).frame, first.frame);
		assert.equal((await view(page)).position, first.position);
		assert.equal(await canvas(page), firstWave);
		await selectSlot(page, 1);
		await until(
			() =>
				control(page, 'attackRate')
					.inputValue()
					.then((value) => value === '27'),
			'Slot 2 attack',
		);
		assert.equal(await control(page, 'bits').inputValue(), '8');
		assert.equal(await control(page, 'totalLevel').inputValue(), '32');
		assert.equal(await control(page, 'lfo-frequencyCode').inputValue(), '21');
		assert.equal(await control(page, 'lfo-pitchWave').inputValue(), '3');
		assert.equal(await control(page, 'lfo-pitchDepth').inputValue(), '4');
		assert(['6', '22'].includes(await control(page, 'pan').inputValue()));
		assert.match(
			await page.locator('#voice .scsp-ssf-modulation').textContent(),
			/MDL.*0.*X stack offset.*63.*Y stack offset.*31.*Inhibit stack write.*On/s,
		);
		assert.equal((await view(page)).frame, first.frame);
		assert.notEqual(await canvas(page), firstWave);
		await selectSlot(page, 0);
		assert.equal((await view(page)).frame, first.frame);
		assert.equal(await canvas(page), firstWave);
		checks.push(
			'Pause fixes one native snapshot and switching slots reads the same frame and RAM',
		);

		stage = 'readonly controls and waveform';
		for (const name of ['attackRate', 'totalLevel', 'lfo-frequencyCode', 'bits', 'sample'])
			assert(await control(page, name).isDisabled(), name + ' is read-only');
		assert(await page.locator('[data-chip-action="scsp-apply"]').isDisabled());
		await control(page, 'attackRate').evaluate((input) => {
			input.value = '0';
			input.dispatchEvent(new Event('change', { bubbles: true }));
		});
		const wave = page.locator('#voice canvas');
		await wave.scrollIntoViewIfNeeded();
		const bounds = await wave.boundingBox();
		await page.mouse.move(bounds.x + 20, bounds.y + 20);
		await page.mouse.down();
		await page.mouse.move(bounds.x + bounds.width - 20, bounds.y + bounds.height - 20, {
			steps: 4,
		});
		await page.mouse.up();
		assert.equal(await authoring(page), authoredState);
		assert.equal(await canvas(page), firstWave);
		assert.equal(await page.getByRole('button', { name: /Capture/i }).count(), 0);
		checks.push(
			'Read-only controls and drawing keep the authored patch and captured native waveform intact',
		);

		stage = 'Live Off and resume';
		await page.uncheck('#scspSsfLiveEnabled');
		await until(
			() =>
				control(page, 'attackRate')
					.inputValue()
					.then((value) => value === '19'),
			'authored attack restored',
		);
		assert(await control(page, 'attackRate').isEnabled());
		assert.equal(await control(page, 'totalLevel').inputValue(), '18');
		assert.equal(await canvas(page), authoredWave);
		assert.equal(await control(page, 'root').inputValue(), '500');
		assert(await page.locator('[data-chip-action="scsp-apply"]').isEnabled());
		assert.equal((await view(page)).pause, 'Resume');
		await page.click('[data-chip-action="scsp-apply"]');
		await until(
			() => page.locator('[data-chip-action="scsp-apply"]').isDisabled(),
			'preserved draft applied',
		);
		const applied = await page.evaluate(async () => {
			const result = await __scspLiveAudit.read();
			return result.operators[0];
		});
		assert.equal(applied.sample.rootFrequencyHz, 500);
		assert(applied.pcm[30] < -16000, 'unapplied drawing reached PCM memory');
		authoredState = await authoring(page);
		await page.check('#scspSsfLiveEnabled');
		await until(
			() => view(page).then((value) => value.liveActive === 'true'),
			'Live reenabled',
		);
		assert.equal((await view(page)).frame, first.frame);
		await page.click('#scspSongPause');
		await pcm(page);
		await until(
			() => view(page).then((value) => Number(value.frame) > Number(first.frame)),
			'Live timeline resumes',
		);
		checks.push(
			'Live Off restores the unapplied waveform and tuning draft, Apply retains the drawing, and Resume keeps the paused song',
		);

		stage = 'narrow layout';
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
				fullPage: false,
			});
		}
		await page.setViewportSize({ width: 1240, height: 1100 });
		checks.push('Live controls remain within 1240 px and 390 px viewports');

		stage = 'Stop restores editing and keyboard';
		await page.click('#scspSongStop');
		await pcm(page, false);
		await until(() => control(page, 'attackRate').isEnabled(), 'editor reenabled');
		assert.equal(await control(page, 'attackRate').inputValue(), '19');
		assert.equal(await canvas(page), authoredWave);
		assert.equal(await authoring(page), authoredState);
		await page.click('#synthInputKeyboardTab');
		await page.locator('#keyboard .key[data-key="z"]').hover();
		await page.mouse.down();
		measurements.keyboard = await pcm(page);
		await page.mouse.up();
		await pcm(page, false);
		checks.push('Stop restores the authored controls and keyboard sound');

		stage = 'natural end and VGM selection';
		await page.click('#scspSongPlay');
		await until(
			() => view(page).then((value) => value.liveActive === 'true'),
			'Live restarted',
		);
		await page.click('#scspSongPause');
		await until(
			() => view(page).then((value) => value.pause === 'Resume'),
			'paused before seek',
		);
		await page.locator('#scspSongSeek').evaluate((input) => {
			input.value = '8.1';
			input.dispatchEvent(new Event('change', { bubbles: true }));
		});
		await until(
			() =>
				view(page).then(
					(value) =>
						!value.song.startsWith('Seeking') && Math.abs(value.position - 8.1) < 0.05,
				),
			'seek near end',
		);
		await page.click('#scspSongPause');
		await until(
			() => view(page).then((value) => value.song.startsWith('Ended')),
			'natural end',
		);
		await pcm(page, false);
		assert(await control(page, 'attackRate').isEnabled());
		assert.equal(await control(page, 'attackRate').inputValue(), '19');
		await page.click('#scspSongDemo');
		await until(() => view(page).then((value) => !value.liveVisible), 'VGM leaves SSF view');
		assert(await control(page, 'attackRate').isEnabled());
		assert.equal(await canvas(page), authoredWave);
		checks.push('Natural end and selecting VGM restore the authored view');

		stage = 'Code after Live';
		await page.click('#synthInputCodeTab');
		await page.locator('#synthCodeEditor').waitFor({ state: 'visible' });
		await until(() => page.locator('#synthCodeEditor').isEditable(), 'Code editor ready');
		await page
			.locator('#synthCodeEditor')
			.fill(
				"const scsp = await useSoundChip('scsp');\nliveLoop('audit', async () => { await scsp.noteOn(CH1, 'C4'); await beat(8); await scsp.noteOff(CH1); });\n",
			);
		await page.click('#synthCodeRunButton');
		await until(
			() => view(page).then((value) => /Playing|Running/.test(value.code)),
			'Code running',
		);
		measurements.code = await pcm(page);
		await page.click('#synthCodeStopButton');
		await pcm(page, false);
		assert.equal((await graph(page)).contexts, 1);
		assert.deepEqual(errors, []);
		checks.push('Code can run after Live inspection using the same editor and AudioContext');
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
	const { createScspSsfLiveFixture } = await import(
		pathToFileURL(path.join(repo, 'test/helpers/scsp_ssf_fixture.mjs')).href
	);
	const fixture = createScspSsfLiveFixture();
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
