import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setupSynthCdda,resolveCddaInputPath} from './synth_cdda.js';
import {createSynthProject} from './synth_project.js';
import {createCDDAPCM} from '../js/cdda_pcm.js';
import {createTestCycle,generateTestPcmWav} from '../synth-huc6280/test_pcm.js';

const wasmBinary=await readFile(new URL('../generated/cdda_wasm.wasm',import.meta.url));
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function until(fn){for(let i=0;i<1000;i++){if(fn())return;await turn();}assert.fail('CD-DA host operation did not settle');}
const walk=node=>[node,...node.children.flatMap(walk)];
class Element extends EventTarget {
  constructor(doc,tag='div'){super();Object.assign(this,{ownerDocument:doc,tagName:tag.toUpperCase(),children:[],dataset:{},attributes:{},value:'',textContent:'',hidden:false,checked:false});}
  append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this.append(...nodes);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}
  querySelector(selector){return walk(this).find(node=>node.id===selector.slice(1))??null;}
  blur(){this.dispatchEvent(new Event('blur'));}click(){this.fire('click');}
  fire(type,extra={}){this.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{button:0,pointerId:1,clientX:30,clientY:30,...extra}));}
  getContext(){return null;}getBoundingClientRect(){return{left:0,top:0,width:320,height:150};}
  setPointerCapture(id){this.capture=id;}hasPointerCapture(id){return this.capture===id;}releasePointerCapture(){this.capture=null;}
}
const audioNode=context=>({context,edges:new Set(),disconnects:0,connect(target){this.edges.add(target);},disconnect(){this.disconnects++;this.edges.clear();}});
function audioContext(){
  const start=performance.now(),context={state:'running',sampleRate:48000,gains:[],get currentTime(){return(performance.now()-start)/1000;}};
  context.createGain=()=>{
    const node=audioNode(context);node.gain={value:1,events:[],cancelScheduledValues(at){this.events.push(['cancel',at]);},setValueAtTime(value,at){this.value=value;this.events.push(['set',value,at]);},linearRampToValueAtTime(value,at){this.value=value;this.events.push(['ramp',value,at]);}};
    context.gains.push(node);return node;
  };
  return context;
}
function fixture({ready,reader,ensureAudio}={}){
  const doc=new Element(null),win=new Element(doc),root=new Element(doc),testRoot=new Element(doc),timers=new Map();let timerSerial=0;
  doc.defaultView=win;doc.hidden=false;doc.createElement=tag=>new Element(doc,tag);win.devicePixelRatio=1;
  win.setTimeout=(fn,delay)=>{const id=++timerSerial;timers.set(id,{fn,delay});return id;};win.clearTimeout=id=>timers.delete(id);
  const ids=['cddaSourceSelect','cddaTrackSelect','cddaLoadSource','cddaPlay','cddaStop','cddaSeek','cddaSourceState','cddaSourceInfo','cddaSourceStatus','cddaPosition','cddaStorageNote','cddaSessionInput','cddaClearSession','cddaCancelLoad','cddaAddFiles','cddaOpenSession'];
  for(const id of ids){const node=new Element(doc);node.id=id;root.append(node);}root.append(testRoot);
  const project=createSynthProject(),adapters=[],messages=[];let context=audioContext(),input=audioNode(context),mix={volume:.8,pan:0,muted:false,effectiveMuted:false},master=.5,ensures=0,opens=0,updates=0,adds=0;
  const host=setupSynthCdda({project,ready,root,testRoot,...(reader?{readFile:reader}:{}),
    ensureAudio:async()=>{ensures++;await ensureAudio?.();},getContext:()=>context,getInput:()=>input,getMix:()=>mix,getMaster:()=>master,
    onStatus:(...args)=>messages.push(args),onOutput:()=>{updates++;},openOutput:()=>{opens++;},addFiles:()=>{adds++;},
    createAudio:async(ctx,{signal})=>{
      const core=await createCDDAPCM({sampleRate:ctx.sampleRate,wasmBinary}),node=audioNode(ctx);
      const adapter={node,core,disposed:false,prepares:0,
        async prepare(bytes){signal.throwIfAborted();this.prepares++;core.prepare(bytes.slice());},
        async command(action){signal.throwIfAborted();if(this.disposed)throw Error('Retired audio endpoint');
          if(action.type==='state')return core.status();
          if(action.type==='play'){core.play();if(action.sourceFrame)core.seek(action.sourceFrame);}
          else if(action.type==='seek')core.seek(action.sourceFrame);else core[action.type]();return core.status();
        },
        dispose(){if(this.disposed)return;this.disposed=true;node.disconnect();core.dispose();},
        render(frames=512){const left=new Float32Array(frames),right=new Float32Array(frames);core.render(left,right);return{left,right};},
      };
      adapters.push(adapter);signal.addEventListener('abort',()=>adapter.dispose(),{once:true});return adapter;
    },
  });
  return{host,project,root,testRoot,doc,win,timers,adapters,messages,node:id=>root.querySelector('#'+id),
    shape:shape=>walk(testRoot).find(node=>node.dataset.testShape===shape),get context(){return context;},get input(){return input;},get mix(){return mix;},
    setMix:value=>{mix={...mix,...value};},setMaster:value=>{master=value;},replaceContext(){context=audioContext();input=audioNode(context);return context;},
    get ensures(){return ensures;},get opens(){return opens;},get updates(){return updates;},get adds(){return adds;},
  };
}

test('CD-DA initializes the displayed Sine only after Files restoration without creating audio or portable WAVs',async()=>{
  const ready=deferred(),f=fixture({ready:ready.promise});
  try {
    assert.equal(f.host.source.read().asset,null);assert.equal(f.ensures,0);assert.equal(f.context.gains.length,0);
    ready.resolve();assert.equal(await f.host.ready,true);
    const state=f.host.source.read();assert.equal(state.state,'ready');assert.equal(state.track.frames,44100);assert.match(state.asset.name,/sine.*440 Hz/);assert.equal(state.asset.path,null);
    assert.equal(f.project.fs.list().length,0);assert.equal(f.ensures,0);assert.equal(f.adapters.length,0);assert.equal(f.host.gainNode,null);
    assert.equal(f.node('cddaPlay').disabled,false);assert.equal(await f.host.initialize(),false);
  }finally{ready.resolve();await f.host.dispose();}
});

test('generated test shapes save an owned standard WAV automatically and preserve an externally edited WAV',async()=>{
  const f=fixture();
  try {
    await f.host.ready;f.shape('triangle').click();await until(()=>f.host.source.read().asset?.path);
    const path=f.host.source.read().asset.path,first=f.project.fs.get(path);assert.equal(path,'/samples/CD-DA test wave.wav');
    assert.equal(new DataView(first.data.buffer).getUint32(24,true),44100);assert.equal(f.project.selectedPath,path);assert.equal(f.ensures,0);
    f.shape('saw').click();await until(()=>f.host.source.read().asset?.name.includes('saw'));
    assert.equal(f.host.source.read().asset.path,path);assert.equal(f.project.fs.list().filter(file=>/\.wav$/.test(file.path)&&!file.path.startsWith('/.tet.ss')).length,1);
    f.project.fs.writeBinary(path,first.data);f.shape('square').click();await until(()=>f.host.source.read().asset?.name.includes('square'));
    assert.notEqual(f.host.source.read().asset.path,path);assert.deepEqual(f.project.fs.get(path).data,first.data);
    assert.equal(f.ensures,0);f.node('cddaAddFiles').click();assert.equal(f.adds,1);
  }finally{await f.host.dispose();}
});

test('CD-DA routes once through its own source gain into the shared output and responds to Master and Mixer',async()=>{
  const f=fixture();
  try {
    await f.host.ready;f.node('cddaPlay').click();await until(()=>f.host.source.read().state==='playing'&&f.opens===1);
    assert.equal(f.ensures,1);assert.equal(f.adapters.length,1);assert.equal(f.context.gains.length,2);
    const sourceGain=f.host.gainNode,endpoint=f.context.gains.find(node=>node!==sourceGain);
    assert.deepEqual([...f.adapters[0].node.edges],[endpoint]);assert.deepEqual([...endpoint.edges],[sourceGain]);assert.deepEqual([...sourceGain.edges],[f.input]);
    assert.equal(sourceGain.gain.value,.4);const pcm=f.adapters[0].render().left,peak=pcm.reduce((value,sample)=>Math.max(value,Math.abs(sample)),0);
    assert(peak>.49&&peak<.501);assert(Math.abs(peak*sourceGain.gain.value-.2)<.001,'one volume×Master stage attenuates the waveform');
    f.setMix({volume:.3});f.setMaster(.2);f.host.refreshMix();assert.equal(sourceGain.gain.value,.06);
    f.setMaster(1);f.host.setMix();assert.equal(sourceGain.gain.value,.3,'Code can own Master downstream without a second host attenuation');
    f.setMix({effectiveMuted:true});f.host.refreshMix();assert.equal(sourceGain.gain.value,0);assert.equal((await f.host.source.getState()).mute,true);
    f.setMix({effectiveMuted:false});f.host.refreshMix();assert.equal((await f.host.source.getState()).volume,.3);
  }finally{await f.host.dispose();}
});

test('live generated waveform changes retain the playing keyboard owner and remain releasable',async()=>{
  const f=fixture();
  try {
    await f.host.ready;await f.host.keyboard.press('held',60);const generation=f.host.source.read().playbackGeneration;
    f.shape('square').click();await until(()=>f.host.source.read().asset?.name.includes('square'));
    assert.equal(f.host.source.read().state,'playing');assert.equal(f.host.source.read().playbackGeneration,generation);
    assert.equal(f.host.keyboard.read().activeId,'held');assert.equal(f.adapters.length,1);assert.equal(f.ensures,1);
    const pcm=f.adapters[0].render(4096).left;assert(pcm.some(value=>Math.abs(value)>.49));
    assert.equal(await f.host.keyboard.release('held'),true);assert.notEqual(f.host.source.read().state,'playing');
  }finally{await f.host.dispose();}
});

test('keyboard uses the original-rate shared track, releases in 8 ms, and cannot stop a newer Code play',async()=>{
  const f=fixture();
  try {
    await f.host.ready;assert.equal(await f.host.keyboard.press('key-a',12),true);assert.equal(f.host.source.read().track.sampleRate,44100);
    const sourceGain=f.host.gainNode,endpoint=f.context.gains.find(node=>node!==sourceGain),released=f.host.keyboard.release('key-a');
    const ramp=endpoint.gain.events.findLast(event=>event[0]==='ramp');assert.equal(ramp[1],0);
    const set=endpoint.gain.events.findLast(event=>event[0]==='set');assert(Math.abs(ramp[2]-set[2]-.008)<1e-7);
    assert.equal(await released,true);assert.notEqual(f.host.source.read().state,'playing');assert.equal(f.host.keyboard.read().heldCount,0);
    await f.host.keyboard.press('key-b',100);const client=await f.host.source.useCodeClient();await client.play();
    assert.equal(await f.host.keyboard.release('key-b'),false);assert.equal((await client.getState()).state,'playing');
    await f.host.stop();await assert.rejects(client.play(),{name:'AbortError'});assert(f.host.source.read().asset);assert.notEqual(f.host.source.read().state,'playing');
  }finally{await f.host.dispose();}
});

test('project manifests use relative Files reads while session WAVs stay outside Cassette and reset removes their references',async()=>{
  const f=fixture();
  try {
    await f.host.ready;const wav=generateTestPcmWav({cycle:createTestCycle(),duration:.2});
    f.project.fs.writeBinary('/album/track.wav',wav);f.project.fs.writeText('/album/tracks.cdda.json',JSON.stringify({tracks:[{number:3,file:'track.wav',title:'Authored album'}]}));
    f.host.controls.refreshSources();assert(f.node('cddaSourceSelect').children.some(group=>group.children.some(option=>option.value==='/album/tracks.cdda.json')));
    await f.host.source.load('/album/tracks.cdda.json');assert.equal(f.host.source.read().selectedTrack,3);assert.equal(f.host.source.read().track.frames,8820);
    assert.equal(resolveCddaInputPath('../album/track.wav','/code/song.js'),'/album/track.wav');
    const file=new Blob([wav]);Object.defineProperty(file,'name',{value:'Session.wav'});const [path]=f.host.session.addFiles([file]),before=f.project.snapshot();
    await f.host.source.load(path);assert.equal(f.host.source.read().asset.dependsSession,true);assert.deepEqual(f.project.snapshot(),before);assert.equal(f.project.fs.has(path),false);
    const client=await f.host.source.useCodeClient();await f.host.beforeWorkspaceReplace();await assert.rejects(client.play(),{name:'AbortError'});
    assert.equal(f.host.session.list().length,1,'preparation preserves session data until a replacement commits');
    await f.host.resetWorkspace();assert.equal(f.host.session.list().length,0);assert.equal(f.host.source.read().asset.path,null);assert.match(f.host.source.read().asset.name,/sine/);
    assert.equal(f.ensures,0);assert.equal(f.project.fs.has('/album/track.wav'),true);
  }finally{await f.host.dispose();}
});

test('workspace reset fences a pending file read and reinstalls an immediately usable passive default',async()=>{
  const read=deferred(),f=fixture({reader:()=>read.promise});
  try {
    await f.host.ready;const loading=f.host.source.load('/late.wav'),rejected=assert.rejects(loading,{name:'AbortError'});
    await until(()=>f.host.source.read().busy);await f.host.resetWorkspace();
    read.resolve(generateTestPcmWav({cycle:createTestCycle('square')}));await rejected;
    assert.match(f.host.source.read().asset.name,/sine/);assert.equal(f.host.source.read().asset.path,null);assert.equal(f.ensures,0);
    assert.equal(await f.host.keyboard.press('fresh',60),true);await f.host.keyboard.release('fresh');
  }finally{read.resolve(new Uint8Array());await f.host.dispose();}
});

test('a replacement AudioContext retires the previous endpoint and route before using the new Synth bus',async()=>{
  const f=fixture();
  try {
    await f.host.ready;await f.host.source.play();const oldGain=f.host.gainNode,old=f.adapters[0];
    f.replaceContext();assert.equal(f.host.refreshMix(),false);assert.equal(oldGain.edges.size,0);
    await f.host.source.play();assert.equal(old.disposed,true);assert.equal(f.adapters.length,2);assert.equal(f.ensures,2);
    assert.equal(f.host.gainNode.context,f.context);assert.deepEqual([...f.host.gainNode.edges],[f.input]);
  }finally{await f.host.dispose();}
});

test('Stop fences pending audio readiness before it can create a route or start the retired track',async()=>{
  const ready=deferred(),f=fixture({ensureAudio:()=>ready.promise});
  try {
    await f.host.ready;const playing=f.host.source.play(),rejected=assert.rejects(playing,{name:'AbortError'});
    await until(()=>f.ensures===1);await f.host.stop();ready.resolve();await rejected;
    assert.equal(f.host.gainNode,null);assert.equal(f.context.gains.length,0);assert.equal(f.adapters.length,0);
    assert.equal(f.host.source.read().state,'ready');await f.host.source.play();assert.equal(f.host.source.read().state,'playing');
    assert.equal(f.adapters.length,1);assert.equal(f.context.gains.length,2);
  }finally{ready.resolve();await f.host.dispose();}
});

test('disposing before Files readiness fences passive initialization and releases control/session references',async()=>{
  const ready=deferred(),f=fixture({ready:ready.promise});
  await f.host.dispose();ready.resolve();assert.equal(await f.host.ready,false);
  assert.equal(f.testRoot.children.length,0);assert.equal(f.ensures,0);assert.equal(f.host.gainNode,null);assert.equal(f.host.source.read().asset,null);
  assert.equal(await f.host.dispose(),true);
});
