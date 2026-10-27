#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Pokey} from '../web/pokey.js';
import {PokeyAudioEngine} from '../web/pokeyaudioengine.js';
import factory from '../docs/generated/pokey_wasm.js';
const wasmBinary=await fs.readFile(new URL('../docs/generated/pokey_wasm.wasm',import.meta.url));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tauri=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const output=path.resolve(process.argv[2]??await fs.mkdtemp(path.join(os.tmpdir(),'pokey-native-speaker-')));
await fs.mkdir(output,{recursive:true});
const binary=path.join(output,'pokey-speaker-fixture'),run=(program,args)=>{const r=spawnSync(program,args,{encoding:'utf8'});if(r.status!==0)throw new Error(`${program} failed (${r.status}): ${r.stderr||r.stdout}`);};
run(process.env.CXX??'c++',['-std=c++17','-O2','-ffp-contract=off',`-I${tauri}/src`,`-I${tauri}/vendor/tetorica-soundchip-native/vendor/libvgm-pokey`,`${tauri}/src/native_genesis_pokey.cpp`,`${tauri}/src/native_genesis_pokey_fixture.cpp`,`${tauri}/vendor/tetorica-soundchip-native/vendor/libvgm-pokey/pokey.cpp`,'-o',binary]);
const cases=[];
for(const rate of [44100,48000,96000])for(const clock of [1789790,1789773])for(let mode=0;mode<6;mode++){
 const pcmfile=path.join(output,`speaker-${rate}-${clock}-${mode}.f32`);run(binary,[String(rate),String(clock),String(mode),pcmfile]);
 const bytes=await fs.readFile(pcmfile),native=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4),chip=await Pokey.create({clock,sampleRate:rate,moduleFactory:factory,moduleOptions:{wasmBinary}}),engine=new PokeyAudioEngine(chip,1);
 const write=(r,v)=>engine.writeRegister(r,v),off=()=>{for(let ch=0;ch<4;ch++)write(ch*2+1,engine.registers[ch*2+1]&240);};
 write(15,3);write(8,mode===3?0x50:mode===4?4:0);for(let ch=0;ch<4;ch++){write(ch*2,72+ch*29);write(ch*2+1,mode===1?(0x80|(ch+1)*3):mode===2?0xaf:0xa8);}write(9,0);
 let maximum=0;
 for(let i=0;i<8192;i++){
  if(i===1024){engine.setChannelMuted(0,true);engine.setChannelMuted(2,true);}if(i===2048){engine.setChannelMuted(0,false);engine.setChannelMuted(2,false);}
  if(i===3072)off();if(i===4096){engine.reset();write(15,3);write(0,90);write(1,mode===5?0x1f:0xaa);write(9,0);}if(i===5120&&mode===5)write(1,0x10);if(i===6144&&mode===5)write(1,0x1f);if(i===7168)off();
  const pcm=engine.generateStereoView(1);maximum=Math.max(maximum,Math.abs(pcm.left[0]-native[i*2]),Math.abs(pcm.right[0]-native[i*2+1]));
 }
 engine.dispose();if(maximum!==0)throw new Error(`POKEY Native speaker differs at ${rate}/${clock}/${mode}: ${maximum}`);cases.push({rate,clock,mode,frames:8192,maximumDifference:maximum});
}
const receipt={cases:cases.length,frames:cases.reduce((n,c)=>n+c.frames,0),maximumDifference:Math.max(...cases.map(c=>c.maximumDifference)),results:cases};await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
