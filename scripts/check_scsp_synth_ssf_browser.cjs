// SPDX-License-Identifier: BSD-3-Clause
// Exercise the public SSF folder workflow with real WASM and muted speakers.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { chromium, webkit } = require('playwright');

const repo = path.resolve(__dirname, '..');
const config = {
	root: path.join(repo, 'docs'),
	entry: '/synth-scsp/index.html',
	engines: 'chromium,webkit',
	out: path.join(tmpdir(), 'scsp-synth-ssf-browser.json'),
	screenshots: path.join(tmpdir(), 'scsp-synth-ssf-browser'),
	'real-set': '',
};
for (const argument of process.argv.slice(2)) {
	const match = /^--(root|entry|engines|out|screenshots|real-set)=(.+)$/.exec(argument);
	assert(match, 'Unknown argument ' + argument);
	config[match[1]] = match[2];
}
config.root = path.resolve(config.root);
if (config['real-set']) config['real-set'] = path.resolve(config['real-set']);
assert(config.entry.startsWith('/') && !/[?#]/.test(config.entry));
const engines = config.engines.split(',');
assert(engines.length && engines.every((name) => ['chromium', 'webkit'].includes(name)));
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
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
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
};
async function until(predicate, label, timeout = 25000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await wait(30);
	}
	throw new Error('Timeout waiting for ' + label);
}

function installSilentAudit() {
	const Context = window.AudioContext ?? window.webkitAudioContext;
	const Worklet = window.AudioWorkletNode,
		connect = AudioNode.prototype.connect;
	const contexts = [],
		worklets = [],
		meters = [],
		buffers = [],
		sourceSamples = [];
	const copyToChannel = AudioBuffer.prototype.copyToChannel;
	AudioBuffer.prototype.copyToChannel = function (source, channel, ...args) {
		if (channel === 0 && this.sampleRate === 44100 && this.length <= 256) {
			sourceSamples.push(Array.from(source));
			if (sourceSamples.length > 32) sourceSamples.shift();
		}
		return copyToChannel.call(this, source, channel, ...args);
	};
	window.AudioContext = class extends Context {
		constructor(...args) {
			super(...args);
			contexts.push(this);
		}
		createBuffer(...args) {
			const buffer = super.createBuffer(...args);
			buffers.push({ frames: buffer.length, rate: buffer.sampleRate });
			return buffer;
		}
	};
	if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
	window.AudioWorkletNode = class extends Worklet {
		constructor(context, name, ...args) {
			super(context, name, ...args);
			worklets.push({ node: this, name });
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
		meters.push({ analyser, mute, context: this.context });
		return destination;
	};
	function output() {
		const values = meters
			.map(({ analyser, context }) => {
				const samples = new Float32Array(analyser.fftSize);
				analyser.getFloatTimeDomainData(samples);
				let peak = 0,
					square = 0,
					crossings = 0;
				for (let index = 0; index < samples.length; index++) {
					const value = samples[index];
					peak = Math.max(peak, Math.abs(value));
					square += value * value;
					if (index && samples[index - 1] <= 0 && value > 0) crossings++;
				}
				return {
					peak,
					rms: Math.sqrt(square / samples.length),
					finite: samples.every(Number.isFinite),
					frequency: (crossings * context.sampleRate) / samples.length,
				};
			})
			.sort((first, second) => second.rms - first.rms);
		return {
			...(values[0] ?? { peak: 0, rms: 0, finite: true, frequency: 0 }),
			muted: meters.every(({ mute }) => mute.gain.value === 0),
		};
	}
	window.__scspSsfAudit = {
		output,
		resetSource: () => {
			sourceSamples.length = 0;
		},
		source: () => {
			const samples = sourceSamples.flat();
			let crossings = 0;
			for (let index = 1; index < samples.length; index++)
				if (samples[index - 1] <= 0 && samples[index] > 0) crossings++;
			return {
				frames: samples.length,
				finite: samples.every(Number.isFinite),
				frequency: samples.length ? (crossings * 44100) / samples.length : 0,
			};
		},
		graph: () => ({
			contexts: contexts.length,
			destinationEdges: meters.length,
			muted: meters.every(({ mute }) => mute.gain.value === 0),
			worklets: worklets.map(({ name }) => name),
			buffers: buffers.length,
			maxBufferFrames: Math.max(0, ...buffers.map((buffer) => buffer.frames)),
			bufferRates: [...new Set(buffers.map((buffer) => buffer.rate))],
		}),
	};
}
const graph = (page) => page.evaluate(() => __scspSsfAudit.graph());
const view = (page) =>
	page.evaluate(() => ({
		status: document.getElementById('status').textContent,
		song: document.getElementById('scspSongStatus').textContent,
		selected: document.getElementById('scspSongSelect').value,
		position: Number(document.getElementById('scspSongSeek').value),
		duration: Number(document.getElementById('scspSongSeek').max),
		pause: document.getElementById('scspSongPause').textContent,
		playDisabled: document.getElementById('scspSongPlay').disabled,
		stopDisabled: document.getElementById('scspSongStop').disabled,
		code: document.getElementById('synthCodeState').textContent,
		codeError: document.getElementById('synthCodeError').textContent,
		file: document.getElementById('scspFilesSelected').textContent,
	}));
async function pcm(page, audible = true, timeout = 25000) {
	let result;
	await until(
		async () => {
			result = await page.evaluate(() => __scspSsfAudit.output());
			return (
				result.muted &&
				result.finite &&
				(audible ? result.rms > 0.0001 : result.peak < 1e-7)
			);
		},
		audible ? 'finite final Master PCM' : 'final Master silence',
		timeout,
	);
	return result;
}
async function setVolume(page, value) {
	await page.locator('#volume').evaluate((input, next) => {
		input.value = String(next);
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}, value);
}
async function sourceFrequency(page) {
	await until(
		() => page.evaluate(() => __scspSsfAudit.source().frames >= 4096),
		'4096 native PCM frames',
	);
	const source = await page.evaluate(() => __scspSsfAudit.source());
	assert(source.finite);
	return source.frequency;
}
async function openMenu(page) {
	if (!(await page.locator('#synthMenu').evaluate((menu) => menu.open)))
		await page.click('#synthMenuButton');
}
async function importFolder(page, folder) {
	await openMenu(page);
	const chooser = page.waitForEvent('filechooser');
	await page.click('#loadSsfFolder');
	await (await chooser).setFiles(folder);
	// Files publishes the new song options before persisting the import and
	// loading its initial entry. Wait for that complete public workflow before
	// the next test action, or the import's later auto-selection can win.
	await until(async () => {
		const state = await view(page);
		return (await page.locator('#scspFilesPanel').getAttribute('aria-busy')) === 'false' &&
			state.selected && !state.playDisabled &&
			state.status === 'SCSP reference song loaded · ' + state.selected;
	}, 'folder import and initial song load');
}
async function importSingle(page, name, bytes) {
	await openMenu(page);
	const chooser = page.waitForEvent('filechooser');
	await page.click('#loadSsf');
	await (
		await chooser
	).setFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
	await until(
		() =>
			page
				.locator('#scspSongSelect option')
				.evaluateAll(
					(options, value) => options.some((option) => option.value === value),
					'/ssf/' + name,
				),
		'import ' + name,
	);
}
async function chooseSong(page, filePath) {
	await page.selectOption('#scspSongSelect', filePath);
	await until(
		() => view(page).then((state) => state.selected === filePath && !state.playDisabled),
		'ready song ' + filePath,
	);
}
async function seek(page, seconds) {
	await page.locator('#scspSongSeek').evaluate((input, value) => {
		input.value = String(value);
		input.dispatchEvent(new Event('change', { bubbles: true }));
	}, seconds);
	await until(
		() =>
			view(page).then(
				(state) =>
					!state.song.startsWith('Seeking') && Math.abs(state.position - seconds) < 0.05,
			),
		'seek ' + seconds,
	);
}
async function selectFile(page, filePath) {
	if (await page.locator('#scspFilesPanel').isHidden()) await page.click('#scspFilesToggle');
	await until(() => page.locator('#scspFileNewButton').isEnabled(), 'Files ready');
	const parts = filePath.split('/').filter(Boolean);
	for (let length = 1; length < parts.length; length++) {
		const parent = '/' + parts.slice(0, length).join('/');
		const summary = page.locator(
			'#scspFilesTree summary[data-file-path=' + JSON.stringify(parent) + ']',
		);
		if ((await summary.count()) && !(await summary.evaluate((node) => node.parentElement.open)))
			await summary.click();
	}
	const selected = page.locator(
		'#scspFilesTree button.file-entry[data-file-path=' + JSON.stringify(filePath) + ']',
	);
	await selected.click();
	await until(
		() => view(page).then((state) => state.file === filePath),
		'Files selection ' + filePath,
	);
}
async function exportSelected(page) {
	await openMenu(page);
	const event = page.waitForEvent('download');
	await page.click('#scspFileExportButton');
	return fs.readFile(await (await event).path());
}
async function originalFixture(base) {
	const { createScspSsfPlaybackFixture, ssfFromProgram } = await import(
		pathToFileURL(path.join(repo, 'test/helpers/scsp_ssf_fixture.mjs')).href
	);
	const fixture = createScspSsfPlaybackFixture();
	const folder = path.join(base, 'Original SSF');
	await fs.mkdir(path.join(folder, 'lib'), { recursive: true });
	const standalone = ssfFromProgram(
		fixture.image,
		0,
		'title=Tetorica original standalone\nartist=Tetorica\nlength=0:08\nfade=0:00.25\n',
	);
	const unknown = ssfFromProgram(fixture.image, 0, 'title=Tetorica original unknown length\n');
	const originals = new Map([
		['00-standalone.ssf', standalone],
		['10-mini.minissf', fixture.mini],
		['20-unknown.ssf', unknown],
		['lib/driver.ssflib', fixture.library],
	]);
	for (const [name, bytes] of originals) await fs.writeFile(path.join(folder, name), bytes);
	await fs.writeFile(
		path.join(folder, 'README.txt'),
		'Original test files for SCSP SSF browser verification.\n',
	);
	const badCrc = standalone.slice();
	badCrc[16] ^= 0x80;
	const missingLibrary = ssfFromProgram(Uint8Array.of(1), 0x40, '_lib=never-present.ssflib\n');
	return { folder, originals, badCrc, missingLibrary, root: '/ssf/Original SSF/' };
}
async function createPage(browser, origin) {
	const page = await browser.newPage({
		acceptDownloads: true,
		viewport: { width: 1250, height: 1000 },
	});
	page.setDefaultTimeout(25000);
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.route('**/*', (route) => {
		const url = new URL(route.request().url());
		if (url.hostname !== '127.0.0.1') {
			if (/monaco|jsdelivr/.test(url.href)) blockedMonaco.push(url.href);
			else external.push(url.href);
			return route.abort();
		}
		return route.continue();
	});
	await page.addInitScript(installSilentAudit);
	await page.goto(origin + config.entry);
	await until(
		() =>
			page
				.locator('#scspFilesPanel')
				.getAttribute('aria-busy')
				.then((value) => value === 'false'),
		'initial Files restore',
	);
	return { page, errors };
}
async function check(browser, engine, origin, fixture) {
	const { page, errors } = await createPage(browser, origin);
	const checks = [],
		measurements = {};
	let stage = 'folder import';
	try {
		await importFolder(page, fixture.folder);
		const standalonePath = fixture.root + '00-standalone.ssf';
		const miniPath = fixture.root + '10-mini.minissf';
		const unknownPath = fixture.root + '20-unknown.ssf';
		await until(
			() =>
				page
					.locator('#scspSongSelect option')
					.evaluateAll(
						(options) => options.filter((option) => option.value).length === 3,
					),
			'three playable entries',
		);
		const paths = await page
			.locator('#scspSongSelect option')
			.evaluateAll((options) => options.map((option) => option.value).filter(Boolean));
		assert.deepEqual(paths.sort(), [standalonePath, miniPath, unknownPath].sort());
		assert(!paths.some((value) => /ssflib|README/i.test(value)));
		await chooseSong(page, standalonePath);
		assert.equal((await graph(page)).contexts, 0);
		checks.push(
			'Folder import keeps SSF and nested SSFLib paths, lists only songs and creates no audio context',
		);

		stage = 'actual playback and Master';
		await page.evaluate(() => __scspSsfAudit.resetSource());
		await page.click('#scspSongPlay');
		await until(
			() => view(page).then((state) => state.song.startsWith('Playing')),
			'playing standalone',
		);
		measurements.standalone = await pcm(page);
		measurements.standaloneNativeHz = await sourceFrequency(page);
		await setVolume(page, 0);
		measurements.zeroMaster = await pcm(page, false);
		await setVolume(page, 0.6);
		measurements.restoredMaster = await pcm(page);
		assert.equal((await graph(page)).contexts, 1);
		checks.push(
			'Executed 68000 and SCSP generate finite PCM through the existing final Master, including exact Master-zero silence',
		);

		stage = 'Pause Resume seek and Stop';
		await page.click('#scspSongPause');
		await until(() => view(page).then((state) => state.pause === 'Resume'), 'Pause');
		await pcm(page, false);
		const frozen = await view(page),
			frozenBuffers = (await graph(page)).buffers;
		await wait(140);
		assert.equal((await view(page)).position, frozen.position);
		assert.equal((await graph(page)).buffers, frozenBuffers);
		await seek(page, 0.5);
		assert.equal((await view(page)).pause, 'Resume');
		await page.click('#scspSongPause');
		await pcm(page);
		await page.click('#scspSongStop');
		await pcm(page, false);
		assert.equal((await view(page)).position, 0);
		checks.push(
			'Pause freezes playback and PCM generation, Resume continues, seek rebuilds the sound machine and Stop returns to zero',
		);

		stage = 'MiniSSF pitch overlay and metadata';
		await chooseSong(page, miniPath);
		assert.equal((await view(page)).duration, 2.25);
		await page.evaluate(() => __scspSsfAudit.resetSource());
		await page.click('#scspSongPlay');
		measurements.mini = await pcm(page);
		measurements.miniNativeHz = await sourceFrequency(page);
		assert(measurements.miniNativeHz < measurements.standaloneNativeHz * 0.7);
		assert(measurements.miniNativeHz > measurements.standaloneNativeHz * 0.3);
		await page.click('#scspSongPause');
		await pcm(page, false);
		await chooseSong(page, unknownPath);
		assert.equal((await view(page)).duration, 180);
		assert.match((await view(page)).song, /3-minute|length/i);
		checks.push(
			'MiniSSF library overlay changes the actual oscillator pitch, length/fade set duration and an absent length uses the visible three-minute preview',
		);

		stage = 'invalid source replacement';
		await chooseSong(page, standalonePath);
		await page.click('#scspSongPlay');
		await pcm(page);
		await importSingle(page, 'bad-crc.ssf', fixture.badCrc);
		await until(
			() => view(page).then((state) => state.status.includes('CRC-32 mismatch')),
			'CRC rejection',
		);
		assert.equal((await view(page)).selected, standalonePath);
		assert((await view(page)).song.startsWith('Playing'));
		await pcm(page);
		await importSingle(page, 'empty.ssf', new Uint8Array());
		await until(
			() => view(page).then((state) => state.status.includes('expected an SSF file')),
			'empty-file rejection',
		);
		assert.equal((await view(page)).selected, standalonePath);
		await pcm(page);
		await importSingle(page, 'missing-library.minissf', fixture.missingLibrary);
		await until(
			() => view(page).then((state) => state.status.includes('missing SSFLib')),
			'missing library rejection',
		);
		assert.equal((await view(page)).selected, standalonePath);
		await pcm(page);
		await page.click('#scspSongStop');
		await chooseSong(page, miniPath);
		checks.push(
			'CRC, empty-file and missing-library failures preserve the previous playing source, and later valid selections still succeed',
		);

		stage = 'original file export';
		for (const name of ['00-standalone.ssf', '10-mini.minissf', 'lib/driver.ssflib']) {
			await selectFile(page, fixture.root + name);
			assert.deepEqual(await exportSelected(page), Buffer.from(fixture.originals.get(name)));
		}
		checks.push('Files exports the exact original standalone, MiniSSF and nested SSFLib bytes');

		stage = 'Code and SSF exclusion';
		await chooseSong(page, standalonePath);
		await page.click('#scspSongPlay');
		await pcm(page);
		await selectFile(page, '/index.js');
		await page.click('#synthInputCodeTab');
		await page.locator('#synthCodeEditor').waitFor({ state: 'visible' });
		await page
			.locator('#synthCodeEditor')
			.fill(
				"const scsp = await useSoundChip('scsp');\nliveLoop('audit', async () => { await scsp.noteOn(CH1, 'C4'); await beat(8); await scsp.noteOff(CH1); });\n",
			);
		await page.click('#synthCodeRunButton');
		await until(
			() => view(page).then((state) => /Playing|Running/i.test(state.code)),
			'Code Run',
		);
		assert(!(await view(page)).song.startsWith('Playing'));
		await pcm(page);
		await page.click('#scspSongPlay');
		await until(
			() =>
				view(page).then(
					(state) =>
						state.song.startsWith('Playing') && !/Playing|Running/i.test(state.code),
				),
			'SSF replaces Code',
		);
		await pcm(page);
		assert.equal((await view(page)).codeError, '');
		assert.equal((await graph(page)).contexts, 1);
		checks.push(
			'Code Run stops SSF and Play song stops Code while preserving the single shared AudioContext',
		);

		stage = 'keyboard while paused';
		await page.click('#scspSongPause');
		await pcm(page, false);
		const frozenPosition = (await view(page)).position;
		await page.click('#synthInputKeyboardTab');
		await page.locator('#keyboard .key[data-key="z"]').hover();
		await page.mouse.down();
		await pcm(page);
		assert.equal((await view(page)).position, frozenPosition);
		await page.mouse.up();
		await pcm(page, false);
		checks.push('The authored instrument remains playable with the SSF machine paused');

		stage = 'natural end';
		await chooseSong(page, miniPath);
		await page.click('#scspSongPlay');
		await page.click('#scspSongPause');
		await until(() => view(page).then((state) => state.pause === 'Resume'), 'MiniSSF paused');
		await seek(page, 2.05);
		await page.click('#scspSongPause');
		await until(
			() => view(page).then((state) => state.song.startsWith('Ended')),
			'natural SSF end',
		);
		await pcm(page, false);
		const playbackGraph = await graph(page);
		assert.equal(playbackGraph.contexts, 1);
		assert.equal(playbackGraph.destinationEdges, 1);
		assert(playbackGraph.muted);
		assert.equal(playbackGraph.maxBufferFrames, 256);
		assert.deepEqual(playbackGraph.bufferRates, [44100]);
		checks.push(
			'Length plus fade reaches a finite natural end with bounded 256-frame 44.1-kHz buffers',
		);

		stage = 'reload and persistence';
		await wait(350);
		await page.reload();
		await until(
			() =>
				page
					.locator('#scspFilesPanel')
					.getAttribute('aria-busy')
					.then((value) => value === 'false'),
			'restored Files',
		);
		assert.equal((await graph(page)).contexts, 0);
		await chooseSong(page, miniPath);
		assert.equal((await graph(page)).contexts, 0);
		await selectFile(page, fixture.root + 'lib/driver.ssflib');
		assert.deepEqual(
			await exportSelected(page),
			Buffer.from(fixture.originals.get('lib/driver.ssflib')),
		);
		checks.push(
			'Reload restores songs and libraries without starting audio, including a usable valid song after rejected imports',
		);
		assert.deepEqual(errors, []);
		await fs.mkdir(config.screenshots, { recursive: true });
		await page.screenshot({
			path: path.join(config.screenshots, engine + '-ssf.png'),
			fullPage: true,
		});
		return {
			browser: engine,
			passed: true,
			checks,
			measurements,
			playbackGraph,
			graphAfterReload: await graph(page),
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
async function realEntries(directory, relative = '') {
	const result = [];
	for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
		const name = path.posix.join(relative, entry.name);
		if (entry.isDirectory()) result.push(...(await realEntries(directory, name)));
		else if (entry.isFile() && /\.(?:ssf|minissf)$/i.test(name)) result.push(name);
	}
	return result.sort();
}
async function checkRealSet(browser, engine, origin) {
	const { page, errors } = await createPage(browser, origin);
	const songs = [],
		directory = config['real-set'];
	let stage = 'real folder import';
	try {
		const entries = await realEntries(directory);
		assert(entries.length, 'Real SSF set contains no songs');
		await importFolder(page, directory);
		for (const entry of entries) {
			stage = entry;
			const filePath = '/ssf/' + path.basename(directory) + '/' + entry;
			await until(
				() =>
					page
						.locator('#scspSongSelect option')
						.evaluateAll(
							(options, value) => options.some((option) => option.value === value),
							filePath,
						),
				'real entry ' + entry,
			);
			await chooseSong(page, filePath);
			await page.click('#scspSongPlay');
			await until(
				() => view(page).then((state) => state.song.startsWith('Playing')),
				'real song start',
			);
			const measurement = await pcm(page, true, 20000);
			const start = (await view(page)).position;
			await until(
				() => view(page).then((state) => state.position >= start + 0.3),
				'real song time progress',
			);
			await page.click('#scspSongStop');
			await pcm(page, false);
			songs.push({ path: entry, secondsObserved: start + 0.3, measurement });
		}
		const finalGraph = await graph(page);
		assert.equal(finalGraph.contexts, 1);
		assert.equal(finalGraph.destinationEdges, 1);
		assert(finalGraph.muted);
		assert.deepEqual(errors, []);
		return {
			browser: engine,
			passed: true,
			directory,
			songs,
			graph: finalGraph,
			physicalOutputMuted: true,
			listeningPerformed: false,
		};
	} catch (error) {
		error.receipt = {
			browser: engine,
			passed: false,
			realSet: true,
			stage,
			songs,
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
		const bytes = await fs.readFile(filename);
		response.setHeader(
			'Content-Type',
			mime[path.extname(filename)] ?? 'application/octet-stream',
		);
		response.end(bytes);
	} catch (error) {
		missing.push({ url: request.url, error: error.message });
		response.writeHead(404).end();
	}
});
(async () => {
	const temporary = await fs.mkdtemp(path.join(tmpdir(), 'scsp-ssf-browser-'));
	const fixture = await originalFixture(temporary);
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
				if (config['real-set']) results.push(await checkRealSet(browser, engine, origin));
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
		await fs.rm(temporary, { recursive: true, force: true });
	}
	const receipt = {
		schemaVersion: 1,
		passed: !failure,
		root: config.root,
		entry: config.entry,
		physicalOutputMuted: true,
		listeningPerformed: false,
		fixture: [...fixture.originals].map(([name, bytes]) => ({
			name,
			bytes: bytes.length,
			sha256: hash(bytes),
		})),
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
