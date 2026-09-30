import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createWorkerChip} from './playground_worker_chip.js';
import {createChipPortReceiver} from './playground_chip_port.js';
import {YM2612DacPlayer, receiveDacCommand} from './ym2612_dac.js';
import {YM2612Synth, YM2612DirectTransport} from './ym2612synth.js';
import {createFmProxy} from './playground_sync.js';
const source=readFileSync(new URL('../docs/playground/examples/dac/dac-pcm-sample.js',import.meta.url),'utf8');

function workerFixture() {
 const writes=[],held=[];
 let hold=false;
 const player=new YM2612DacPlayer(48000,(...args)=>writes.push(args));
 const port={start(){},postMessage(commands){queueMicrotask(()=>receiverPort.onmessage({data:commands}));}};
 const receiverPort={start(){},close(){},postMessage(data){
  if(hold)held.push(data);else queueMicrotask(()=>port.onmessage({data}));
 }};
 const receiver=createChipPortReceiver((command,reply)=>{
  if(receiveDacCommand(player,command,0,reply))return;
  if(command.type==='clear-dac-playback')player.stop();
 },()=>0);
 receiver({type:'attach-chip-port',port:receiverPort});
 const chip=createWorkerChip({port,capabilities:{chip:'ym2612',dac:true,fmChannels:6}});
 return {chip,player,writes,hold(){hold=true;},flush(){hold=false;for(const data of held)port.onmessage({data});held.length=0;}};
}

for(const mode of ['main','worker'])test(`Playground PCM example runs in ${mode}, registers before looping and reuses PCM`,async()=>{
 let fm,player,render;
 if(mode==='worker'){
  const f=workerFixture();fm=f.chip.fm;player=f.player;render=()=>{player.advance(0);};
 }else{
  const transport=new YM2612DirectTransport({sampleRate:()=>48000,reset(){},writeRegister(){},generateStereo:n=>({left:new Float32Array(n),right:new Float32Array(n)})});
  fm=createFmProxy(new YM2612Synth({transport}));render=()=>transport.generateStereo(1);
  Object.defineProperty(fm,'player',{get:()=>transport.dacPlayer});
 }
 let loop;
 const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
 await new AsyncFunction('fm','liveLoop','sleep',source)(fm,(name,fn)=>{assert.equal(name,'dac-voice');loop=fn;},async seconds=>assert.equal(seconds,.75));
 player??=fm.player;
 assert.ok(player.samples.has('voice'));
 const registered=player.samples.get('voice').data;
 await loop();render();
 assert.equal(player.active.data,registered);
 await loop();
 assert.equal(player.queue[0].data,registered);
 await fm.dac.stop();
 assert.equal(player.active,null);assert.equal(player.queue.length,0);
});

test('Worker Stop rejects pending DAC acknowledgements and permits a fresh Run',async()=>{
 const f=workerFixture();f.hold();
 const pending=f.chip.fm.dac.setSample('voice',[128,180],{sampleRate:11025});
 await Promise.resolve();
 f.chip.stop();
 await assert.rejects(pending,/Run stopped/);
 f.flush();
 await assert.rejects(f.chip.fm.dac.playFromSample('voice'),/Run stopped/);
 f.chip.resume();
 await f.chip.fm.dac.setSample('voice',[128,180],{sampleRate:11025});
 await f.chip.fm.dac.playFromSample('voice');
 assert.equal(f.player.queue.length,1);
 f.chip.stop();await Promise.resolve();
 assert.equal(f.player.queue.length,0);
});
