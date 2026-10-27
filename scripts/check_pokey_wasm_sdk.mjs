/** Exact POKEY comparison between two complete, hash-audited SDK WASM builds.
 * The standalone SDK smoke supplies independent DAC and dual-handle checks.
 * No browser, audio device, ROM or external dependency is used.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseWonderSwanParityArguments, validateWonderSwanParityPaths} from './check_wonderswan_wasm_sdk.mjs';
import {loadWasmSdkInventory, verifyWasmBuildDirectory} from './wasm_sdk_inventory.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Usage: node scripts/check_pokey_wasm_sdk.mjs --legacy-dir DIR --sdk-dir DIR [--out REPORT.json]';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const functions = ['pokey_create', 'pokey_destroy', 'pokey_reset', 'pokey_write', 'pokey_read', 'pokey_mute', 'pokey_generate', 'malloc', 'free'];

class Chip {
  constructor(module, clock, rate) {
    this.module = module;
    this.handle = module._pokey_create(clock, rate);
    assert(this.handle);
    this.left = module._malloc(32768 * 4); this.right = module._malloc(32768 * 4);
    assert(this.left && this.right);
  }
  apply([op, a, b]) {
    const m = this.module, h = this.handle;
    if (op === 'w') m._pokey_write(h, a, b);
    else if (op === 'u') m._pokey_mute(h, a, b);
    else if (op === 'r') m._pokey_reset(h);
    else assert.fail('Unknown operation ' + op);
  }
  render(frames) {
    assert(frames > 0 && frames <= 32768);
    const m = this.module;
    m._pokey_generate(this.handle, this.left, this.right, frames);
    return {left: m.HEAPF32.slice(this.left >>> 2, (this.left >>> 2) + frames),
      right: m.HEAPF32.slice(this.right >>> 2, (this.right >>> 2) + frames)};
  }
  dispose() {
    const m = this.module;
    m._pokey_destroy(this.handle); m._free(this.left); m._free(this.right);
  }
}
const init = [['w', 15, 3], ['w', 8, 0]];
const tone = (channel, divisor, control = 0xaf) => [['w', channel * 2, divisor], ['w', channel * 2 + 1, control]];
const at = (frame, commands) => commands.map(command => ({frame, command}));
const scenes = [{name: 'cold-silence', events: []},
  {name: 'four-tone-mute-reset', events: [...at(0, [...init, ...tone(0,31), ...tone(1,47,0xab), ...tone(2,63,0xa9), ...tone(3,79,0xa7), ['w',9,0]]),
    ...at(317,[['w',0,53],['w',2,83]]), ...at(911,[['u',1,1]]), ...at(1291,[['u',1,0]]), ...at(1801,[['r']])]}];
for (const distortion of [0,0x20,0x40,0x60,0x80,0xa0,0xc0,0xe0]) scenes.push({
  name: 'distortion-' + distortion.toString(16), events: [...at(0,[...init,...tone(0,17,distortion|15)]),
    ...at(997,[['w',8,0x80]]), ...at(1601,[['w',15,0]]), ...at(1741,[['w',15,3]])]});
for (const control of [1,0x40,0x20,0x50,0x28,6,0xff]) scenes.push({
  name: 'audctl-' + control.toString(16), events: [...at(0,[...init,...tone(0,71),...tone(1,2),...tone(2,37),...tone(3,3),['w',8,control],['w',9,0]]),
    ...at(701,[['w',0,43],['w',4,101]]), ...at(1507,[['w',9,0]])]});
scenes.push({name:'serial-two-tone',events:[...at(0,[...init,...tone(0,17),...tone(1,43),['w',15,0x8b]]),...at(977,[['w',15,3]])]},
  {name:'held-dac-mute',events:[...at(0,[...init,...tone(0,0,0x1f)]),...at(211,[['u',0,1]]),...at(509,[['u',0,0]]),
    ...at(1009,[...tone(1,0,0x1f),...tone(2,0,0x1f),...tone(3,0,0x1f)]),...at(1601,[0,1,2,3].map(ch=>['u',ch,1]))]});

function render(chip, scene, layout) {
  const frames = 2048, left = new Float32Array(frames), right = new Float32Array(frames);
  let pos=0, next=0, block=0;
  while(pos<frames) {
    while(scene.events[next]?.frame===pos) chip.apply(scene.events[next++].command);
    const count=Math.min(layout[block++%layout.length], frames-pos, (scene.events[next]?.frame??frames)-pos);
    assert(count>0);
    const pcm=chip.render(count); left.set(pcm.left,pos); right.set(pcm.right,pos); pos+=count;
  }
  return {left,right,reads:Uint8Array.from({length:16},(_,reg)=>chip.module._pokey_read(chip.handle,reg))};
}

async function backend(directory, inventory, verifySources) {
  const audit=await verifyWasmBuildDirectory({directory,inventory,verifySources});
  const record=audit.artifacts.find(entry=>entry.id==='pokey'); assert(record);
  const wasmBinary=await readFile(join(directory,'pokey_wasm.wasm'));
  const factory=(await import(pathToFileURL(join(directory,'pokey_wasm.js')).href)).default;
  const module=await factory({wasmBinary});
  for(const name of functions) assert.equal(typeof module['_'+name],'function','POKEY ABI '+name);
  const smoke=JSON.parse(execFileSync(process.execPath,[join(inventory.sdkRoot,'tests/pokey_wasm_smoke.mjs'),directory],
    {encoding:'utf8',maxBuffer:1024*1024}));
  assert.equal(smoke.passed,true); assert.equal(smoke.artifact,'pokey');
  return {module,record,smoke};
}

async function main() {
  const parsed=parseWonderSwanParityArguments(process.argv.slice(2));
  if(!parsed){console.log(usage);return;}
  const args=await validateWonderSwanParityPaths(parsed), inventory=await loadWasmSdkInventory();
  const legacy=await backend(args['--legacy-dir'],inventory,false), sdk=await backend(args['--sdk-dir'],inventory,true);
  assert.deepEqual(sdk.record.wasm.exports,legacy.record.wasm.exports,'POKEY export ABI');
  assert.deepEqual(sdk.record.wasm.imports,legacy.record.wasm.imports,'POKEY import ABI');
  const report={schemaVersion:1,passed:false,deviceOpened:false,maximumDifference:0,
    method:'Two audited SDK builds; real raw mono PCM/read map, exact partitions and reset replays. Standalone ABI smoke independently checks DAC gain, physical voices and dual-handle lifetime isolation.',
    limits:['Raw positive mono /32768; no application Mixer, speaker centering, browser timing or hardware equivalence.'],
    legacy:{directory:args['--legacy-dir'],record:legacy.record,smoke:legacy.smoke},
    sdk:{directory:args['--sdk-dir'],record:sdk.record,smoke:sdk.smoke},cases:[],totalComparedStereoFrames:0};
  for(const [clock,rate] of [[1789790,44100],[1789773,48000],[1773447,32000]]) for(const scene of scenes) {
    let baseline;
    for(const layout of [[2048],[1,3,127,2,509,64]]) {
      const a=new Chip(legacy.module,clock,rate), b=new Chip(sdk.module,clock,rate);
      try {
        const expected=render(a,scene,layout), actual=render(b,scene,layout);
        assert.deepEqual(actual,expected,scene.name); assert.deepEqual(expected.left,expected.right,'One POKEY is mono');
        if(baseline) assert.deepEqual(expected,baseline,'Partition invariance'); else baseline=expected;
        for(const value of expected.left) assert(Number.isFinite(value)&&value>=0&&value<=32767/32768);
        a.apply(['r']); b.apply(['r']);
        assert.deepEqual(render(a,scene,layout),expected,'Reference reset replay');
        assert.deepEqual(render(b,scene,layout),expected,'Candidate reset replay');
        report.totalComparedStereoFrames+=expected.left.length*4;
        report.cases.push({name:scene.name,clock,rate,layout,frames:expected.left.length,resetReplay:true,maximumDifference:0,
          pcmSha256:hash(Buffer.from(expected.left.buffer)),readsSha256:hash(expected.reads)});
      } finally {a.dispose();b.dispose();}
    }
  }
  report.passed=true;
  if(args['--out']){await mkdir(dirname(args['--out']),{recursive:true});await writeFile(args['--out'],JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
  console.log(JSON.stringify({passed:true,cases:report.cases.length,totalComparedStereoFrames:report.totalComparedStereoFrames,maximumDifference:0}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
