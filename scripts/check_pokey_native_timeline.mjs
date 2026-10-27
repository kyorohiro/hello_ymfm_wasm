#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Pokey} from '../web/pokey.js';
import {PokeyAudioEngine} from '../web/pokeyaudioengine.js';
import {preparePokeyTimeline,createPokeyTimelineCursor} from '../web/pokey_timeline.js';
import factory from '../docs/generated/pokey_wasm.js';
const usage='Usage: node scripts/check_pokey_native_timeline.mjs [OUTPUT_DIRECTORY]';
if(process.argv.length===3&&process.argv[2]==='--help'){console.log(usage);process.exit(0);}
if(process.argv.length>3||process.argv[2]?.startsWith('-'))throw new Error(usage);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(process.argv[2]??await fs.mkdtemp(path.join(os.tmpdir(),'pokey-native-timeline-')));
await fs.mkdir(output,{recursive:true});const capture=path.join(output,'native.json');
const args=['test','--locked','--manifest-path',path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri/Cargo.toml'),'extra_pokey_timeline_native_pcm_matches_exact_register_schedule_at_both_rates','--no-default-features'];
const result=spawnSync('cargo',args,{encoding:'utf8',env:{...process.env,TETORICA_POKEY_TIMELINE_CAPTURE:capture}});
await fs.writeFile(path.join(output,'cargo.log'),`${result.stdout??''}${result.stderr??''}`);if(result.status!==0)throw new Error(`Native timeline fixture failed: ${result.stderr||result.stdout}`);
const wasmBinary=await fs.readFile(new URL('../docs/generated/pokey_wasm.wasm',import.meta.url)),cases=[];
for(const c of JSON.parse(await fs.readFile(capture,'utf8'))){
 const trace=preparePokeyTimeline({...c.trace,data:new Uint8Array(c.trace.data)},{sampleRate:c.sampleRate}),cursor=createPokeyTimelineCursor(trace,c.sampleRate);
 const chip=await Pokey.create({clock:trace.clock,sampleRate:c.sampleRate,moduleFactory:factory,moduleOptions:{wasmBinary}}),engine=new PokeyAudioEngine(chip,1);let maximumDifference=0;
 for(let i=0;i<c.pcm.length;i++){
  const absolute=c.initialFrame+i;
  if(absolute===c.startFrame)engine.reset();
  if(absolute>=c.startFrame){const frame=absolute-c.startFrame;cursor.advance(frame,(r,v)=>engine.writeRegister(r,v));if(frame===cursor.durationFrames)for(let ch=0;ch<4;ch++)engine.writeRegister(ch*2+1,engine.registers[ch*2+1]&240);}
  const pcm=engine.generateStereoView(1);maximumDifference=Math.max(maximumDifference,Math.abs(c.pcm[i]-pcm.left[0]),Math.abs(c.pcm[i]-pcm.right[0]));
 }
 engine.dispose();if(maximumDifference!==0)throw new Error(`Native/JS POKEY timeline PCM differs at ${c.sampleRate}: ${maximumDifference}`);cases.push({sampleRate:c.sampleRate,frames:c.pcm.length,initialFrame:c.initialFrame,startFrame:c.startFrame,maximumDifference});
}
const receipt={cases:cases.length,frames:cases.reduce((sum,c)=>sum+c.frames,0),maximumDifference:Math.max(...cases.map(c=>c.maximumDifference)),results:cases};await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
