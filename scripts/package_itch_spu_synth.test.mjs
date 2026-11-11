// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {packageSpuSynth, validateSpuSynthVersion} from './package_itch_spu_synth.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

test('SPU package version cannot escape its release directory', () => {
  for (const version of ['../escape', '/tmp/out', '', '.hidden', 'a/b', 'a\\b', 'a b', 'a;echo', 'x'.repeat(81)]) assert.throws(() => validateSpuSynthVersion(version));
  for (const version of ['dev', 'v0.1.0+test', '2026-10-29']) assert.equal(validateSpuSynthVersion(version), version);
});

test('standalone SPU ZIP runs editable original modules and retains authenticated browser/native source', async () => {
  const releaseDir = await mkdtemp(join(tmpdir(), 'tetorica spu package '));
  try {
    const result = await packageSpuSynth({version:'test', releaseDir});
    assert(result.passed); assert.equal(result.bundles, 3); assert(result.files < 1000); assert(result.sourceCheck.passed);
    const info = JSON.parse(execFileSync('python3', ['-c', String.raw`
import json,sys,zipfile,hashlib
with zipfile.ZipFile(sys.argv[1]) as archive:
 assert archive.testzip() is None
 names=archive.namelist()
 browser=json.loads(archive.read("sources/spu-synth-browser.json"))
 with zipfile.ZipFile(__import__("io").BytesIO(archive.read(browser["sourceArchive"]["path"]))) as sources:
  assert set(sources.namelist())==set(item["path"] for item in browser["originalInputs"])
  for item in browser["originalInputs"]:
   data=sources.read(item["path"])
   assert len(data)==item["bytes"] and hashlib.sha256(data).hexdigest()==item["sha256"]
 print(json.dumps({"names":names,"browser":browser}))
`, result.archive], {encoding:'utf8'}));
    assert.equal(info.names.length, result.files);
    assert.deepEqual(info.browser.builder,{name:'source-copy',minify:false,bundle:false,dependencyAnalyzer:{name:'esbuild',version:info.browser.builder.dependencyAnalyzer.version}});
    assert.match(info.browser.builder.dependencyAnalyzer.version,/^\d+\.\d+\.\d+/);
    for (const name of ['ps1_spu_wasm.js', 'ps1_spu_wasm.wasm', 'ps1_spu_build.json'])
      assert.deepEqual(await readFile(join(result.stage, 'generated', name)), await readFile(new URL('../tetorica_src/runtime/generated/'+name, import.meta.url)));
    assert(info.browser.originalInputs.some(input => input.path === 'tetorica_src/runtime/generated/ps1_spu_wasm.js'));
    assert(!info.browser.originalInputs.some(input => input.path === 'docs/generated/ps1_spu_wasm.js'));
    assert(info.browser.originalInputs.some(input => input.path === 'scripts/copy_readable_modules.mjs'),'the source archive contains the dependency-copy recipe');
    for (const path of ['index.html', 'synth-spu/index.html', 'synth-spu/icon.png', 'synth-spu/synth.js', 'synth-spu/spu_synth_worklet.js', 'synth-spu/spu_synth_prepare_worker.js', 'generated/ps1_spu_wasm.js', 'generated/ps1_spu_wasm.wasm', 'sources/native/ps1/spu.cpp', 'sources/native/ps1/upstream/spu.cpp', 'licenses/mame-ps1-spu/LICENSE',
      'playground/tetorica-playground-globals.d.ts','playground/tetorica-playground-ps1.d.ts','playground/tetorica-shell.d.ts',
      'playground/vendor/fflate-LICENSE','licenses/tetorica-virtual-files/LICENSE',
      'synth-spu/code_host.js','synth-spu/code_audio.js','synth-spu/code_project.js','synth-spu/code_files.js','synth-spu/code_declarations.js','synth-spu/code_live.js','synth-spu/psf_channel_activity.js',
      'synth/synth_code_controls.js','js/playground_code_runtime.js',
      'js/native-fx-worklet.js','js/native_audio_effect.wasm','sources/code-effects/tetorica_src/native/audio_effect/gain.c','sources/code-effects/scripts/build_native_audio_effect.sh','sources/code-effects/LICENSE']) assert(info.names.includes(path), path);
    assert.deepEqual(await readFile(join(result.stage,'js/native_audio_effect.wasm')),await readFile(new URL('../tetorica_src/runtime/generated/effects/gain.wasm',import.meta.url)));
    assert.equal(info.browser.codeEffects.artifact.sha256,hash(await readFile(join(result.stage,'js/native_audio_effect.wasm'))));
    assert.equal(info.browser.codeEffects.sourceRoot,'sources/code-effects');
    assert.equal(info.browser.codeEffects.recipe,'sources/code-effects/scripts/build_native_audio_effect.sh');
    for(const path of ['generated/psf-player/psf_player.js','generated/psf-player/psf_player.wasm',
      'synth-spu/psf_song_preview.js','synth-spu/psf_song_source.js','synth-spu/psf_playback_core.js','synth-spu/psf_live_snapshot.js','synth-spu/psf_capture.js','synth-spu/psf_paused_audition.js',
      'sources/psf-player/third_party/play-psf/provenance.json','sources/psf-player/third_party/play-psf/Source/psx/PsxBios.cpp',
      'sources/psf-player/tetorica_src/wasm/psf_player/psf_player.cpp','sources/psf-player/scripts/build_psf_player.mjs',
      ...['spu.cpp','spu.h','spu_tables.cpp','spureverb.cpp','spureverb.h','standalone_support.h','LICENSE'].map(name=>'sources/psf-player/third_party/tetorica-soundchip-native/vendor/mame-ps1-spu/'+name),
      'licenses/play-psf/License.txt','licenses/play-psf/Framework-License.txt','licenses/play-psf/CodeGen-License.txt'])assert(info.names.includes(path),path);
    for(const name of ['psf_player.js','psf_player.wasm'])assert.deepEqual(await readFile(join(result.stage,'generated/psf-player',name)),await readFile(new URL('../docs/generated/psf-player/'+name,import.meta.url)));
    assert.equal(info.browser.psfPlayer.sourceRoot,'sources/psf-player');
    assert.equal(info.browser.psfPlayer.artifact.sha256,hash(await readFile(join(result.stage,'generated/psf-player/psf_player.wasm'))));
    assert.equal(info.browser.psfPlayer.provenance.license,'BSD-2-Clause');
    assert.equal(info.browser.psfPlayer.engine,'Play! PSF1 HLE + MAME PS1 SPU');
    assert.equal(info.browser.psfPlayer.abi,4);
    assert.deepEqual(info.browser.psfPlayer.selectedChannelMonitor,{defaultEnabled:false,mode:'dry',voiceCount:24,frameMajorFloats:48,sharedReverb:'full-mix-only',retainsFullMix:true,buildOnlyTap:true});
    assert.deepEqual(info.browser.psfPlayer.pausedAudition,{source:'synth-spu/psf_paused_audition.js',checkpoint:'editor',sourceStateUnchanged:true,ordinaryAdpcmOnly:false,noise:true});
    assert.deepEqual(info.browser.psfPlayer.noiseCapture,{clock:'shared-6-bit',supportLoopBytes:64,copiesRunningPhase:false,referenceKey:false,pmonCarrier:false});
    assert.deepEqual(info.browser.psfPlayer.capture,{source:'synth-spu/psf_capture.js',sameFrameRam:true,ramBytes:524288,intervalFrames:2205,referenceKey:'C4',rewritesAdpcm:false});
    assert.equal(info.browser.psfPlayer.spu.license,'BSD-3-Clause');
    assert.equal(info.browser.psfPlayer.spu.sdkVersion,info.browser.sdk.version);
    for(const file of info.browser.psfPlayer.spu.files) {
      const path='third_party/tetorica-soundchip-native/vendor/mame-ps1-spu/'+file.path;
      const bytes=await readFile(new URL('../'+path,import.meta.url));
      assert.deepEqual(await readFile(join(result.stage,info.browser.psfPlayer.spu.sourceRoot,file.path)),bytes);
      assert.equal(file.sha256,hash(bytes));assert.equal(file.bytes,bytes.length);
      assert(info.browser.originalInputs.some(input=>input.path===path&&input.sha256===file.sha256));
    }
    assert.match(await readFile(join(result.stage,'sources/code-effects/README.md'),'utf8'),/host software after the SPU/);
    assert(!info.names.includes('favicon.ico'), 'The SPU icon replaces the website-wide favicon');
    const icon = await readFile(new URL('../docs/synth-spu/icon.png', import.meta.url));
    assert.deepEqual(await readFile(join(result.stage, 'synth-spu/icon.png')), icon, 'User-supplied icon is copied without transformation');
    assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'Icon is a PNG');
    const iconRecord = info.browser.originalInputs.find(item => item.path === 'docs/synth-spu/icon.png');
    assert(iconRecord, 'Original icon is included in authenticated source inputs');
    assert.equal(iconRecord.bytes, icon.length); assert.equal(iconRecord.sha256, hash(icon));
    for (const entry of ['index.html', 'synth-spu/index.html']) {
      const html = await readFile(join(result.stage, entry), 'utf8');
      const pageUrl = new URL(entry, 'https://standalone.invalid/');
      let assetReferences = 0;
      for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
        const url = new URL(match[1], pageUrl);
        if (url.origin !== pageUrl.origin) continue;
        const name = decodeURIComponent(url.pathname.slice(1));
        assert(info.names.includes(name), `${entry}: local asset ${match[1]} exists inside the ZIP`);
        assetReferences++;
      }
      assert(assetReferences >= 5, `${entry}: CSS, JavaScript, favicon, touch icon, and header image references checked`);
      const iconUrl = entry === 'index.html' ? './synth-spu/icon.png' : './icon.png';
      for (const rel of ['icon', 'apple-touch-icon']) {
        const link = [...html.matchAll(/<link\b[^>]*>/g)].map(match => match[0]).find(tag => attribute(tag, 'rel') === rel);
        assert(link, `${entry}: ${rel} exists`); assert.equal(attribute(link, 'href'), iconUrl, `${entry}: ${rel} resolves to the packaged SPU icon`);
      }
      assert([...html.matchAll(/<img\b[^>]*>/g)].some(match => attribute(match[0], 'src') === iconUrl), `${entry}: header image uses the packaged SPU icon`);
      assert.doesNotMatch(html, /iframe|sw-register|webmanifest/);
    }
    const html = await readFile(join(result.stage, 'index.html'), 'utf8');
    assert.match(html, /src="\.\/synth-spu\/synth\.js\?[^"\s]+"/); assert.match(html, /href="\.\/synth-spu\/synth\.css\?[^"\s]+"/);
    assert.doesNotMatch(JSON.stringify(info.browser), /\/private\/|\/Users\//, 'Receipt must be portable');
    assert.deepEqual(info.browser.bundles.map(entry=>entry.path),['synth-spu/synth.js','synth-spu/spu_synth_worklet.js','synth-spu/spu_synth_prepare_worker.js']);
    assert(info.browser.modules.length>info.browser.bundles.length,'the receipt describes the complete runnable module graph');
    for (const module of info.browser.modules) {
      assert.equal(module.path,module.sourcePath.slice('docs/'.length));
      const bytes=await readFile(join(result.stage,module.path));
      assert.equal(bytes.length,module.bytes);assert.equal(hash(bytes),module.sha256);
      assert.deepEqual(bytes,await readFile(new URL('../'+module.sourcePath,import.meta.url)),`${module.path}: live source is unchanged and directly editable`);
      const original=info.browser.originalInputs.find(input=>input.path===module.sourcePath);
      assert(original,`${module.path}: live source is authenticated in the source archive`);assert.equal(original.sha256,module.sha256);
      for(const specifier of module.localImports) {
        assert(/^\.\.?\//.test(specifier),`${module.path}: imports retain their original relative specifier`);
        const url=new URL(specifier,new URL(module.path,'https://standalone.invalid/'));
        assert(info.names.includes(decodeURIComponent(url.pathname.slice(1))),`${module.path}: local import ${specifier} is inside the ZIP`);
      }
      for(const match of bytes.toString().matchAll(/new\s+URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g)) {
        const url=new URL(match[2],new URL(module.path,'https://standalone.invalid/'));
        assert(info.names.includes(decodeURIComponent(url.pathname.slice(1))),`${module.path}: runtime asset ${match[2]} is inside the ZIP`);
      }
    }
    assert(info.browser.modules.some(module=>module.path==='synth-spu/synth.css'),'the original stylesheet is part of the editable graph');
    for(const entry of info.browser.bundles)assert.deepEqual(entry,info.browser.modules.find(module=>module.path===entry.path),'legacy entry records identify the same original modules');
    const main = await readFile(join(result.stage, 'synth-spu/synth.js'), 'utf8');
    assert.match(main, /spu_synth_audio\.js/);assert.match(main, /spu_synth_prepare_worker\.js/);
    const audio=await readFile(join(result.stage,'synth-spu/spu_synth_audio.js'),'utf8');
    assert.match(audio,/spu_synth_worklet\.js/);assert.match(audio,/\.\.\/generated\/ps1_spu_wasm\.wasm/);
    const worker = await readFile(join(result.stage, 'synth-spu/spu_synth_prepare_worker.js'), 'utf8'); assert.match(worker, /onmessage/);
    assert.match(await readFile(join(result.stage,'README.md'),'utf8'),/copied byte-for-byte/);
    assert.equal(hash(await readFile(result.archive)), result.archiveRecord.sha256);
  } finally {await rm(releaseDir, {recursive:true, force:true});}
});
