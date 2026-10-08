import {SourceTextModule} from 'node:vm';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
const root=resolve(process.argv[2]);let count=0;const errors=[];
function check(file,spec){if(!spec.startsWith('.'))return;const target=resolve(dirname(file),spec.split(/[?#]/)[0]);count++;if(!existsSync(target)||relative(root,target).startsWith('..'))errors.push(`${relative(root,file)}: ${spec}`);}
function walk(dir){for(const ent of readdirSync(dir,{withFileTypes:true})){if(['vendor','examples','samples'].includes(ent.name))continue;const f=resolve(dir,ent.name);if(ent.isDirectory()){walk(f);continue;}if(!f.endsWith('.js'))continue;const src=readFileSync(f,'utf8');const mod=new SourceTextModule(src);for(const spec of mod.dependencySpecifiers)check(f,spec);for(const m of src.matchAll(/new URL\(\s*["']([^"']+)["']\s*,\s*import.meta.url/g))check(f,m[1]);}}
walk(root);
for(const file of ['js/rf5c164.js','js/playground_rf5c164.js','js/playground_rf5c164_audio.js','js/rf5c164-worklet.js','generated/rf5c164_wasm.js','generated/rf5c164_wasm.wasm','licenses/mame-rf5c164/LICENSE','licenses/mame-rf5c164/README.md','examples/genesis/rf5c164-sine.js','llms.txt','js/playground_nes.js','js/playground_nes_audio.js','js/playground_nes_worklet.js','js/nesapu.js','js/nesapusynth.js','js/nesapuaudioengine.js','js/fds_audio.js','licenses/jsnes/LICENSE','licenses/jsnes/AUTHORS.md','licenses/fixnes-fds/LICENSE','examples/nes/nes-apu-tones.js','examples/nes/nes-fds-wave.js','examples/nes/nes-dmc-sample.js'])if(!existsSync(resolve(root,file)))errors.push(file);
if(errors.length){console.error(errors.join('\n'));process.exit(1);}console.log(`PASS: ${count} local module/asset references plus RF5C164/NES release assets`);
