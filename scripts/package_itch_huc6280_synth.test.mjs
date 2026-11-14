// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {packageHuc6280Synth,validateHuc6280SynthVersion} from './package_itch_huc6280_synth.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('HuC6280 package version cannot escape its release directory',()=>{
  for(const value of ['../escape','/tmp/a','','.hidden','a/b','a\\b','a b','a;echo','x'.repeat(81)]) assert.throws(()=>validateHuc6280SynthVersion(value));
  for(const value of ['dev','v1+test','2026-11-04']) assert.equal(validateHuc6280SynthVersion(value),value);
});
test('HuC6280 ZIP runs original editable modules with standalone deterministic runtime and authenticated sources',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'huc6280-synth-package-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const a=await packageHuc6280Synth({version:'test',releaseDir:join(directory,'a')});
  const b=await packageHuc6280Synth({version:'test',releaseDir:join(directory,'b')});
  assert.deepEqual(await readFile(a.archive),await readFile(b.archive));assert(a.files<1000);assert.equal(a.bundles,6);
  const info=JSON.parse(execFileSync('python3',['-c',String.raw`
import json,sys,zipfile,io,hashlib
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 assert all(not name.startswith('/') and '..' not in name.split('/') for name in z.namelist())
 receipt=json.loads(z.read('sources/huc6280-synth-browser.json'))
 src=z.read(receipt['sourceArchive']['path'])
 assert hashlib.sha256(src).hexdigest()==receipt['sourceArchive']['sha256']
 with zipfile.ZipFile(io.BytesIO(src)) as source:
  assert set(source.namelist())==set(item['path'] for item in receipt['originalInputs'])
  for item in receipt['originalInputs']:
   data=source.read(item['path']);assert len(data)==item['bytes'] and hashlib.sha256(data).hexdigest()==item['sha256']
 print(json.dumps({'names':z.namelist(),'receipt':receipt}))
`,a.archive],{encoding:'utf8'}));
  assert.equal(info.names.length,a.files);assert(!JSON.stringify(info.receipt).includes('/Users/'));
  assert.equal(info.receipt.product,'Tetorica HuC6280 Synth');
  assert.equal(info.receipt.productId,'tetorica-huc6280-synth');
  assert.match(a.archive,/tetorica_huc6280_synth_test_itch\.zip$/);
  assert(info.receipt.originalInputs.some(input=>input.path==='docs/tetorica_huc6280_synth.webp'));
  assert.deepEqual(await readFile(join(a.stage,'tetorica_huc6280_synth.webp')),await readFile(new URL('../docs/tetorica_huc6280_synth.webp',import.meta.url)));
  for(const id of ['huc6280','msm5205','cdda'])for(const suffix of ['js','wasm']) {
    const name=`${id}_wasm.${suffix}`;
    assert.deepEqual(await readFile(join(a.stage,'generated',name)),await readFile(new URL('../tetorica_src/runtime/generated/'+name,import.meta.url)));
  }
  assert.deepEqual(info.receipt.runtimeArtifacts.map(item=>item.path).sort(),
    ['huc6280','msm5205','cdda'].flatMap(id=>['js','wasm'].map(suffix=>`generated/${id}_wasm.${suffix}`)).sort());
  assert.deepEqual(info.names.filter(name=>name.startsWith('generated/')).sort(),info.receipt.runtimeArtifacts.map(item=>item.path).sort(),
    'include exactly the three PC Engine devices, without unrelated chip runtimes');
  for(const item of info.receipt.runtimeArtifacts) {
    const bytes=await readFile(join(a.stage,item.path));assert.equal(bytes.length,item.bytes);assert.equal(sha(bytes),item.sha256);
  }
  const native=JSON.parse(await readFile(join(a.stage,'sources/HuC6280.json')));
  for(const entry of native.inputs){const bytes=await readFile(join(a.stage,entry.path));assert.equal(bytes.length,entry.bytes);assert.equal(sha(bytes),entry.sha256);}
  for(const [name,entry] of Object.entries(native.generated)) assert.equal(sha(await readFile(join(a.stage,'generated',name))),entry.sha256);
  for(const [id,label]of [['msm5205','MSM5205'],['cdda','CDDA']]) {
    const receipt=JSON.parse(await readFile(join(a.stage,`sources/${label}.json`)));
    assert.deepEqual(receipt.sdk,native.sdk,'all native source kits retain the same fixed SDK pin');
    for(const item of receipt.inputs) {
      const bytes=await readFile(new URL('../third_party/tetorica-soundchip-native/'+item.path,import.meta.url));
      assert.equal(bytes.length,item.size);assert.equal(sha(bytes),item.sha256);
    }
    for(const item of receipt.files) {
      const bytes=await readFile(join(a.stage,'sources',item.path));assert.equal(bytes.length,item.bytes);assert.equal(sha(bytes),item.sha256);
    }
    for(const file of [`${id}_pcm.c`,`${id}_pcm.h`,'LICENSE','NOTICE.md'])
      assert.deepEqual(await readFile(join(a.stage,`sources/native/${id}/${file}`)),await readFile(new URL(`../third_party/tetorica-soundchip-native/vendor/tetorica-${id}/${file}`,import.meta.url)));
    const recipe=await readFile(join(a.stage,`sources/scripts/build_${id}_wasm.sh`),'utf8');
    assert(recipe.includes(`native/${id}/${id}_pcm.c`));assert(recipe.includes(`native/${id}/${id}_wasm.c`));
    assert(!recipe.includes(`vendor/tetorica-${id}`),'standalone rebuild uses the included relocated source kit');
    for(const file of ['LICENSE','NOTICE.md'])assert.deepEqual(await readFile(join(a.stage,`licenses/tetorica-${id}/${file}`)),await readFile(join(a.stage,`sources/native/${id}/${file}`)));
    const module=await WebAssembly.compile(await readFile(join(a.stage,`generated/${id}_wasm.wasm`)));
    assert.deepEqual(WebAssembly.Module.imports(module),[]);
    const exports=WebAssembly.Module.exports(module).map(entry=>entry.name);
    for(const symbol of ['init','prepare','play','stop','render'])assert(exports.includes(`${id}_wasm_${symbol}`),`${id}: packaged WASM retains the real playback ABI`);
  }
  assert.equal(info.receipt.builder.name,'source-copy');assert.equal(info.receipt.builder.minify,false);assert.equal(info.receipt.builder.bundle,false);
  assert.equal(info.receipt.builder.dependencyAnalyzer.name,'esbuild');
  assert.equal(typeof info.receipt.builder.dependencyAnalyzer.version,'string');
  assert(info.receipt.modules.length>info.receipt.bundles.length);
  for(const path of ['synth-huc6280/code_host.js','synth-huc6280/code_audio.js','synth-huc6280/code_project.js','synth-huc6280/code_files.js',
    'synth-huc6280/cdrom2_audio.js','synth-huc6280/song_engine.js',
    'synth-huc6280/msm5205_asset.js','synth-huc6280/msm5205_source.js','synth-huc6280/msm5205_controls.js',
    'js/msm5205_audio.js','js/msm5205_worklet.js','js/msm5205_pcm.js','js/msm5205_player.js','js/msm5205_sample.js','js/msm5205audioengine.js',
    'js/cdda_audio.js','js/cdda_worklet.js','js/cdda_pcm.js','js/cdda_player.js','js/cdda_source.js',
    'synth/synth_code_controls.js','synth/synth_project_store.js','synth/synth_draft_store.js',
    'playground/tetorica-playground-globals.d.ts','playground/tetorica-playground-huc6280.d.ts','playground/tetorica-shell.d.ts',
    'js/native-fx-worklet.js','js/native_audio_effect.wasm','sources/code-effects/scripts/build_native_audio_effect.sh',
    'sources/code-effects/LICENSE','playground/vendor/fflate-LICENSE','licenses/tetorica-virtual-files/LICENSE',
    'sources/MSM5205.md','sources/CDDA.md','sources/scripts/build_msm5205_wasm.sh','sources/scripts/build_cdda_wasm.sh',
    'licenses/libvgm-msm5205/LICENSE','licenses/libvgm-msm5205/README.md'])
    assert(info.names.includes(path),`${path}: Code, Files, editor and reusable source assets are included`);
  assert.deepEqual(await readFile(join(a.stage,'js/native_audio_effect.wasm')),await readFile(new URL('../tetorica_src/runtime/generated/effects/gain.wasm',import.meta.url)));
  let staticAssets=0;
  for(const module of info.receipt.modules) {
    assert.equal(module.path,module.sourcePath.slice('docs/'.length));
    const bytes=await readFile(join(a.stage,module.path));
    assert.deepEqual(bytes,await readFile(new URL('../'+module.sourcePath,import.meta.url)),`${module.path}: preserve comments, identifiers, imports and original bytes`);
    assert.equal(bytes.length,module.bytes);assert.equal(sha(bytes),module.sha256);
    for(const specifier of module.localImports) {
      assert.match(specifier,/^\.\.?\//,'localImports retain the original relative specifiers');
      const url=new URL(specifier,new URL(module.path,'https://zip.invalid/'));
      assert(info.names.includes(decodeURIComponent(url.pathname.slice(1))),`${module.path}: ${specifier}`);
    }
    for(const match of bytes.toString().matchAll(/new URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g)) {
      const url=new URL(match[2],new URL(module.path,'https://zip.invalid/'));
      if(url.origin!=='https://zip.invalid') continue;
      assert(info.names.includes(decodeURIComponent(url.pathname.slice(1))),`${module.path}: ${match[2]}`);staticAssets++;
    }
  }
  assert(staticAssets>=6,'original audio modules reference local WASM and AudioWorklet assets for all three devices');
  for(const entry of info.receipt.bundles) assert.deepEqual(entry,info.receipt.modules.find(module=>module.path===entry.path));
  const main=await readFile(join(a.stage,'synth-huc6280/synth.js'),'utf8');
  assert(main.split('\n').length>100);assert.match(main,/^\/\/ SPDX-License-Identifier: BSD-3-Clause\n/);
  assert.match(main,/import \{createAudio\} from '\.\/audio\.js(?:\?v=[A-Za-z0-9._-]+)?'/);
  assert.match(await readFile(join(a.stage,'synth-huc6280/synth.css'),'utf8'),/@import url\('\.\.\/synth-spu\/synth\.css'\)/);
  assert(info.receipt.modules.some(module=>module.path==='synth-spu/synth.css'));
  for(const name of ['vgm_import.js','vgm_library.js','song_source.js','song_preview.js','song_controls.js','song_state.js','song_live.js','song_voice.js','song_audition.js','song_cache.js','song_checkpoint.js','song_manual.js']) assert(info.receipt.modules.some(module=>module.path===`synth-huc6280/${name}`));
  for(const name of ['ym2612vgm.js','vgm_file.js']) assert(info.receipt.modules.some(module=>module.path===`js/${name}`));
  for(const path of ['scripts/copy_readable_modules.mjs','scripts/runtime_artifacts.mjs','scripts/wasm_sdk_inventory.mjs',
    'scripts/copy_msm5205_sources.mjs','scripts/copy_cdda_sources.mjs','scripts/copy_application_audio_sources.mjs',
    'third_party/libvgm-msm5205/LICENSE','third_party/libvgm-msm5205/README.md']) assert(info.receipt.originalInputs.some(input=>input.path===path));
  for(const entry of ['index.html','synth-huc6280/index.html']) {
    const html=await readFile(join(a.stage,entry),'utf8');
    assert.match(html,/<title>Tetorica HuC6280 Synth<\/title>/);
    assert.match(html,/id="loadVgm"[^>]*>VGM \/ VGZ…/);
    const menu=html.indexOf('id="synthMenuPanel"'),importButton=html.indexOf('id="loadVgm"'),menuEnd=html.indexOf('</details>',menu);
    assert(menu>=0&&importButton>menu&&importButton<menuEnd,'VGM import belongs to the hamburger menu');
    const sounds=html.indexOf('id="vgmImport"'),channels=html.indexOf('id="hucCodeLiveTools"'),monitor=html.indexOf('aria-label="Instrument display"');
    const player=html.indexOf('id="hucSongPlayer"'),mix=html.indexOf('id="hucSongChannels"');
    assert(player>=0&&player<channels&&channels<mix&&mix<sounds&&sounds<monitor,'Channel / Auto update and VGM outputs belong next to the transport, before Sounds and the monitor');
    for(const [id,label]of [['huc6280','HuC6280'],['msm5205','MSM5205'],['cdda','CD-DA'],['mixer','Mixer']])
      assert.match(html,new RegExp(`id="${id}ChipTab"[^>]*role="tab"[^>]*>${label}</button>`));
    for(const id of ['msm5205','cdda']) {
      assert.match(html,new RegExp(`id="${id}ChipPanel"[^>]*role="tabpanel"[^>]*hidden`));
      assert(html.includes(`await useSoundChip(&quot;${id}&quot;)`)||html.includes(`await useSoundChip("${id}")`));
    }
    for(const id of ['msm5205Controls','msmSourceState','msmSampleSelect','msmSampleFormat','msmLoadSample','msmAddFiles','msmCancelLoad',
      'msmSampleInfo','msmSampleCapacity','msmSampleWave','msmPlay','msmStop','msmLoop','msmRate','msmRateHz','msmNextPlayHint','msmSourceStatus'])
      assert(html.includes(`id="${id}"`),`${entry}: the standalone MSM5205 UI includes ${id}`);
    assert.match(html,/<canvas id="msmSampleWave"[^>]*aria-label="Actual decoded ADPCM sample waveform"/);
    assert.match(html,/<progress id="msmSampleCapacity"[^>]*max="65536"/);
    assert.match(html,/<output id="msmRate"[^>]*aria-valuemin="0"[^>]*aria-valuemax="15"/);
    const msmPanel=html.slice(html.indexOf('id="msm5205ChipPanel"'),html.indexOf('id="cddaChipPanel"'));
    assert(!msmPanel.includes('Under construction'),'MSM5205 has the actual sample controls');
    const cddaPanel=html.slice(html.indexOf('id="cddaChipPanel"'),html.indexOf('id="mixerChipPanel"'));
    assert(cddaPanel.includes('Under construction'),'CD-DA retains its explicit unfinished UI');
    for(let channel=1;channel<=6;channel++)assert.match(html,new RegExp(`id="hucSongChannel${channel}Toggle"[^>]*aria-pressed="true"`));
    assert.match(html,/<button id="hucSongCaptureButton"[^>]*>Capture to Synth<\/button>/);
    assert.match(html,/<input id="hucSongSeek"[^>]*type="range"[^>]*step="0\.01"/);
    assert.match(html,/<button id="hucSongCancelSeek"[^>]*>Cancel seek<\/button>/);
    assert.match(html,/<input id="hucSongCacheEnabled"[^>]*type="checkbox"[^>]*checked/);
    assert.match(html,/<button id="hucSongClearCache"[^>]*>Clear seek cache<\/button>/);
    assert.match(html,/<meta name="application-name" content="Tetorica HuC6280 Synth">/);
    assert.match(html,/<link rel="icon"[^>]+tetorica_huc6280_synth\.webp/);
    assert.match(html,/<link rel="apple-touch-icon"[^>]+tetorica_huc6280_synth\.webp/);
    assert.match(html,/<img[^>]+class="product-icon"[^>]+tetorica_huc6280_synth\.webp/);
    for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url=new URL(match[1],new URL(entry,'https://zip.invalid/'));
      if(url.origin==='https://zip.invalid') assert(info.names.includes(url.pathname.slice(1)),`${entry}: ${match[1]}`);
    }
  }
  assert.match(await readFile(join(a.stage,'licenses/mame-huc6280/LICENSE'),'utf8'),/Redistribution/);
  assert.deepEqual(await readFile(join(a.stage,'licenses/libvgm-msm5205/LICENSE')),await readFile(new URL('../third_party/libvgm-msm5205/LICENSE',import.meta.url)));
  assert.match(await readFile(join(a.stage,'README.md'),'utf8'),/sources\/MSM5205\.md/);
  assert.match(await readFile(join(a.stage,'README.md'),'utf8'),/sources\/CDDA\.md/);
  const original=await readFile(a.archive);await assert.rejects(packageHuc6280Synth({version:'test',releaseDir:join(directory,'a')}),/already exists/);assert.deepEqual(await readFile(a.archive),original);
});
