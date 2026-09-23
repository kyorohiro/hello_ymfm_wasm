import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
const fn=name=>{const start=source.indexOf(`function ${name}(`);return source.slice(start,source.indexOf('\n}',start)+2);};
test('Effect bypasses the main-thread gate at zero and reconnects only when required',()=>{
 const node=()=>({targets:[],gain:{},threshold:{},ratio:{},knee:{},attack:{},release:{},connect(n){this.targets.push(n);},disconnect(){this.targets=[];}});
 const chain={gainNode:node(),bassNode:node(),middleNode:node(),trebleNode:node(),dryGain:node(),wetGain:node(),compressorNode:node(),gateNode:node(),gateState:{},gateConnected:true};
 chain.trebleNode.connect(chain.gateNode);chain.gateNode.connect(chain.compressorNode);
 const settings={gain:100,bass:0,middle:0,treble:0,reverb:0,compressor:0,noiseGate:0};
 const c=vm.createContext({effectsChain:chain,effectSettings:settings});vm.runInContext(fn('applyEffectSettings'),c);
 c.applyEffectSettings();assert.deepEqual(chain.trebleNode.targets,[chain.compressorNode]);assert.equal(chain.gateNode.targets.length,0);
 c.applyEffectSettings();assert.equal(chain.trebleNode.targets.length,1);
 settings.noiseGate=10;c.applyEffectSettings();assert.deepEqual(chain.trebleNode.targets,[chain.gateNode]);assert.deepEqual(chain.gateNode.targets,[chain.compressorNode]);
 settings.noiseGate=0;c.applyEffectSettings();assert.deepEqual(chain.trebleNode.targets,[chain.compressorNode]);
});
test('dense Live History uses one path per channel and preserves key-off gaps',()=>{
 const history=Array.from({length:10000},(_,i)=>({time:i*.8,midiFloat:i===5000?null:60+i%12}));
 const original=structuredClone(history),out={innerHTML:''};
 const c=vm.createContext({noteishMode:{value:'overview'},songTimeMs:()=>8000,noteishOverviewY:n=>n,
  noteishChannels:()=>[{channel:0,noteHistory:history}],pruneChannelNoteHistory(){},
  clamp:(n,min,max)=>Math.min(max,Math.max(min,n)),NOTEISH_HISTORY_WINDOW_MS:8000,noteishOverview:out});
 vm.runInContext(fn('renderNoteishOverviewGraph'),c);c.renderNoteishOverviewGraph();
 assert.equal((out.innerHTML.match(/<path /g)||[]).length,1);
 assert.equal((out.innerHTML.match(/<circle /g)||[]).length,1);
 const path=out.innerHTML.match(/<path d="([^"]*)"/)[1];
 assert.equal((path.match(/M/g)||[]).length,2);
 assert.equal((path.match(/L/g)||[]).length,9997);
 assert.deepEqual(history,original);
});
