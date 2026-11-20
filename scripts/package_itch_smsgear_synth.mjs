// SPDX-License-Identifier: BSD-3-Clause
// Keep authored modules readable. Esbuild is used only to discover dependencies.
import assert from "node:assert/strict";
import {
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	writeFile,
	cp,
	copyFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyReadableModules } from "./copy_readable_modules.mjs";
import {
	copyRuntimeArtifacts,
	checkRuntimeArtifacts,
} from "./runtime_artifacts.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
export async function packageSmsGearSynth({
	version = "dev",
	releaseDir = join(root, "release"),
} = {}) {
	if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(version))
		throw Error("Invalid package version");
	await checkRuntimeArtifacts({
		root,
		ids: ["segapsg", "ym2413", "native_audio_effect"],
		mirrors: true,
	});
	releaseDir = resolve(releaseDir);
	await mkdir(releaseDir, { recursive: true });
	const archive = join(
		releaseDir,
		`tetorica_smsgear_synth_${version}_itch.zip`,
	);
	try {
		await readFile(archive);
		throw Error("Archive already exists: " + archive);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const stage = await mkdtemp(
		join(releaseDir, `itch_smsgear_synth_${version}-`),
	);
	// Retain the complete reusable runtime/source kit and its component licenses.
	execFileSync(
		process.execPath,
		[join(root, "scripts/copy_full_web_runtime.mjs"), join(stage, "js")],
		{ cwd: root, stdio: "inherit" },
	);
	const factories = (await readdir(join(root, "docs/generated")))
		.filter((name) => name.endsWith("_wasm.js"))
		.map((name) => "docs/generated/" + name);
	const browser = await copyReadableModules({
		root,
		stage,
		entries: [
			"docs/synth-smsgear/synth.js",
			"docs/synth-smsgear/song_worklet.js",
			"docs/synth-smsgear/psg_worklet.js",
			"docs/synth-smsgear/opll_worklet.js",
			"docs/synth-smsgear/synth.css",
			"docs/js/native-fx-worklet.js",
		],
		factories,
	});
	await copyRuntimeArtifacts({
		root,
		destination: join(stage, "generated"),
		ids: ["segapsg", "ym2413"],
		includeMetadata: false,
	});
	for (const name of [
		"tetorica-playground-globals.d.ts",
		"playground_examples.js",
		"playground_monaco_definitions.js",
		"playground_monaco.js",
		"tetorica-shell.d.ts",
		"tetorica-playground-master-system.d.ts",
	]) {
		const source = join(root, "docs/playground", name);
		await mkdir(join(stage, "playground"), { recursive: true });
		await copyFile(source, join(stage, "playground", name));
	}
	for (const name of ["README.md", "fixtures.js"])
		await copyFile(
			join(root, "docs/synth-smsgear", name),
			join(stage, "synth-smsgear", name),
		);
	await copyFile(
		join(root, "docs/tetorica_smsgear_synth.webp"),
		join(stage, "tetorica_smsgear_synth.webp"),
	);
	await copyFile(join(root, "LICENSE"), join(stage, "LICENSE"));
	let html = await readFile(
		join(root, "docs/synth-smsgear/index.html"),
		"utf8",
	);
	html = html
		.replaceAll(
			"../playground/index.html?mode=master-system",
			"https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html?mode=master-system",
		)
		.replaceAll(
			'href="../index.html"',
			'href="https://kyorohiro.github.io/hello_ymfm_wasm/"',
		);
	await writeFile(join(stage, "synth-smsgear/index.html"), html);
	await writeFile(
		join(stage, "index.html"),
		html
			.replaceAll(
				"../tetorica_smsgear_synth.webp",
				"./tetorica_smsgear_synth.webp",
			)
			.replace(
				/\b(href|src)="\.\/(synth\.(?:css|js))"/g,
				'$1="./synth-smsgear/$2"',
			)
			.replace('href="./README.md"', 'href="./synth-smsgear/README.md"')
			.replaceAll('href="../js/', 'href="./js/'),
	);
	await writeFile(
		join(stage, "PACKAGE.md"),
		`# Tetorica SMSGEAR Synth ${version}\n\nServe this directory over HTTP and open index.html. PSG is primary, YM2413 is optional FM. No game data is bundled.\n\nApplication JavaScript, CSS, reference renderer and shared Files/Code controls are copied as readable modules, without bundling or minification. The reusable runtime, generated WASM and corresponding source/license kits are retained under js/; see js/RUNTIME.md and js/sources/. Native-effect WASM is a separate software FX implementation. Monaco may use its CDN; plain-text editing works offline.\n\nBuild commands remain in the application repository: sh scripts/package_itch_smsgear_synth.sh VERSION. Original authored source hashes are recorded in smsgear-browser-source.json.\n`,
	);
	await writeFile(
		join(stage, "smsgear-browser-source.json"),
		JSON.stringify({ ...browser, version, minified: false }, null, 2) +
			"\n",
	);
	execFileSync("python3", [
		"-c",
		String.raw`import sys,zipfile
from pathlib import Path
base=Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2],'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in sorted(base.rglob('*')):
  if p.is_file():
   info=zipfile.ZipInfo(str(p.relative_to(base)),(1980,1,1,0,0,0));info.create_system=3;info.external_attr=0o100644<<16
   z.writestr(info,p.read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
with zipfile.ZipFile(sys.argv[2]) as z: assert z.testzip() is None
`,
		stage,
		archive,
	]);
	const bytes = await readFile(archive),
		result = {
			archive,
			stage,
			version,
			bytes: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		};
	await writeFile(archive + ".json", JSON.stringify(result, null, 2) + "\n");
	return result;
}
if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const version = process.argv[2] ?? "dev";
	if (process.argv.length > 4)
		throw Error(
			"Usage: node scripts/package_itch_smsgear_synth.mjs [version] [release-directory]",
		);
	console.log(
		JSON.stringify(
			await packageSmsGearSynth({
				version,
				...(process.argv[3] ? { releaseDir: process.argv[3] } : {}),
			}),
			null,
			2,
		),
	);
}
