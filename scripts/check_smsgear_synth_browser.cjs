// SPDX-License-Identifier: BSD-3-Clause
// Source or standalone site. Every physical output passes through zero gain.
const assert = require("node:assert/strict"),
	http = require("node:http"),
	fs = require("node:fs/promises"),
	path = require("node:path");
const { chromium, webkit } = require("playwright");
const args = process.argv.slice(2),
	root = path.resolve(
		args.find((a) => a.startsWith("--root="))?.slice(7) ?? "docs",
	),
	engines = args.includes("--chromium")
		? ["chromium"]
		: ["chromium", "webkit"];
const entry =
	args.find((a) => a.startsWith("--entry="))?.slice(8) ??
	"/synth-smsgear/index.html";
const out = path.resolve(
	args.find((a) => a.startsWith("--out="))?.slice(6) ??
		"build/smsgear-check/browser.json",
);
const mime = {
	".html": "text/html",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".css": "text/css",
	".wasm": "application/wasm",
	".json": "application/json",
	".webp": "image/webp",
};
const server = http.createServer(async (req, res) => {
	try {
		let name = decodeURIComponent(
				new URL(req.url, "http://localhost").pathname,
			),
			file = path.resolve(root, "." + name);
		assert(file.startsWith(root + path.sep));
		if (name.endsWith("/")) file = path.join(file, "index.html");
		res.setHeader(
			"Content-Type",
			mime[path.extname(file)] ?? "application/octet-stream",
		);
		res.end(await fs.readFile(file));
	} catch (error) {
		res.writeHead(404).end(error.message);
	}
});
function mute() {
	const connect = AudioNode.prototype.connect,
		audit = (window.__smsAudit = {
			contexts: [],
			nodes: [],
			meters: [],
			peak: 0,
		});
	const Context = window.AudioContext;
	window.AudioContext = class extends Context {
		constructor(options) {
			super(options);
			audit.contexts.push(this);
		}
	};
	const Worklet = window.AudioWorkletNode;
	window.AudioWorkletNode = class extends Worklet {
		constructor(...args) {
			super(...args);
			audit.nodes.push({ name: args[1], node: this });
		}
	};
	AudioNode.prototype.connect = function (destination, ...args) {
		if (destination !== this.context.destination)
			return connect.call(this, destination, ...args);
		const analyser = this.context.createAnalyser(),
			gain = this.context.createGain();
		gain.gain.value = 0;
		analyser.fftSize = 2048;
		connect.call(this, analyser);
		connect.call(analyser, gain);
		connect.call(gain, destination);
		audit.meters.push({ analyser, gain });
		return destination;
	};
	setInterval(() => {
		for (const { analyser } of audit.meters) {
			const data = new Float32Array(analyser.fftSize);
			analyser.getFloatTimeDomainData(data);
			let mean = 0,
				ss = 0;
			for (const x of data) {
				mean += x;
				ss += x * x;
			}
			audit.peak = Math.max(
				audit.peak,
				Math.sqrt(
					Math.max(0, ss / data.length - (mean / data.length) ** 2),
				),
			);
		}
	}, 20);
}
(async () => {
	const results = [];
	await fs.mkdir(path.dirname(out), { recursive: true });
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		for (const engine of engines) {
			const browser = await { chromium, webkit }[engine].launch({
				headless: true,
				...(engine === "chromium"
					? { args: ["--autoplay-policy=no-user-gesture-required"] }
					: {}),
			});
			try {
				const page = await browser.newPage(),
					errors = [];
				page.on("pageerror", (error) => errors.push(error.message));
				await page.addInitScript(mute);
				await page.route("https://**/*", (route) => route.abort());
				await page.setViewportSize({ width: 1280, height: 1000 });
				await page.goto(
					`http://127.0.0.1:${server.address().port}${entry}`,
				);
				await page.waitForFunction(
					() => !document.getElementById("smsgearSynthMain").inert,
				);
				assert.deepEqual(errors, []);
				assert.equal(
					await page.locator("#psgTab").getAttribute("aria-selected"),
					"true",
				);
				assert.equal(
					await page.evaluate(() => __smsAudit.contexts.length),
					0,
				);
				await page.locator("#startAudio").click();
				await page.waitForFunction(
					() =>
						document.getElementById("startAudio").textContent ===
						"Audio ready",
					{ timeout: 30000 },
				);
				assert.deepEqual(errors, []);
				await page.keyboard.down("a");
				await page.waitForFunction(() => __smsAudit.peak > 0.0001);
				await page.keyboard.up("a");
				await page.screenshot({
					path: out.replace(/\.json$/, `-${engine}-desktop.png`),
					fullPage: false,
				});
				await page.locator("#opllTab").click();
				await page.keyboard.down("a");
				await page.waitForTimeout(250);
				await page.keyboard.up("a");
				await page.locator("#smsgearFilesToggle").click();
				await page.waitForFunction(
					() => !document.getElementById("smsgearFilesPanel").hidden,
				);
				assert(await page.locator("#smsgearFilesPanel").innerText());
				await page.locator("#synthInputCodeTab").click();
				await page.waitForFunction(
					() =>
						!document.getElementById("synthCodeRunButton").disabled,
				);
				await page.locator("#synthCodeRunButton").click();
				await page.waitForFunction(
					() =>
						document.getElementById("synthCodeStopButton")
							.disabled === false,
				);
				await page.waitForTimeout(500);
				assert.equal(
					await page.locator("#synthCodeError").textContent(),
					"",
				);
				await page.locator("#synthInputKeyboardTab").click();
				assert.equal(
					await page.locator("#synthCodeStopButton").isDisabled(),
					false,
				);
				await page.locator("#synthCodeStopButton").click();
				await page.locator("#synthWorkspaceCodeButton").click();
				await page.waitForFunction(() =>
					document
						.getElementById("synthWorkspace")
						.classList.contains("is-code-expanded"),
				);
				await page.locator("#psgTab").click();
				assert.equal(
					await page
						.locator("#synthWorkspace")
						.evaluate((n) =>
							n.classList.contains("is-code-expanded"),
						),
					true,
				);

				// Import is passive; reference playback owns a separate renderer only while requested.
				const { createDemoVgm } = await import(
					"../docs/synth-smsgear/fixtures.js"
				);
				await page.locator("#synthWorkspaceSynthButton").click();
				await page
					.locator("#vgmFileInput")
					.setInputFiles({
						name: "original-demo.vgm",
						mimeType: "application/octet-stream",
						buffer: Buffer.from(createDemoVgm()),
					});
				await page.waitForFunction(
					() => !document.getElementById("songPlay").disabled,
				);
				assert.equal(
					await page.locator("#songPause").isDisabled(),
					true,
					"Import does not play",
				);
				await page.locator("#psgTab").click();
				await page.locator("#songPlay").click();
				await page.waitForFunction(
					() => !document.getElementById("songPause").disabled,
				);
				await page.waitForTimeout(160);
				await page.locator("#songPause").click();
				await page.waitForFunction(
					() =>
						document.getElementById("songPause").textContent ===
						"Resume",
				);
				const capture = () =>
					page.evaluate(
						() =>
							new Promise((resolve, reject) => {
								const node = __smsAudit.nodes
										.filter(
											(n) =>
												n.name ===
												"tetorica-smsgear-song",
										)
										.at(-1).node,
									id = "audit:" + Math.random();
								const timeout = setTimeout(
									() => reject(Error("snapshot timeout")),
									3000,
								);
								const listener = ({ data }) => {
									if (data.id !== id) return;
									clearTimeout(timeout);
									node.port.removeEventListener(
										"message",
										listener,
									);
									data.error
										? reject(Error(data.error))
										: resolve(data.value);
								};
								node.port.addEventListener("message", listener);
								node.port.start();
								node.port.postMessage({
									id,
									method: "snapshot",
								});
							}),
					);
				const frozen = await capture();
				assert.equal(
					frozen.playing,
					false,
					"Worklet acknowledged Pause",
				);
				await page.keyboard.down("a");
				await page.waitForTimeout(150);
				await page.keyboard.up("a");
				const afterAudition = await capture();
				assert.equal(
					afterAudition.frame,
					frozen.frame,
					"Paused audition does not advance reference",
				);
				await page.locator("#captureSound").click();
				assert.equal(
					await page.locator("#songPause").textContent(),
					"Resume",
					"Capture keeps paused transport",
				);
				assert.equal(
					await page.locator("#songView").inputValue(),
					"synth",
				);
				const sourceCount = await page
					.locator("#songSelect option")
					.count();
				assert(sourceCount > 0);
				await page.locator("#songPause").click();
				await page.waitForFunction(
					() =>
						document.getElementById("songPause").textContent ===
						"Pause",
				);
				assert((await capture()).frame >= frozen.frame);
				await page.locator("#songStop").click();
				await page.waitForFunction(
					() => document.getElementById("songPause").disabled,
				);
				const before = await page.locator("#soundName").inputValue();
				await page
					.locator("#vgmFileInput")
					.setInputFiles({
						name: "bad.vgm",
						mimeType: "application/octet-stream",
						buffer: Buffer.from("not a VGM"),
					});
				await page.waitForFunction(
					() =>
						document.getElementById("audioStatus").textContent !==
						"",
				);
				await page.waitForTimeout(200);
				assert.equal(
					await page.locator("#soundName").inputValue(),
					before,
				);
				await page.setViewportSize({ width: 390, height: 844 });
				await page.screenshot({
					path: out.replace(/\.json$/, `-${engine}-mobile.png`),
					fullPage: false,
				});
				assert(
					await page.evaluate(
						() =>
							document.documentElement.scrollWidth <= innerWidth,
					),
					"Mobile page overflows: " +
						JSON.stringify(
							await page.evaluate(() =>
								[...document.querySelectorAll("body *")]
									.filter(
										(n) =>
											n.getBoundingClientRect().right >
												innerWidth + 1 &&
											!n.closest("[hidden]"),
									)
									.slice(0, 10)
									.map((n) => ({
										id: n.id,
										tag: n.tagName,
										cls: n.className,
										width: n.getBoundingClientRect().width,
									})),
							),
						),
				);
				await page.screenshot({
					path: out.replace(/\.json$/, `-${engine}.png`),
					fullPage: false,
				});
				assert.deepEqual(errors, []);
				assert(
					await page.evaluate(() =>
						__smsAudit.meters.every((m) => m.gain.gain.value === 0),
					),
				);
				results.push({
					engine,
					passed: true,
					peak: await page.evaluate(() => __smsAudit.peak),
					muted: true,
				});
				console.log(engine + " passed (muted)");
				await page.close();
			} finally {
				await browser.close();
			}
		}
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
	await fs.mkdir(path.dirname(out), { recursive: true });
	await fs.writeFile(
		out,
		JSON.stringify({ passed: true, results }, null, 2) + "\n",
	);
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
