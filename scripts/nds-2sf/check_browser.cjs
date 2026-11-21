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
const docs = path.join(root, 'docs');
const { values: options } = parseArgs({ options: {
	engines: { type: 'string', default: 'chromium,webkit' },
	'real-folder': { type: 'string' },
} });
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
	window.twoSfAudit = () => ({
		contexts: contexts.length,
		currentTime: contexts.at(-1)?.currentTime ?? 0,
		contextState: contexts.at(-1)?.state ?? 'idle',
		outputs: monitored.length,
		muted: monitored.every(({ mute }) => mute.gain.value === 0),
		channels: monitored.at(-1)?.meters.map(measure) ?? [],
	});
}

const output = (page) => page.evaluate(() => window.twoSfAudit());
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

async function measureSide(page, side, pitch) {
	const { channels } = await until(() => output(page), (state) => {
		const signal = state.channels[side], other = state.channels[1 - side];
		return state.muted && signal && other && signal.rms > 0.005 && other.rms < signal.rms * 0.04 &&
			Math.abs(signal.pitch - pitch) < 4;
	}, `Expected ${pitch} Hz on the ${side === 0 ? 'left' : 'right'} channel`);
	return channels;
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
			const message = await noteStatus.textContent();
			if (source === 'pulse') assert.match(message, /CH (?:9|1[0-4]) · Timer 0x/);
			else if (source === 'noise') assert.match(message, /CH 1[56] · Timer 0x/);
			synthModes.push(source);
		} finally { await page.keyboard.up('6'); }
		await quiet();
	}
	await page.locator('#ndsChannel').selectOption('0');
	assert(await mode.locator('option[value="pulse"]').evaluate(option => option.disabled));
	assert(await mode.locator('option[value="noise"]').evaluate(option => option.disabled));
	const key = page.locator('.key[data-key="6"]');
	await key.hover();
	await page.mouse.down();
	try {
		await tone();
		await page.locator('#ndsPan').evaluate(input => {
			input.value = '127';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await measureSide(page, 1, 261.626);
	} finally { await page.mouse.up(); }
	await quiet();
	await page.locator('#synthInputCodeTab').click();
	const editor = page.locator('#synthCodeEditor');
	await until(() => editor.inputValue(), value => value.includes('useSoundChip("nds")'), 'DS starter JavaScript');
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
		await page.goto(`${origin}/synth-nitro-ds/index.html`);

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
		await select.selectOption(fixtureChoice('left-a4'));
		await play.click();
		const left = await measureSide(page, 0, 440);
		await pause.click();
		const freeze = await until(() => output(page), (state) => state.contextState === 'suspended', 'Paused audio context expected');
		const pausedPosition = await readPosition(page);
		await wait(200);
		assert.equal((await output(page)).currentTime, freeze.currentTime);
		assert.equal(await readPosition(page), pausedPosition);
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
		await pause.click();
		await until(() => output(page), (state) => state.currentTime > freeze.currentTime + 0.04, 'Playback clock should resume');
		await measureSide(page, 0, 440);
		await stop.click();
		await until(() => output(page), (state) => state.channels.every(({ peak }) => peak < 1e-7), 'Stop should silence the output');

		await importFiles(page, '#loadTwoSfFolder', fixture);
		const restored = await until(() => tracks(page), (entries) => entries.some(({ value, label }) =>
			value.includes('right-e5') || label.includes('right-e5')), 'Original folder should be selectable again');
		await select.selectOption(restored.find(({ value, label }) => value.includes('right-e5') || label.includes('right-e5')).value);
		await play.click();
		const right = await measureSide(page, 1, 659.255);
		await stop.click();

		let realSongs = null;
		if (realFolder) {
			await page.reload();
			await importFiles(page, '#loadTwoSfFolder', realFolder);
			const realTracks = await until(() => tracks(page), (entries) => entries.length === 71, '71 tracks expected from the local set', 30000);
			await select.selectOption(realTracks[0].value);
			await play.click();
			await until(() => output(page), (state) => state.muted && state.channels.some(({ rms }) => rms > 0.0001), 'Expected playback from the local 2SF set', 30000);
			await stop.click();
			realSongs = realTracks.length;
		}
		const audit = await output(page);
		assert(audit.muted && audit.outputs > 0);
		const synthModes = await checkSynth(page);
		assert.deepEqual(errors, []);
		assert.deepEqual(fetchFailures, []);
		return { browser: name, left, right, realSongs, synthModes, physicalOutputMuted: true };
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
			const file = path.resolve(docs, `.${requested}`);
			assert(file.startsWith(docs + path.sep));
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
