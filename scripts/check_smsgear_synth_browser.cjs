// SPDX-License-Identifier: BSD-3-Clause
// Source or standalone site. Every physical output passes through zero gain.
const assert = require("node:assert/strict"),
	http = require("node:http"),
	fs = require("node:fs/promises"),
	path = require("node:path");
const { chromium, webkit } = require("playwright");
const args = process.argv.slice(2),
	withMonaco = args.includes("--monaco"),
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
				if (!withMonaco)
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
				const inspectChip = (kind) =>
					page.evaluate(
						(kind) =>
							new Promise((resolve, reject) => {
								const node = __smsAudit.nodes.find(
										(item) =>
											item.name === "tetorica-" + kind,
									).node,
									id = "pitch-ui:" + Math.random();
								const timeout = setTimeout(
									() =>
										reject(
											Error("Chip inspection timeout"),
										),
									3000,
								);
								const listener = ({ data }) => {
									if (
										data.type !== "chip-inspector-result" ||
										data.id !== id
									)
										return;
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
									type: "chip-inspector",
									id,
									inspectorKind: kind,
									action: "read",
									args: [],
								});
							}),
						kind,
					);
				const inspectOpll = () => inspectChip("ym2413");
				const bend = async (id, value) => {
					await page.locator("#" + id).evaluate((node, value) => {
						node.value = String(value);
						node.dispatchEvent(
							new Event("input", { bubbles: true }),
						);
					}, value);
					await page.waitForTimeout(70);
				};
				await page.keyboard.down("1");
				await page.waitForTimeout(70);
				const psgBefore = (await inspectChip("segapsg")).channels.find(
					(c) => c.active,
				).frequency;
				await bend("pitchBend", 0.5);
				assert(
					(await inspectChip("segapsg")).channels.find(
						(c) => c.active,
					).frequency > psgBefore,
				);
				assert.equal(
					Number(
						await page.locator("#keyboardPitchBend").inputValue(),
					),
					0.5,
				);
				await page.keyboard.up("1");
				await page.keyboard.down("1");
				await page.waitForTimeout(70);
				assert(
					(await inspectChip("segapsg")).channels.some(
						(c) => c.active,
					),
					"Nonzero bend also works on a new note",
				);
				await bend("keyboardPitchBend", -0.5);
				assert(
					(await inspectChip("segapsg")).channels.find(
						(c) => c.active,
					).frequency < psgBefore,
				);
				assert.equal(
					Number(await page.locator("#pitchBend").inputValue()),
					-0.5,
				);
				await page.keyboard.up("1");
				await page.locator("#psgSource").selectOption("noise");
				await page.locator("#noiseRate").selectOption("tone3");
				await page.keyboard.down("1");
				await page.waitForTimeout(70);
				assert((await inspectChip("segapsg")).noise.active);
				await bend("pitchBend", 0.25);
				assert(
					(await inspectChip("segapsg")).channels[2].frequency > 0,
				);
				await page.keyboard.up("1");
				await page.locator("#psgSource").selectOption("tone");
				await bend("pitchBend", 0);
				const wheel = await page
						.locator(".keyboard-wheel")
						.boundingBox(),
					keyboard = await page.locator("#keyboard").boundingBox();
				assert(
					wheel.x + wheel.width <= keyboard.x,
					"Keyboard Pitch stays on the left",
				);

				assert.equal(
					await page.locator("#keyboard .key-row").count(),
					4,
				);
				await page.screenshot({
					path: out.replace(/\.json$/, `-${engine}-desktop.png`),
					fullPage: false,
				});
				await page.locator("#opllTab").click();
				await bend("pitchBend", 0.37);
				await page.keyboard.down("q");
				await page.waitForTimeout(70);
				const fmBefore = (await inspectOpll()).channels.find(
					(c) => c.active,
				).frequency;
				await bend("keyboardPitchBend", -0.37);
				assert(
					(await inspectOpll()).channels.find((c) => c.active)
						.frequency < fmBefore,
				);
				await page.keyboard.up("q");
				await bend("pitchBend", 0);

				assert.equal(
					(await inspectOpll()).rhythm.enabled,
					true,
					"New instruments default to shared Rhythm On",
				);
				assert.equal(
					await page
						.locator('#keyboard [data-key="1"] span')
						.textContent(),
					"BD",
				);
				await page.locator("#stopAudio").click();
				await page.waitForTimeout(150);
				await page.evaluate(() => {
					__smsAudit.peak = 0;
				});
				await page.keyboard.down("1");
				await page.waitForTimeout(100);
				assert(
					(await inspectOpll()).rhythm.bassDrum,
					"Key 1 triggers actual OPLL Bass drum",
				);
				assert(
					await page.evaluate(() => __smsAudit.peak > 0.0001),
					"Default percussion tuning produces audio",
				);
				await page.keyboard.up("1");
				await page.waitForTimeout(50);
				assert.equal((await inspectOpll()).rhythm.bassDrum, false);
				for (const [channel, drums, keys] of [
					["6", ["bassDrum"], ["1"]],
					["7", ["snare", "hiHat"], ["2", "5"]],
					["8", ["tom", "cymbal"], ["3", "4"]],
				]) {
					await page
						.locator(`#channelTabs [data-channel="${channel}"]`)
						.click();
					assert.deepEqual(
						await page
							.locator(
								"#drumControls>div:not([hidden]) [data-drum]",
							)
							.evaluateAll((nodes) =>
								nodes.map((n) => n.dataset.drum),
							),
						drums,
					);
					assert(
						await page.locator("#userPatch").isHidden(),
						"Fixed percussion is not an editable User patch",
					);
					assert.equal(
						await page
							.locator("#keyboard .key:not(:disabled)")
							.count(),
						keys.length,
					);
					for (const key of keys)
						assert(
							!(await page
								.locator(`#keyboard [data-key="${key}"]`)
								.isDisabled()),
						);
				}
				await page.locator('#channelTabs [data-channel="7"]').click();
				await page.keyboard.down("2");
				await page.waitForTimeout(100);
				assert((await inspectOpll()).rhythm.snare);
				await page.keyboard.up("2");
				await page.locator("#keyboard").scrollIntoViewIfNeeded();
				await page.screenshot({
					path: out.replace(/\.json$/, `-${engine}-rhythm-ch.png`),
					fullPage: false,
				});
				await page
					.locator('#channelTabs [data-channel="auto"]')
					.click();
				await page.locator("#fmInstrument").selectOption("0");
				assert.equal(
					await page.locator("#opllEnvelope canvas").count(),
					1,
					"One canvas holds both operators",
				);
				const dragEnvelope = async (handle, dx, dy = 0) => {
					const button = page.locator(
						`#opllEnvelope [data-envelope-handle="${handle}"]`,
					);
					await button.scrollIntoViewIfNeeded();
					await page.waitForTimeout(60);
					const box = await button.boundingBox();
					const x = box.x + box.width / 2,
						y = box.y + box.height / 2;
					await page.mouse.move(x, y);
					await page.mouse.down();
					await page.mouse.move(x + dx, y + dy, { steps: 8 });
					await page.mouse.up();
					await page.waitForTimeout(60);
				};
				for (const op of [0, 1]) {
					await page
						.locator(
							`#opllEnvelope [data-envelope-operator="${op}"]`,
						)
						.click();
					await page.waitForTimeout(50);
					const mult = page.locator(`#op${op}_multi .param-value`),
						original = Number(await mult.textContent());
					await page
						.locator(`#op${op}_multi .param-button`)
						.last()
						.click();
					assert.equal(
						Number(await mult.textContent()),
						original + 1,
					);
					await page.waitForTimeout(60);
					assert.equal(
						(await inspectOpll()).registers[op] & 15,
						original + 1,
						"+ updates the actual operator multiplier",
					);
					await page
						.locator(`#op${op}_multi .param-button`)
						.first()
						.click();
					assert.equal(Number(await mult.textContent()), original);
					await page.waitForTimeout(60);
					assert.equal(
						(await inspectOpll()).registers[op] & 15,
						original,
						"- updates the actual operator multiplier",
					);
					const other = 1 - op,
						priorOther = (await inspectOpll()).registers;
					for (const [handle, field, dx, dy] of [
						["attack", "ar", 35, 0],
						["decay", "dr", 30, 0],
						["sustain", "sl", 0, 20],
						["rate", "rr", 20, 0],
					]) {
						const value = page.locator(
								`#op${op}_${field} .param-value`,
							),
							before = Number(await value.textContent());
						await dragEnvelope(handle, dx, dy);
						const after = Number(await value.textContent());
						assert.notEqual(
							after,
							before,
							`${handle} edits OP${op + 1} ${field}`,
						);
						const registers = (await inspectOpll()).registers,
							packed =
								field === "ar"
									? registers[4 + op] >> 4
									: field === "dr"
										? registers[4 + op] & 15
										: field === "sl"
											? registers[6 + op] >> 4
											: registers[6 + op] & 15;
						assert.equal(
							packed,
							after,
							"Graph edits reach native registers",
						);
						for (const reg of [other, 4 + other, 6 + other])
							assert.equal(
								registers[reg],
								priorOther[reg],
								"The other operator keeps its parameters",
							);
					}
				}
				await page.locator("#fmInstrument").selectOption("1");
				await page.waitForTimeout(60);
				assert(
					await page.locator("#op0_multi .param-value").isDisabled(),
				);
				assert(
					await page
						.locator(
							'#opllEnvelope [data-envelope-handle="attack"]',
						)
						.isDisabled(),
				);
				assert(await page.locator("#editUserPatch").isVisible());
				await page.locator("#editUserPatch").click();
				assert.equal(
					await page.locator("#fmInstrument").inputValue(),
					"0",
				);
				assert(
					!(await page
						.locator("#op0_multi .param-value")
						.isDisabled()),
				);

				await page.screenshot({
					path: out.replace(
						/\.json$/,
						`-${engine}-opll-envelope.png`,
					),
					fullPage: false,
				});
				await page.locator('#channelTabs [data-channel="0"]').click();
				await page.keyboard.down("1");
				await page.waitForTimeout(80);
				assert(
					(await inspectOpll()).channels[0].active,
					"Numbers stay melodic on CH1–6",
				);
				assert.equal((await inspectOpll()).rhythm.bassDrum, false);
				await page.keyboard.up("1");
				await page.locator("#rhythmEnabled .param-value").click();
				await page.waitForTimeout(100);
				assert.equal((await inspectOpll()).rhythm.enabled, false);
				await page.locator('#channelTabs [data-channel="8"]').click();
				await page.locator("#fmInstrument").selectOption("0");
				await page.waitForTimeout(100);
				assert.equal(
					(await inspectOpll()).registers[0x38] >> 4,
					0,
					"Rhythm Off must not overwrite the CH9 melodic instrument with Tom level",
				);
				assert(await page.locator("#melodyControls").isVisible());
				assert.equal(
					await page.locator("#keyboard .key:not(:disabled)").count(),
					36,
				);
				await page.locator("#rhythmEnabled .param-value").click();
				await page.waitForTimeout(100);
				assert((await inspectOpll()).rhythm.enabled);
				await page
					.locator('#channelTabs [data-channel="auto"]')
					.click();
				await page.keyboard.down("a");
				await page.waitForTimeout(250);
				await page.keyboard.up("a");
				await page.locator("#smsgearFilesToggle").click();
				await page.waitForFunction(
					() => !document.getElementById("smsgearFilesPanel").hidden,
				);
				assert(await page.locator("#smsgearFilesPanel").innerText());
				await page.locator("#synthInputCodeTab").click();
				if (withMonaco) {
					await page.waitForFunction(
						() =>
							document.getElementById("synthCodeEditorHost")
								.dataset.ready === "true",
						{ timeout: 60000 },
					);
					const editor = page
						.locator("#synthCodeEditorHost .monaco-editor")
						.first();
					assert(
						await editor.isVisible(),
						"Monaco must be visible after initialization",
					);
					const bounds = await editor.boundingBox();
					assert(
						bounds.height >= 200,
						"Monaco must have a usable height: " +
							JSON.stringify(bounds),
					);
					await page.waitForFunction(() =>
						document
							.querySelector("#synthCodeEditorHost .view-lines")
							?.textContent.includes("useSoundChip"),
					);
				}
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
				const expandedEditor = page
					.locator(
						withMonaco
							? "#synthCodeEditorHost .monaco-editor"
							: "#synthCodeEditor",
					)
					.first();
				await expandedEditor.scrollIntoViewIfNeeded();
				const codeBounds = await expandedEditor.boundingBox(),
					filesBounds = await page
						.locator("#smsgearFilesPanel")
						.boundingBox();
				assert(
					codeBounds.width > 400 &&
						codeBounds.x >= filesBounds.x + filesBounds.width,
					"Expanded Code must appear beside Files: " +
						JSON.stringify({ codeBounds, filesBounds }),
				);
				await page.locator("#psgTab").click();
				assert(
					await page.locator("#psgPanel").isVisible(),
					"Expanded chip tab reveals its controls",
				);
				assert(
					!(await expandedEditor.isVisible()),
					"Chip view hides Code without closing expanded mode",
				);
				await page.locator("#synthInputCodeTab").click();
				assert(
					await expandedEditor.isVisible(),
					"Returning to Code restores its editor",
				);
				await page.screenshot({
					path: out.replace(
						/\.json$/,
						`-${engine}-expanded-code.png`,
					),
					fullPage: false,
				});
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
				await page.locator("#vgmFileInput").setInputFiles({
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
				await page
					.waitForFunction(
						() => !document.getElementById("songPause").disabled,
					)
					.catch(async (error) => {
						throw Error(
							error.message +
								"\nSong status: " +
								(await page
									.locator("#audioStatus")
									.textContent()) +
								"\nPage errors: " +
								JSON.stringify(errors),
						);
					});
				const selectChannelAcrossRefresh = async (value) => {
					const button = page.locator(
						`#channelTabs [data-channel="${value}"]`,
					);
					await button.scrollIntoViewIfNeeded();
					const box = await button.boundingBox();
					await page.mouse.move(
						box.x + box.width / 2,
						box.y + box.height / 2,
					);
					await page.mouse.down();
					await page.waitForTimeout(400); // Cross at least two Live refreshes.
					await page.mouse.up();
					assert.equal(
						await button.getAttribute("aria-selected"),
						"true",
						"A CH click must survive Live refresh between pointer down/up",
					);
				};
				await selectChannelAcrossRefresh("1");
				await page.waitForTimeout(160);
				await page.locator("#songPause").click();
				await page.waitForFunction(
					() =>
						document.getElementById("songPause").textContent ===
						"Resume",
				);
				await selectChannelAcrossRefresh("0");
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
				const seek = async (seconds) => {
					await page.locator("#songSeek").evaluate((node, value) => {
						node.value = String(value);
						node.dispatchEvent(
							new Event("input", { bubbles: true }),
						);
						node.dispatchEvent(
							new Event("change", { bubbles: true }),
						);
					}, seconds);
					await page.waitForFunction(
						() => !document.getElementById("songSeek").disabled,
					);
					return capture();
				};
				const sought = await seek(0.5);
				assert.equal(sought.timeSamples, 22050);
				assert.equal(sought.playing, false);
				assert.equal(sought.stereo, 1);
				await page.locator("#mixerTab").click();
				await page.locator("#songMute_segapsg_0").click();
				await page.locator("#songMute_ym2413_0").click();
				const muted = await capture();
				assert(
					muted.channelMutes.segapsg[0] &&
						muted.channelMutes.ym2413[0],
				);
				assert.deepEqual(muted.opll, sought.opll);
				assert.deepEqual(muted.psg, sought.psg);
				await page
					.locator("#songChannelMutes")
					.scrollIntoViewIfNeeded();
				await page.screenshot({
					path: out.replace(/\.json$/, `-${engine}-mixer.png`),
					fullPage: false,
				});
				await page.locator("#psgTab").click();
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
				assert((await capture()).frame >= sought.frame);
				const playingSeek = await seek(0.1);
				assert.equal(playingSeek.playing, true);
				assert(playingSeek.timeSamples < 22050);
				assert(playingSeek.channelMutes.segapsg[0]);
				await page.evaluate(() => {
					const seek = document.getElementById("songSeek");
					seek.value = "1.8";
					seek.dispatchEvent(new Event("change", { bubbles: true }));
					document.getElementById("songStop").click();
				});
				await page.waitForTimeout(250);
				assert(
					await page.locator("#songSeek").isDisabled(),
					"Stop cancels pending seek and never resumes it",
				);
				await page.locator("#songPlay").click();
				await page.waitForFunction(
					() => !document.getElementById("songPause").disabled,
				);
				assert(
					(await capture()).channelMutes.ym2413[0],
					"Mute choices survive reference replacement",
				);
				await page.locator("#songStop").click();
				await page.waitForFunction(
					() => document.getElementById("songPause").disabled,
				);
				await selectChannelAcrossRefresh("2");
				const before = await page.locator("#soundName").inputValue();
				await page.locator("#vgmFileInput").setInputFiles({
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
