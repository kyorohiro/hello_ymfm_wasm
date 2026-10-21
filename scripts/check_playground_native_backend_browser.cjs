// Real shared Playground/settings, real Web Audio regression, mocked native IPC.
// No native audio device is opened. Native PCM is covered by Rust/C++ offline tests.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {chromium, webkit} = require('playwright');
const rootOption = process.argv.find(value => value.startsWith('--root='));
const docs = rootOption ? path.resolve(rootOption.slice(7)) : path.resolve(__dirname, '../docs');
const entryPath = rootOption ? '/index.html' : '/playground/index.html';
const nativeModeIds=['genesis','mega-cd','gameboy','nes','snes','pc-engine','dx7'];
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'};
const accessor = '\nwindow.__nativeBackendTest={runtime,selectedMode,importVgmFile,virtualFiles,get editor(){return editorAdapter}};';
const source = `// Native/Web Audio project handoff regression.
setBpm(120);
fm.setPreset(CH1, FM_PRESETS['one-op-basic']);
liveLoop('shared-phrase', async () => {
  for (const note of ['E3','G3','A3','B3','D4']) {
    await play(note, {channel:CH1, duration:0.8});
    await beat(cycle([0.04,0.04,0.08]));
  }
});`;
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = path.resolve(docs, '.' + pathname);
    if (!file.startsWith(docs + path.sep)) throw Error('Invalid path');
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
    let body = await fs.readFile(file);
    if (pathname.endsWith('/playground.js')) body = Buffer.from(body.toString() + accessor);
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(body);
  } catch (error) {response.writeHead(404).end(String(error));}
});

class FakeNative {
  constructor() {
    this.calls = []; this.sessions = 0; this.current = null; this.failStart = false;
    this.monitor = {pending:0,maxPending:0,reads:[],gate:null};
    this.liveFx = new Map(); this.liveFxError = null;
  }
  holdNextMonitor(mode) {
    let release,arrive;
    const gate={mode,promise:new Promise(done=>{release=done;}),arrived:new Promise(done=>{arrive=done;}),release:()=>release(),arrive};
    gate.arrive=value=>{gate.request=value;arrive(value);};
    this.monitor.gate=gate;return gate;
  }
  monitorSnapshot(args) {
    const amplitude=args.channel===1?.1:.4;
    const result={session:args.session,frame:this.status().frame,sampleRate:48000,frames:4096,rms:amplitude/Math.SQRT2,peak:amplitude};
    const bin=args.channel===1?96:32;
    if(args.mode==='waveform')result.samples=Array.from({length:4096},(_,i)=>amplitude*Math.sin(2*Math.PI*bin*i/4096));
    if(args.mode==='spectrum'){result.bins=Array(2048).fill(-100);result.bins[bin]=args.channel===1?-30:-12;}
    return result;
  }
  status() {
    if (!this.current) throw Error('No native session');
    return {session:this.current.session,sampleRate:48000,frame:Math.floor((performance.now() - this.current.began) * 48),
      ymClock:7670454,psgClock:3579545,mode:this.current.mode,rf5c164Clock:this.current.mode==='mega-cd'?12500000:null,running:true,queued:0,lateCommands:0,queueOverflows:0,error:null,
      liveFx:{active:this.liveFx.size,initialized:this.liveFx.size>0,latencyFrames:this.liveFx.size?2048:0,
        blockFrames:128,queuedCommands:0,processCalls:0,underruns:0,overruns:0,error:this.liveFxError}};
  }
  async invoke(command, args = {}) {
    this.calls.push({command,args});
    if (command === 'native_genesis_start') {
      if (this.failStart) {this.failStart = false; throw Error('Simulated native device unavailable');}
      this.liveFx.clear(); this.liveFxError = null;
      assert(args.mode===undefined||nativeModeIds.includes(args.mode));
      this.current = {session:++this.sessions,began:performance.now(),mode:args.mode??'genesis'};
      const {RfInspectorState}=await import('../web/playground_chip_inspector_state.js');
      this.pcm=new RfInspectorState({writeRegister(){},loadMemory(){},reset(){}},{sampleRate:48000});
      this.pcmMemory=new Uint8Array(65536);
      this.pcmVoices=Array(8).fill(0);
      const {createInitVoice}=await import('../web/msfa_dx7/src/sysex.js');
      this.dx7={voices:[Array.from(createInitVoice())],selectedVoice:0,revision:0};
      this.dx7Notes=new Map();
      const {NesApu}=await import('../web/nesapu.js');
      const {NesVoiceInspector}=await import('../web/playground_native_voice_inspector.js');
      this.nesClock=1789773;this.nesChip=new NesApu({sampleRate:48000,fds:true});
      this.nesInspector=new NesVoiceInspector(this.nesChip,{clock:()=>this.nesClock,sampleRate:48000});
      const {GameboyVoiceInspector}=await import('../web/playground_native_voice_inspector.js');
      this.gameboyClock=4194304;this.gameboyChip={writeRegister(){},reset(){}};
      this.gameboyInspector=new GameboyVoiceInspector(this.gameboyChip,{clock:()=>this.gameboyClock,sampleRate:48000});
      const {Huc6280VoiceInspector}=await import('../web/playground_huc6280_inspector.js');
      this.hucClock=3579545;this.hucInspector=new Huc6280VoiceInspector({clock:()=>this.hucClock,sampleRate:48000});
      this.snes={registers:new Uint8Array(128),ram:new Uint8Array(65536),enabled:0,nativeFrames:0,
        timeline:{loaded:false,playing:false,positionFrames:0,totalFrames:0,ended:false}};
      return this.status();
    }
    if (!command.startsWith('native_genesis_')) return null;
    if (command === 'native_genesis_shutdown') {
      if (this.current?.session === args.session) this.current = null;
      return null;
    }
    if (!this.current || this.current.session !== args.session) throw Error('Stale native audio session');
    if(command==='native_genesis_monitor') {
      assert(['off','envelope','waveform','spectrum'].includes(args.mode));assert([0,1].includes(args.channel));
      if(args.mode==='off')return null;
      const observation={...args,time:performance.now()};this.monitor.reads.push(observation);
      this.monitor.pending++;this.monitor.maxPending=Math.max(this.monitor.maxPending,this.monitor.pending);
      const result=this.monitorSnapshot(args),gate=this.monitor.gate;
      try {
        if(gate&&gate.mode===args.mode){this.monitor.gate=null;gate.arrive(observation);await gate.promise;}
        return result;
      } finally {this.monitor.pending--;}
    }
    if (command === 'native_genesis_stop') {this.liveFx.clear();this.liveFxError=null;if(this.pcm)this.pcm.mask=255;this.pcmVoices.fill(0);this.dx7Notes.clear();this.nesInspector?.stopVoices();this.stopConsoleVoices();return this.status();}
    if (command === 'native_genesis_status') return this.status();
    if (command === 'native_genesis_rf5c164_status') {assert.equal(this.current.mode,'mega-cd');const state=this.pcm.read();return {...state,mask:this.pcm.mask,selected:this.pcm.selected,channels:state.channels.map(channel=>({...channel,configuredStep:this.pcm.configuredSteps[channel.channel]}))};}
    if(command==='native_genesis_dx7_status') {
      assert.equal(this.current.mode,'dx7');
      return {...this.dx7,voices:this.dx7.voices.map(voice=>voice.slice()),frame:this.status().frame,
        pendingCommands:[],activeNotes:[...this.dx7Notes].map(([midi,note])=>({midi,velocity:note.velocity}))};
    }
    if(command==='native_genesis_nes_status') {
      assert.equal(this.current.mode,'nes');
      const inspector=this.nesInspector;
      return {clock:this.nesClock,registers:Array.from(inspector.registers),enabled:inspector.enabled,
        fdsGain:inspector.fdsGain,fdsMaster:inspector.fdsMaster,modulation:Array.from(inspector.modTable),
        memoryRanges:inspector.memoryRanges.map(range=>({...range})),fdsActive:!(inspector.registers[0x83]&128)};
    }
    if(command==='native_genesis_gameboy_status') {
      assert.equal(this.current.mode,'gameboy');const i=this.gameboyInspector;
      return {clock:this.gameboyClock,registers:Array.from(i.registers),voice:Array.from(i.voice),gates:i.gates.slice(),frame:this.status().frame,revision:0,pendingCommands:[]};
    }
    if(command==='native_genesis_huc6280_status') {
      assert.equal(this.current.mode,'pc-engine');const i=this.hucInspector;
      return {clock:this.hucClock,selectedChannel:i.selected,globals:Array.from(i.globals),registers:i.registers.map(row=>Array.from(row)),
        waveforms:i.waveforms.map(row=>Array.from(row)),indices:Array.from(i.indices),pointerKnown:Array.from(i.pointerKnown,Boolean),
        waveformKnown:Array.from(i.waveformKnown,Boolean),knownSamples:Array.from(i.knownSamples),ddaValues:Array.from(i.ddaValues),initialized:true,
        frame:this.status().frame,revision:0,pendingCommands:[]};
    }
    if(command==='native_genesis_snes_status') {
      assert.equal(this.current.mode,'snes');const s=this.snes;if(s.timeline.playing){s.timeline.positionFrames=Math.min(s.timeline.totalFrames,Math.floor((performance.now()-s.timeline.began)*32));if(s.timeline.positionFrames===s.timeline.totalFrames){s.timeline.ended=true;s.timeline.playing=false;}}
      const {began,...timeline}=s.timeline;
      return {clock:1024000,registers:Array.from(s.registers),...(args.ram?{ram:Array.from(s.ram)}:{}),nativeFrames:s.nativeFrames,enabled:s.enabled,
        frame:this.status().frame,revision:0,pendingCommands:[],timeline};
    }
    if (command === 'native_genesis_live_fx') {
      const message=args.message;
      assert.equal(message?.op,'live-fx');assert(['register','context','remove'].includes(message.action));
      assert.equal(typeof message.name,'string');assert(message.name.length>0&&Buffer.byteLength(message.name,'utf8')<=128);
      assert.equal(Object.prototype.hasOwnProperty.call(message,'context'),false,'Native liveFx context must use the portable graph');
      if(message.action==='register') {
        assert.equal(typeof message.source,'string');assert.equal(message.contextGraph?.version,1);
        this.liveFx.set(message.name,message);
      } else if(message.action==='context') {
        assert.equal(message.contextGraph?.version,1);
      } else this.liveFx.delete(message.name);
      return this.status();
    }
    if (command === 'native_genesis_commands') {
      assert(Array.isArray(args.commands) && args.commands.length > 0 && args.commands.length <= 4096);
      assert(args.commands.every(entry => Number.isSafeInteger(entry.frame) && entry.frame >= 0));
      const applyNes=message=>{
        if(message.method==='write')this.nesChip.writeRegister(message.address,message.value);
        else if(message.method==='enable')this.nesChip.setChannelEnabled(message.channel,message.enabled);
        else if(message.method==='load-memory'){assert(Array.isArray(message.data)&&message.data.length<=65536-message.address);this.nesChip.loadMemory(Uint8Array.from(message.data),message.address);}
        else if(message.method==='reset')this.nesChip.reset();
        else if(message.method==='stop-voices')this.nesInspector.stopVoices();
        else if(message.method==='clock')this.nesClock=message.hz;
        else if(message.method==='batch'){
          assert(Array.isArray(message.commands));message.commands.forEach(applyNes);
          if(message.fdsGain!==undefined)this.nesInspector.fdsGain=message.fdsGain;
          if(message.fdsMaster!==undefined)this.nesInspector.fdsMaster=message.fdsMaster;
        }
        else assert.equal(message.method,'mix','Unknown Native NES operation '+message.method);
      };
      for(const entry of args.commands.filter(entry=>entry.type==='nes')){assert.equal(this.current.mode,'nes');applyNes(entry.message);}
      const applyConsole=(kind,message)=>{
        if(message.method==='batch'){for(const op of message.commands)applyConsole(kind,op);return;}
        if(kind==='gameboy'){
          if(message.method==='write')this.gameboyChip.writeRegister(message.address,message.value);
          else if(message.method==='reset')this.gameboyChip.reset();
          else if(message.method==='clock')this.gameboyClock=message.hz;
          else if(message.method==='stop-voices')this.stopConsoleVoices('gameboy');
          else assert.equal(message.method,'mix','Unknown Native Game Boy operation');
        }else if(kind==='huc6280'){
          const i=this.hucInspector;
          if(message.method==='write'){if(message.channel!==undefined)i.observeWrite(0,message.channel);i.observeWrite(message.register,message.value);}
          else if(message.method==='waveform'){i.waveforms[message.channel].set(message.samples);i.indices[message.channel]=0;i.waveformKnown[message.channel]=i.pointerKnown[message.channel]=1;i.knownSamples[message.channel]=0xffffffff;i.registers[message.channel][4]&=127;}
          else if(message.method==='key-off')i.registers[message.channel][4]&=127;
          else if(message.method==='reset')i.reset();
          else if(message.method==='clock')this.hucClock=message.hz;
          else if(message.method==='stop-voices')this.stopConsoleVoices('huc6280');
          else assert.equal(message.method,'mix','Unknown Native HuC6280 operation');
        }else{
          const s=this.snes;
          if(message.method==='write'){s.registers[message.register]=message.value;if(message.register===0x4c)s.enabled|=message.value;if(message.register===0x5c)s.enabled&=~message.value;}
          else if(message.method==='load-memory')s.ram.set(message.data,message.address);
          else if(message.method==='key-on'){s.enabled|=1<<message.channel;s.registers[0x5c]&=~(1<<message.channel);s.registers[0x4c]=1<<message.channel;}
          else if(message.method==='key-off'){s.enabled&=~(1<<message.channel);s.registers[0x5c]|=1<<message.channel;}
          else if(message.method==='reset'){s.registers.fill(0);s.ram.fill(0);s.enabled=0;s.timeline={loaded:false,playing:false,positionFrames:0,totalFrames:0,ended:false};}
          else if(message.method==='stop-voices')this.stopConsoleVoices('snes');
          else if(message.method==='prepare-timeline'){s.ram.set(message.ram);s.registers.set(message.dsp);s.timeline={loaded:true,playing:false,positionFrames:0,totalFrames:message.durationClocks/32,ended:false};}
          else if(message.method==='play-timeline'){s.timeline.positionFrames=0;s.timeline.ended=false;s.timeline.playing=true;s.timeline.began=performance.now();}
          else if(message.method==='stop-timeline')s.timeline.playing=false;
          else assert.equal(message.method,'mix','Unknown Native SNES operation');
        }
      };
      for(const kind of ['gameboy','snes','huc6280'])for(const entry of args.commands.filter(entry=>entry.type===kind)){assert.equal(this.current.mode,kind==='huc6280'?'pc-engine':kind);applyConsole(kind,entry.message);}
      if(['gameboy','snes','pc-engine'].includes(this.current.mode))assert(args.commands.every(entry=>!['write','psg-write','psg-stereo','reset','dx7','nes'].includes(entry.type)&&!entry.type.startsWith('rf5c164-')),'Native consoles must never send hidden sound chips');
      if(this.current.mode==='nes')assert(args.commands.every(entry=>!['write','psg-write','psg-stereo','reset','dx7'].includes(entry.type)&&!entry.type.startsWith('rf5c164-')),'NES mode must never send hidden OPN/PSG/DX7/PCM commands');
      for(const entry of args.commands.filter(entry=>entry.type==='dx7')) {
        assert.equal(this.current.mode,'dx7','Only DX7 mode may accept DX7 commands');
        const message=entry.message;
        assert(message&&typeof message.method==='string');
        const voice=bytes=>assert(Array.isArray(bytes)&&bytes.length===155&&bytes.every(value=>Number.isInteger(value)&&value>=0&&value<=127),'DX7 patch must be 155 unpacked 7-bit bytes');
        if(message.method==='load-bank') {
          assert([1,32].includes(message.voices?.length));message.voices.forEach(voice);
          this.dx7.voices=message.voices.map(bytes=>bytes.slice());this.dx7.selectedVoice=0;this.dx7.revision++;
        } else if(['set-preset','edit-voice'].includes(message.method)) {
          voice(message.voice);
          if(message.method==='edit-voice') {
            assert(Array.isArray(message.indices)&&new Set(message.indices).size===message.indices.length);
            assert(message.indices.every(index=>Number.isInteger(index)&&index>=0&&index<155));
            for(const index of message.indices)this.dx7.voices[this.dx7.selectedVoice][index]=message.voice[index];
          } else this.dx7.voices[this.dx7.selectedVoice]=message.voice.slice();
          this.dx7.revision++;
        } else if(message.method==='select-voice') {
          assert(Number.isInteger(message.index)&&message.index>=0&&message.index<this.dx7.voices.length);
          this.dx7.selectedVoice=message.index;this.dx7.revision++;
        } else if(message.method==='note-on') {
          assert(Number.isInteger(message.note)&&message.note>=0&&message.note<=127);
          assert(Number.isInteger(message.velocity)&&message.velocity>=0&&message.velocity<=127);
          if(message.velocity)this.dx7Notes.set(message.note,{voice:message.voice,velocity:message.velocity});
          else this.dx7Notes.delete(message.note);
        } else if(message.method==='note-off') {
          if(message.voice===undefined||this.dx7Notes.get(message.note)?.voice===message.voice)this.dx7Notes.delete(message.note);
        } else if(['all-notes-off','panic'].includes(message.method))this.dx7Notes.clear();
        else assert.equal(message.method,'mix','Unknown Native DX7 command '+message.method);
      }
      if(this.current.mode==='dx7')assert(args.commands.every(entry=>!['write','psg-write','psg-stereo','reset'].includes(entry.type)&&!entry.type.startsWith('rf5c164-')),'DX7 mode must never send hidden FM/PSG/PCM chip commands');
      for(const entry of args.commands.filter(entry=>entry.type.startsWith('rf5c164-'))) {
        assert.equal(this.current.mode,'mega-cd','Genesis must never accept PCM commands');
        if(entry.type==='rf5c164-write') {assert(Number.isInteger(entry.register)&&entry.register>=0&&entry.register<=8);assert(Number.isInteger(entry.value)&&entry.value>=0&&entry.value<=255);if(entry.audition)this.pcm.auditionWriting++;try{this.pcm.write(entry.register,entry.value);}finally{if(entry.audition)this.pcm.auditionWriting--;}}
        else if(entry.type==='rf5c164-load-memory') {assert(Number.isInteger(entry.offset)&&entry.offset>=0&&entry.offset<=65536);assert(Array.isArray(entry.data)&&entry.data.length<=65536-entry.offset);assert(entry.data.every(value=>Number.isInteger(value)&&value>=0&&value<=255));this.pcmMemory.set(entry.data,entry.offset);}
        else if(entry.type==='rf5c164-key-on'||entry.type==='rf5c164-key-off') {
          assert(Number.isInteger(entry.channel)&&entry.channel>=0&&entry.channel<8);
          assert(entry.voice===undefined||Number.isSafeInteger(entry.voice)&&entry.voice>0);
          if(entry.type==='rf5c164-key-on'){this.pcmVoices[entry.channel]=entry.voice??0;this.pcm.mask&=~(1<<entry.channel);}
          else if(entry.voice===undefined||this.pcmVoices[entry.channel]===entry.voice){this.pcm.mask|=1<<entry.channel;this.pcmVoices[entry.channel]=0;}
        }
        else {assert(['rf5c164-reset','rf5c164-mix','rf5c164-clock'].includes(entry.type),'Unknown Native PCM command '+entry.type);if(entry.type==='rf5c164-reset')this.pcm.reset();}
      }
      return this.status();
    }
    if (command === 'native_genesis_fx') {
      if(args.message?.op==='reset')this.liveFx.clear();
      return this.status();
    }
    if (['native_genesis_performance','native_genesis_media_load','native_genesis_media_remove','native_genesis_record_start'].includes(command)) return this.status();
    if (command === 'native_genesis_record_stop') return {sampleRate:48000,firstFrame:0,frames:16,complete:false,channels:[Array(16).fill(.1),Array(16).fill(-.1)]};
    throw Error('Unexpected native command: ' + command);
  }
  count(command) {return this.calls.filter(call => call.command === command).length;}
  stopConsoleVoices(kind) {
    if(!kind||kind==='gameboy'){const i=this.gameboyInspector;if(i){for(const address of [2,7,10,17])i.observeWrite(address,0);i.gates.fill(false);}}
    if(!kind||kind==='huc6280')for(const row of this.hucInspector?.registers??[])row[4]&=127;
    if((!kind||kind==='snes')&&this.snes){this.snes.enabled=0;this.snes.registers[0x4c]=0;this.snes.registers[0x5c]=255;this.snes.timeline.playing=false;}
  }
}

function observeAudioCreation() {
  window.__audioConstructions = {contexts:0,offline:0,worklets:[]};
  for (const key of ['AudioContext','OfflineAudioContext','webkitOfflineAudioContext','AudioWorkletNode']) {
    const Type = window[key];
    if (!Type) continue;
    window[key] = new Proxy(Type, {construct(Type, args, Target) {
      if (key === 'AudioContext') window.__audioConstructions.contexts++;
      else if (key.endsWith('OfflineAudioContext')) window.__audioConstructions.offline++;
      else window.__audioConstructions.worklets.push(args[1]);
      return Reflect.construct(Type,args,Target);
    }});
  }
}
function observeMonitorDrawing() {
  window.__monitorDrawings={};
  const Type=window.CanvasRenderingContext2D;if(!Type)return;
  const paths=new WeakMap(),proto=Type.prototype;
  const observed=context=>context.canvas?.id?.startsWith('audioMonitor');
  const begin=proto.beginPath;proto.beginPath=function(...args){if(observed(this))paths.set(this,[]);return begin.apply(this,args);};
  for(const key of ['moveTo','lineTo']) {
    const original=proto[key];proto[key]=function(x,y,...args){
      if(observed(this)){const points=paths.get(this);if(points&&points.length<8192)points.push([x,y]);}
      return original.call(this,x,y,...args);
    };
  }
  const stroke=proto.stroke;proto.stroke=function(...args){
    if(observed(this)&&['#69cfff','#ffba69'].includes(this.strokeStyle)) {
      const drawing=window.__monitorDrawings[this.canvas.id]??={revision:0,traces:{}};
      drawing.traces[this.strokeStyle]={revision:++drawing.revision,points:(paths.get(this)??[]).map(point=>point.slice())};
    }
    return stroke.apply(this,args);
  };
}
async function assertNoLiveAudio(page) {
  assert.deepEqual(await page.evaluate(() => ({contexts:window.__audioConstructions.contexts,worklets:window.__audioConstructions.worklets})),{contexts:0,worklets:[]});
}
async function ready(page) {
  await page.waitForFunction(() => Boolean(window.__nativeBackendTest));
  await page.locator('#startupNotice').waitFor({state:'hidden'});
}
async function openSettings(page) {
  await page.locator('#mainMenu > summary').click();
  await page.click('#audioEngineButton');
  await page.locator('#audioEngineDialog').waitFor({state:'visible'});
}
async function selectEngine(page, value) {
  await openSettings(page);
  await page.selectOption('#audioEngineSelect', value);
  await Promise.all([page.waitForURL(url => url.searchParams.get('audioEngine') === (value === 'native' ? 'native' : null)), page.click('#audioEngineApply')]);
  await ready(page);
  assert.equal(await page.evaluate(() => window.__nativeBackendTest.editor.getValue()), source);
}
async function modeIds(page) {
  return page.locator('#playgroundMode option').evaluateAll(options=>options.map(option=>option.value));
}
async function assertNativeModeRestriction(page,native) {
  assert.deepEqual(await modeIds(page),nativeModeIds,'Native must list only supported machine modes');
  const before={url:page.url(),session:native.current.session,shutdowns:native.count('native_genesis_shutdown')};
  // A forged option/change must pass the same support check as the visible UI.
  await page.evaluate(()=>{
    const select=document.getElementById('playgroundMode');
    const option=new Option('Forged MSX','msx');option.dataset.forgedMode='true';select.append(option);
    select.value='msx';select.dispatchEvent(new Event('change',{bubbles:true}));
  });
  assert.equal(await page.locator('#playgroundMode').inputValue(),'genesis');
  assert.equal(await page.locator('#changeModeDialog').evaluate(dialog=>dialog.open),false,'Unsupported mode must not open the project-transfer dialog');
  assert.equal(page.url(),before.url,'Unsupported mode must not navigate');
  assert.equal(native.current.session,before.session);
  assert.equal(native.count('native_genesis_shutdown'),before.shutdowns,'Unsupported mode must not stop the current Native stream');
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.runtime.getState().playback),'running');
  await page.locator('#playgroundMode option[data-forged-mode]').evaluate(option=>option.remove());
}
async function run(page) {
  await page.click('#runButton');
  await page.waitForFunction(() => window.__nativeBackendTest.runtime.getState().playback === 'running');
}
async function until(check,description='Native IPC expectation') {
  const end = Date.now() + 10000;
  while (!check()) {if (Date.now() > end) throw Error(description+' timed out'); await new Promise(resolve => setTimeout(resolve, 10));}
}
async function nativeRun(page, native) {
  const before = native.count('native_genesis_commands');
  await run(page);
  await until(() => native.count('native_genesis_commands') > before && native.calls.some(call => call.command === 'native_genesis_commands' && call.args.commands.some(entry => entry.type === 'write' && entry.register === 0x28 && entry.value & 0xf0)));
  assert.equal(await page.evaluate(() => window.__nativeBackendTest.runtime.megaDrive.backend), 'native-genesis');
  await assertNoLiveAudio(page);
  assert.equal(await page.evaluate(() => window.__nativeBackendTest.runtime.capabilities.worker), true);
}
async function workerMediaRun(page,native) {
  await page.evaluate(() => window.__nativeBackendTest.runtime.stopWithFade());
  const first=native.calls.length;
  await page.evaluate(async () => {
    await window.__nativeBackendTest.runtime.playSource(`
      setBpm(120);
      fm.setPreset(CH1,FM_PRESETS['one-op-basic']);
      const gain=fx.gain({gain:0.5});fx.setChain([gain]);gain.gain.rampTo(0.8,0.1);
      await sample.load('native-test',{sampleRate:22050,channels:[new Float32Array([0,.5,0,-.5])]});
      await sample.play('native-test',{loop:true});
      await fm.dac.setSample('native-dac',new Uint8Array([128,160,128,96]),{sampleRate:8000});
      await fm.dac.playFromSample('native-dac');
      psg.tone(PSG1,{note:'C4',attenuation:8});
      liveLoop('native-worker-phrase',async()=>{await play('E3',{channel:CH1,duration:0.1});await beat(0.1);});
    `,{execution:'worker'});
  });
  const calls=()=>native.calls.slice(first), commands=()=>calls().flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]);
  await until(()=>commands().some(c=>c.type==='write'&&c.register===0x28&&(c.value&0xf0)&&c.performance&&c.owner));
  assert(calls().some(c=>c.command==='native_genesis_performance'&&c.args.op==='start'));
  assert(calls().some(c=>c.command==='native_genesis_fx'&&c.args.message.op==='chain'&&c.args.performance));
  assert(calls().some(c=>c.command==='native_genesis_media_load'&&c.args.kind==='sample'));
  assert(commands().some(c=>c.type==='sample-play'&&c.performance&&c.frame>0));
  assert(commands().some(c=>c.type==='dac-play'&&c.performance&&c.frame>0));
  await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource('stopLoop("native-worker-phrase");',{execution:'worker'}));
  await until(()=>calls().some(c=>c.command==='native_genesis_performance'&&c.args.op==='cancel-owner'));
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  await until(()=>calls().some(c=>c.command==='native_genesis_performance'&&c.args.op==='stop'));
  // Reuse the existing Worker/ports after Stop with a fresh performance session.
  await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource('await play("G3",{channel:CH1,duration:0});',{execution:'worker'}));
  assert.equal(calls().filter(c=>c.command==='native_genesis_performance'&&c.args.op==='start').length,2);
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  await assertNoLiveAudio(page);
}
async function compressedSampleRuns(page,native) {
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  const beforeOffline=await page.evaluate(()=>window.__audioConstructions.offline);
  for(const [execution,alias,channels,sourceFrames] of [
    ['main','sonic-pi/drum-heavy-kick',1,11913],
    ['worker','sonic-pi/ambi-choir',2,69305],
  ]) {
    const first=native.calls.length;
    await page.evaluate(async({execution,alias})=>{
      await window.__nativeBackendTest.runtime.playSource(`
        await sample.load(${JSON.stringify(alias)});
        await sample.play(${JSON.stringify(alias)},{gain:0});
      `,{execution});
    },{execution,alias});
    const calls=native.calls.slice(first);
    const uploads=calls.filter(call=>call.command==='native_genesis_media_load'&&call.args.kind==='sample'&&call.args.name===alias);
    assert(uploads.length>0,`${execution}: actual FLAC decode must upload a native sample`);
    for(const {args} of uploads) {
      assert.equal(args.channels.length,channels);
      assert(Number.isInteger(args.sampleRate)&&args.sampleRate>=8000&&args.sampleRate<=384000);
      assert(args.channels.every(channel=>channel.length>10000&&channel.length===args.channels[0].length&&channel.every(Number.isFinite)));
      assert(args.channels.every(channel=>channel.some(value=>Math.abs(value)>1e-6)),`${execution}: decoded FLAC must contain audio`);
      assert(Math.abs(args.channels[0].length/args.sampleRate-sourceFrames/44100)<=2/args.sampleRate,`${execution}: decode must preserve FLAC duration`);
    }
    const play=calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]).find(command=>command.type==='sample-play'&&command.name===alias);
    assert(play,`${execution}: prepared FLAC must reach native playback`);
    if(execution==='worker')assert(play.performance&&play.owner&&play.frame>0);
    await assertNoLiveAudio(page);
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  }
  assert(await page.evaluate(before=>window.__audioConstructions.offline>before,beforeOffline),'Compressed samples must use the real offline decoder');
}
async function nativeNoiseRuns(page,native) {
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  for(const execution of ['main','worker']) {
    const first=native.calls.length;
    const commands=()=>native.calls.slice(first).flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]).filter(command=>command.type==='noise');
    await page.evaluate(async execution=>{
      await window.__nativeBackendTest.runtime.playSource(`
        liveLoop('native-noise',async()=>{
          const voice=noise.create({type:'pink',seed:1234,autoStart:false,gain:0.05,pan:-0.25,attack:0.01,release:0.02});
          voice.filter.set('highpass',400,0.7);
          voice.start();
          control(voice,{gain:0.08,pan:0.5,cutoff:1200,q:0.8,slide:0.1});
          await sleep(60);
        });
      `,{execution});
    },execution);
    await until(()=>commands().some(command=>command.message.action==='parameter'&&command.message.seconds===0.1));
    const created=commands().find(command=>command.message.action==='create');
    assert.equal(created.message.type,1);assert.equal(created.message.seed,1234);
    assert(commands().some(command=>command.message.action==='filter'&&command.message.mode===1));
    assert(commands().some(command=>command.message.action==='start'));
    if(execution==='main') {
      assert(commands().every(command=>command.frame===0&&command.message.namespace===0));
      const before=commands().length;
      await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource('stopLoop("native-noise");',{execution:'main'}));
      await until(()=>commands().slice(before).some(command=>command.message.action==='retire'));
    } else {
      assert(commands().every(command=>command.performance&&command.owner&&command.message.namespace>0));
      assert.equal(created.frame,0,'Silent voice preparation must survive loop cancellation');
      assert(commands().some(command=>command.message.action==='start'&&command.frame>0));
      assert(commands().some(command=>command.message.action==='parameter'&&command.message.seconds===0.1&&command.frame>0));
      const identity=created.message.namespace;
      assert(commands().every(command=>command.message.namespace===identity));
      const cancelled=native.calls.length;
      await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource('stopLoop("native-noise");',{execution:'worker'}));
      await until(()=>native.calls.slice(cancelled).some(call=>call.command==='native_genesis_performance'&&call.args.op==='cancel-owner'));
      await until(()=>commands().some(command=>command.message.action==='retire'));
      const retired=commands().find(command=>command.message.action==='retire');
      assert.equal(retired.message.namespace,identity);
      assert.equal(retired.message.token,created.message.token);
      assert.equal(retired.frame,0);
      assert.equal(retired.performance,undefined);
      assert.equal(retired.owner,undefined);
    }
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    await assertNoLiveAudio(page);
  }
  // Native Stop retires descriptor identities, so a later Run starts again
  // from a free logical slot and a fresh token without reinitializing audio.
  const first=native.calls.length;
  await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource('const v=noise.create({type:"brown",seed:0});v.stop();v.start();v.dispose();',{execution:'main'}));
  await until(()=>native.calls.slice(first).some(call=>call.command==='native_genesis_commands'&&call.args.commands.some(command=>command.type==='noise'&&command.message.action==='dispose')));
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
}
async function nativeLiveFxRuns(page,native) {
  const {decodeNativeLiveFxContext}=await import('../web/native_livefx_context.js');
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  for(const execution of ['main','worker']) {
    const first=native.calls.length;
    const calls=()=>native.calls.slice(first).filter(call=>call.command==='native_genesis_live_fx');
    const context=call=>call.args.message.contextGraph?decodeNativeLiveFxContext(call.args.message.contextGraph):null;
    const process=`process(input,output,state,context){
      state.blocks=(state.blocks??0)+1;
      for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=input[ch][i]*context.gain;
    }`;
    await page.evaluate(async({execution,process})=>{
      await window.__nativeBackendTest.runtime.playSource(`
        fx.liveFx('native-browser-fx',{${process},context:{gain:0.5,coefficients:new Float32Array([0.25,0.5]),revision:'first'}});
        liveLoop('native-livefx-update',async()=>{
          try {
            fx.updateContext('native-browser-fx',{gain:0.25,revision:'old-loop'});
            await sleep(60);
          } finally {
            ${execution==='worker'?"fx.updateContext('native-browser-fx',{revision:'stale-finalizer'});":''}
          }
        });
      `,{execution});
    },{execution,process});
    await until(()=>calls().some(call=>call.args.message.action==='context'&&context(call).revision==='old-loop'),execution+' liveFx initial loop context');
    const created=calls().find(call=>call.args.message.action==='register');
    assert(created,`${execution}: user liveFx must register through native IPC`);
    assert.match(created.args.message.source,/state\.blocks/);
    assert.equal(created.args.message.resetState,false);
    const initial=context(created);
    assert.equal(initial.gain,0.5);assert.equal(initial.revision,'first');
    assert(initial.coefficients instanceof Float32Array);assert.deepEqual([...initial.coefficients],[0.25,0.5]);
    if(execution==='worker') {
      assert(created.args.performance&&created.args.owner,'Worker registration must retain its performance lease');
      assert(calls().some(call=>call.args.message.action==='context'&&call.args.frame>0&&call.args.performance&&call.args.owner),'Loop context updates must retain native frame timing');
    } else {
      assert(calls().every(call=>call.args.performance===undefined&&call.args.owner===undefined),'Main liveFx must not invent Worker ownership');
    }
    const replacement=calls().length;
    await page.evaluate(async({execution,process})=>{
      await window.__nativeBackendTest.runtime.playSource(`
        stopLoop('native-livefx-update');
        fx.liveFx('native-browser-fx',{${process},context:{gain:0.75,revision:'replacement'},resetState:true});
        fx.updateContext('native-browser-fx',{gain:0.625,revision:'new-script'});
        fx.clear();
        liveLoop('native-livefx-update',async()=>{
          fx.updateContext('native-browser-fx',{gain:0.5,revision:'new-loop'});
          await sleep(60);
        });
      `,{execution});
    },{execution,process});
    await until(()=>calls().slice(replacement).some(call=>call.args.message.action==='context'&&context(call).revision==='new-loop'),execution+' liveFx replacement loop context');
    const updated=calls().slice(replacement);
    assert(updated.some(call=>call.args.message.action==='register'&&call.args.message.resetState===true&&context(call).revision==='replacement'));
    assert(updated.some(call=>call.args.message.action==='context'&&context(call).revision==='new-script'));
    assert(native.liveFx.has('native-browser-fx'),'Clearing the C FX chain must preserve named JavaScript effects');
    if(execution==='worker')assert(!updated.some(call=>call.args.message.contextGraph&&context(call).revision==='stale-finalizer'),'A cancelled Worker finalizer cannot change the replacement effect');
    await assertNoLiveAudio(page);
    const removing=calls().length;
    await page.evaluate(async execution=>{
      await window.__nativeBackendTest.runtime.playSource(`fx.removeLiveFx('native-browser-fx');stopLoop('native-livefx-update');`,{execution});
    },execution);
    await until(()=>calls().slice(removing).some(call=>call.args.message.action==='remove'&&call.args.message.name==='native-browser-fx'));
    assert.equal(native.liveFx.size,0,'Explicit removal must leave the native rack empty');
    await page.evaluate(async({execution,process})=>{
      await window.__nativeBackendTest.runtime.playSource(`liveFx('native-browser-fx',{${process},context:{gain:0.5}});`,{execution});
    },{execution,process});
    await until(()=>native.liveFx.has('native-browser-fx'));
    const omitted=calls().length;
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource('',{execution}),execution);
    await until(()=>calls().slice(omitted).some(call=>call.args.message.action==='remove'));
    assert.equal(native.liveFx.size,0,'Successful reevaluation must remove undeclared native liveFx');
    await page.evaluate(async({execution,process})=>{
      await window.__nativeBackendTest.runtime.playSource(`liveFx('native-browser-fx',{${process},context:{gain:0.5}});`,{execution});
    },{execution,process});
    await until(()=>native.liveFx.has('native-browser-fx'));
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    assert.equal(native.liveFx.size,0,'Stop must clear the native liveFx rack');
    await assertNoLiveAudio(page);
  }
}
async function nativeLiveFxDiagnostics(page,native) {
  await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource(`
    fx.liveFx('native-reported-fx',{process(input,output){output.forEach((channel,ch)=>channel.set(input[ch]));}});
    liveLoop('native-livefx-diagnostics',async()=>{await sleep(60);});
  `,{execution:'main'}));
  await until(()=>native.liveFx.has('native-reported-fx'));
  const statusReads=native.count('native_genesis_status');
  const message='[liveFx:native-reported-fx] Simulated native JavaScript error. Effect bypassed.';
  native.liveFxError=message;
  await until(()=>native.count('native_genesis_status')>statusReads,'Native liveFx diagnostic polling');
  await page.waitForFunction(message=>document.body.textContent.includes(message),message);
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.runtime.megaDrive.state),'ready','A bypassed liveFx must not fail the native audio backend');
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.runtime.getState().playback),'running');
  assert.equal(await page.evaluate(()=>new URL(location.href).searchParams.get('audioEngine')),'native');
  await assertNoLiveAudio(page);
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
}
async function monitorTrace(page,id,color,after=-1,expected={}) {
  await page.waitForFunction(({id,color,after,expected})=>{
    const trace=window.__monitorDrawings?.[id]?.traces[color];
    if(!trace||trace.revision<=after||!trace.points.length)return false;
    const ys=trace.points.map(point=>point[1]),low=Math.min(...ys),high=Math.max(...ys);
    return (expected.span===undefined||Math.abs(high-low-expected.span)<.05)&&
      (expected.minY===undefined||Math.abs(low-expected.minY)<.01);
  },{id,color,after,expected});
  return page.evaluate(({id,color})=>window.__monitorDrawings[id].traces[color],{id,color});
}
const traceSpan=trace=>Math.max(...trace.points.map(point=>point[1]))-Math.min(...trace.points.map(point=>point[1]));
async function nativeAudioMonitor(page,native,artifacts,name) {
  const reads=native.monitor.reads;
  assert.equal(reads.length,0,'Hidden Audio tab must not request native analysis');
  await page.click('#audioMonitorTab');
  await page.selectOption('#audioMonitorMode','envelope');
  await page.selectOption('#audioMonitorChannel','0');
  await page.selectOption('#audioMonitorScale','1');
  await until(()=>reads.some(read=>read.mode==='envelope'&&read.channel===0));
  await page.waitForFunction(()=>document.getElementById('audioMonitorStatus').textContent.includes('native mixed output'));
  const envelope=await monitorTrace(page,'audioMonitorEnvelope','#69cfff');
  const peak=await monitorTrace(page,'audioMonitorEnvelope','#ffba69');
  assert(Math.abs(envelope.points.at(-1)[1]-(130-.4/Math.SQRT2*112))<.01,'Native envelope must draw the reported RMS');
  assert(Math.abs(peak.points.at(-1)[1]-(130-.4*112))<.01,'Native envelope must draw the reported peak');

  await page.selectOption('#audioMonitorMode','waveform');
  await until(()=>reads.some(read=>read.mode==='waveform'&&read.channel===0));
  const left=await monitorTrace(page,'audioMonitorWave','#69cfff',-1,{span:.4*112});
  assert(Math.abs(traceSpan(left)-.4*112)<.05,'Left native PCM must reach the oscilloscope');
  await page.selectOption('#audioMonitorChannel','1');
  await until(()=>reads.some(read=>read.mode==='waveform'&&read.channel===1));
  await page.waitForFunction(()=>document.getElementById('audioMonitorStatus').textContent.includes('Right · native'));
  const right=await monitorTrace(page,'audioMonitorWave','#69cfff',left.revision,{span:.1*112});
  assert(Math.abs(traceSpan(right)-.1*112)<.05,'Channel switch must use the right native PCM');

  await page.selectOption('#audioMonitorMode','spectrum');
  await until(()=>reads.some(read=>read.mode==='spectrum'&&read.channel===1));
  const spectrumRight=await monitorTrace(page,'audioMonitorSpectrum','#ffba69',-1,{minY:18+.3*112});
  assert(Math.abs(Math.min(...spectrumRight.points.map(point=>point[1]))-(18+.3*112))<.01,'Spectrum must draw the native -30 dBFS peak');
  await page.selectOption('#audioMonitorChannel','0');
  await until(()=>reads.some(read=>read.mode==='spectrum'&&read.channel===0));
  await page.waitForFunction(()=>document.getElementById('audioMonitorStatus').textContent.includes('Left · native'));
  const spectrumLeft=await monitorTrace(page,'audioMonitorSpectrum','#ffba69',spectrumRight.revision,{minY:18+.12*112});
  assert(Math.abs(Math.min(...spectrumLeft.points.map(point=>point[1]))-(18+.12*112))<.01,'Spectrum channel switch must draw the native -12 dBFS peak');

  const waitStopped=async(action,label)=>{
    const offBefore=native.calls.filter(call=>call.command==='native_genesis_monitor'&&call.args.mode==='off').length;
    await action();
    await until(()=>native.calls.filter(call=>call.command==='native_genesis_monitor'&&call.args.mode==='off').length>offBefore);
    const count=reads.length;
    await page.waitForTimeout(250);
    assert.equal(reads.length,count,`${label} must stop native analysis requests`);
  };
  const clockBefore=await page.evaluate(()=>window.__nativeBackendTest.runtime.megaDrive.clock.currentTime);
  await waitStopped(()=>page.click('#audioMonitorPause'),'Pause');
  assert.equal(await page.locator('#audioMonitorPause').textContent(),'Resume');
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.runtime.getState().playback),'running');
  assert(await page.evaluate(before=>window.__nativeBackendTest.runtime.megaDrive.clock.currentTime>before+.15,clockBefore));
  const commandsBefore=native.count('native_genesis_commands');
  await page.evaluate(async()=>{
    const synth=window.__nativeBackendTest.runtime.megaDrive;
    if(synth.gameboy){synth.gameboy.pulse.setVoice(0,{volume:8});await synth.flush();}
    else if(synth.huc6280){synth.huc6280.setVolume(0,20);await synth.flush();}
    else if(synth.snes){synth.snes.writeDsp(0x0c,127);await synth.flush();}
    else if(synth.nes){synth.nes.writeRegister(0x4017,0x40);await synth.flush();}
    else if(synth.dx7){synth.dx7.noteOn(84,1);synth.dx7.noteOff(84);await synth.dx7.getState();}
    else synth.fm.write(0,0x22,0);
    await synth.flush();
  });
  assert(native.count('native_genesis_commands')>commandsBefore,'Pausing analysis must leave native command processing active');
  let before=reads.length;await page.click('#audioMonitorPause');await until(()=>reads.length>before);
  await waitStopped(()=>page.click('#consoleTab'),'Hiding Audio tab');
  before=reads.length;await page.click('#audioMonitorTab');await until(()=>reads.length>before);

  const originalStyle=await page.locator('#audioMonitorPanel').getAttribute('style');
  await waitStopped(()=>page.locator('#audioMonitorPanel').evaluate(panel=>{
    panel.style.position='fixed';panel.style.top='-10000px';panel.style.left='0';panel.style.width='700px';
  }),'Offscreen Audio panel');
  before=reads.length;
  await page.locator('#audioMonitorPanel').evaluate((panel,value)=>{
    if(value===null)panel.removeAttribute('style');else panel.setAttribute('style',value);
  },originalStyle);
  await until(()=>reads.length>before);

  await page.selectOption('#audioMonitorMode','waveform');
  const gate=native.holdNextMonitor('waveform');
  try {
    await until(()=>Boolean(gate.request));
    await page.selectOption('#audioMonitorMode','spectrum');
    const waveRevision=await page.evaluate(()=>window.__monitorDrawings.audioMonitorWave?.revision??0);
    const heldCount=reads.length;await page.waitForTimeout(120);
    assert.equal(reads.length,heldCount,'A delayed snapshot must not start parallel native reads');
    gate.release();
    await until(()=>reads.length>heldCount&&reads.at(-1).mode==='spectrum');
    await page.waitForFunction(()=>document.getElementById('audioMonitorStatus').textContent.includes('native mixed output'));
    assert.equal(await page.evaluate(()=>window.__monitorDrawings.audioMonitorWave?.revision??0),waveRevision,'A stale mode response must not repaint its canvas');
  } finally {gate.release();}
  const rateStart=performance.now(),rateBefore=reads.length;await page.waitForTimeout(500);
  assert(reads.length-rateBefore<=Math.ceil((performance.now()-rateStart)*15/1000)+2,'Steady native analysis must stay at or below 15 requests/sec');
  assert.equal(native.monitor.maxPending,1,'Only one native observation read may be in flight');
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.runtime.getState().playback),'running');
  await assertNoLiveAudio(page);
  await page.screenshot({path:path.join(artifacts,name+'-native-audio-monitor.png')});
  await waitStopped(()=>page.click('#consoleTab'),'Closing Audio tab');
}
async function nativeRecording(page,native) {
  await page.locator('#mainMenu > summary').click();
  await page.click('#audioDiagnosticsButton');
  const panel=page.locator('.audio-diagnostics');await panel.waitFor({state:'visible'});
  const before=native.count('native_genesis_record_start');
  await panel.getByRole('button',{name:'Record 30 s',exact:true}).click();
  await until(()=>native.count('native_genesis_record_start')>before);
  await panel.getByRole('button',{name:'Mark noise',exact:true}).click();
  await panel.getByRole('button',{name:'Stop recording',exact:true}).click();
  await panel.getByRole('button',{name:'Save output WAV',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('.audio-diagnostics button')).find(b=>b.textContent==='Save output WAV').disabled);
  assert(await panel.getByRole('button',{name:'Save chip WAV',exact:true}).isDisabled());
  const saving=page.waitForEvent('download');await panel.getByRole('button',{name:'Save output WAV',exact:true}).click();
  const downloaded=await saving,bytes=await fs.readFile(await downloaded.path());
  assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.readUInt16LE(20),3);assert.equal(bytes.readUInt32LE(40),16*8);
  await panel.getByRole('button',{name:'Close diagnostics',exact:true}).click();
  await assertNoLiveAudio(page);
}
async function keyboard(page, native) {
  await page.click('#keyboardTab');
  for (const [chip, channel] of [['ym2612','fm:0'], ['segapsg','0']]) {
    await page.selectOption('#playgroundKeyboardChip', 'chip:' + chip);
    await page.selectOption('#playgroundKeyboardTargetChannel', channel);
    await page.locator('#keyboardTab').focus();
    const first = native.calls.length;
    const commands = () => native.calls.slice(first).flatMap(call => call.command === 'native_genesis_commands' ? call.args.commands : []);
    await page.keyboard.down('z');
    await until(() => commands().some(entry => chip === 'ym2612'
      ? entry.type === 'write' && entry.register === 0x28 && Boolean(entry.value & 0xf0)
      : entry.type === 'psg-write' && (entry.value & 0xf0) === 0x90 && (entry.value & 15) !== 15));
    await page.keyboard.up('z');
    await until(() => commands().some(entry => chip === 'ym2612'
      ? entry.type === 'write' && entry.register === 0x28 && !(entry.value & 0xf0)
      : entry.type === 'psg-write' && entry.value === 0x9f));
  }
}
async function changeNativeMode(page,native,id,choice='initial') {
  const session=native.current?.session,starts=native.count('native_genesis_start');
  await page.locator('#mainMenu > summary').click();
  await page.selectOption('#playgroundMode',id);
  await page.locator('#changeModeDialog').waitFor({state:'visible'});
  try {
    await Promise.all([
      page.waitForURL(url=>url.searchParams.get('mode')===id),
      page.locator('#changeModeDialog').evaluate((dialog,choice)=>dialog.close(choice),choice),
    ]);
  } catch(error) {
    const detail=await page.locator('body').innerText();
    const statuses=await page.locator('[role="status"]').allTextContents();
    throw new Error(`Could not change Native mode to ${id}: ${JSON.stringify(statuses)} ${detail.slice(0,900)} ${detail.slice(-1200)}`,{cause:error});
  }
  await ready(page);
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.selectedMode.id),id);
  assert.equal(new URL(page.url()).searchParams.get('audioEngine'),'native');
  assert.deepEqual(await modeIds(page),nativeModeIds);
  assert.equal(native.count('native_genesis_start'),starts,'Mode selection must defer device opening until playback');
  assert.equal(native.current,null,'Changing Native machines must shut down the old session');
  if(session)assert(native.calls.some(call=>call.command==='native_genesis_shutdown'&&call.args.session===session));
}
function importedMegaCdVgm() {
  // A real mixed VGM with a banked RAM file, exact High-compatible register
  // groups, FM and PSG. One second leaves time to remove the live RF loop.
  const commands=[0xb1,7,0x82,0x67,0x66,0xc1,6,0,0,0,0,1,0x81,0x92,0xa3,0xff,
    0xb1,7,0xc0,0xb1,0,200,0xb1,7,0xc0,0xb1,1,255,
    0xb1,7,0xc0,0xb1,6,0x21,0xb1,7,0xc0,0xb1,4,0,0xb1,5,0x21,
    0xb1,7,0xc0,0xb1,2,0,0xb1,3,8,0xb1,7,0xc0,0xb1,8,255,0xb1,8,254,
    0x52,0x30,1,0x52,0x28,0xf0,0x50,0x90,0x61,0x44,0xac,0x66];
  const bytes=new Uint8Array(256+commands.length),header=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);header.setUint32(4,bytes.length-4,true);header.setUint32(8,0x161,true);
  header.setUint32(0xc,3579545,true);header.setUint32(0x2c,7670454,true);
  header.setUint32(0x34,0xcc,true);header.setUint32(0x6c,12500000,true);bytes.set(commands,256);
  return Array.from(bytes);
}
async function nativeImportedMegaCd(page,native) {
  const bytes=importedMegaCdVgm(),expectedRam=[0x81,0x92,0xa3,0xff];
  for(const mode of ['high','write'])for(const execution of ['main','worker']) {
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    await page.evaluate(async({bytes,mode,execution})=>{
      const test=window.__nativeBackendTest;
      await test.importVgmFile(new File([Uint8Array.from(bytes)],'native-rf-import.vgm'),{
        targetPath:'/native-rf-import.js',mode,includeRf5c164:true,includeDac:true,includePsg:true,splitChannels:false,
      });
      document.getElementById('workerExecution').checked=execution==='worker';
    },{bytes,mode,execution});
    const generated=await page.evaluate(()=>window.__nativeBackendTest.editor.getValue());
    assert.match(generated,/await useSoundChip\(['"]rf5c164['"]\)/,`${mode}/${execution}: the real Mega CD importer must borrow the built-in PCM`);
    assert.doesNotMatch(generated,/createSoundChip\(['"]rf5c164['"]\)|rf\.dispose\(/,'Shared PCM cleanup must never dispose the built-in chip');
    assert.match(generated,/await file\(/,'Imported RAM must use the real project-file reader');
    if(mode==='high')assert.match(generated,/rf\.setPitch\(0, 2048\)/,'High import must exercise exact-write API operations');
    else assert.match(generated,/rf\.writeRegister\(2, 0\)/,'Write import must preserve raw writes');
    const first=native.calls.length,session=native.current.session;
    const commands=()=>native.calls.slice(first).flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]);
    await run(page);
    await until(()=>commands().some(command=>command.type==='rf5c164-load-memory'&&command.offset===8448)&&
      commands().some(command=>command.type==='rf5c164-write'&&command.register===6&&command.value===0x21)&&
      commands().some(command=>command.type==='write'&&command.register===0x28&&(command.value&0xf0))&&
      commands().some(command=>command.type==='psg-write'&&command.value===0x90),`${mode}/${execution}: imported RF/FM/PSG playback`);
    assert.deepEqual(Array.from(native.pcmMemory.slice(8448,8452)),expectedRam,'The banked project RAM file must reach Native PCM intact');
    assert.equal(native.pcm.mask&1,0,'Imported RF channel must be playing before cleanup');
    assert.equal(native.current.session,session,'Import playback must borrow the existing audio session');
    await assertNoLiveAudio(page);
    // A hot Run which drops the RF loop invokes its authored cleanup without
    // stopping the native device. This catches dispose/no-op cleanup mistakes.
    const beforeCleanup=commands().length;
    await page.evaluate(async execution=>{
      await window.__nativeBackendTest.runtime.playSource(`liveLoop('unrelated-import-regression',async()=>{await sleep(0.1);});`,{execution});
    },execution);
    await until(()=>commands().slice(beforeCleanup).some(command=>command.type==='rf5c164-key-off'&&command.channel===0),`${mode}/${execution}: imported shared PCM cleanup`);
    assert(!commands().slice(beforeCleanup).some(command=>command.type==='rf5c164-reset'),'Removing an imported loop must preserve the shared register and RAM state');
    assert.equal(native.pcm.mask&1,1,'Removing imported RF playback must release its channel');
    assert.deepEqual(Array.from(native.pcmMemory.slice(8448,8452)),expectedRam,'Loop cleanup must retain uploaded RF RAM');
    assert.equal(native.current.session,session);
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    assert.equal(native.pcm.mask,255,'Stop must leave all RF voices off');
    assert.deepEqual(Array.from(native.pcmMemory.slice(8448,8452)),expectedRam,'Stop must retain uploaded RF RAM');
  }
  for(const execution of ['main','worker']) {
    const message=await page.evaluate(async execution=>{
      try {await window.__nativeBackendTest.runtime.playSource(`const fm=await useSoundChip('ym2612');const rf=await createSoundChip('rf5c164');`,{execution});return null;}
      catch(error){return error.message;}
    },execution);
    assert.match(message,/useSoundChip\(['"]rf5c164['"]\)/,'Existing independent-chip code must explain how to use the built-in Mega CD PCM');
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  }
}
async function nativeMegaCd(page,native,artifacts,name) {
  await changeNativeMode(page,native,'mega-cd');
  const starter=await fs.readFile(path.resolve(__dirname,'../docs/playground/defaults/mega-cd/index.js'),'utf8');
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.editor.getValue()),starter,'Mode change must install the shipped Mega CD starter');
  for(const execution of ['main','worker']) {
    const first=native.calls.length;
    await page.evaluate(async({starter,execution})=>{
      await window.__nativeBackendTest.runtime.playSource(starter,{execution});
    },{starter,execution});
    const calls=()=>native.calls.slice(first),commands=()=>calls().flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]);
    await until(()=>commands().some(command=>command.type==='rf5c164-key-on'&&command.channel===0)&&
      commands().some(command=>command.type==='write'&&command.register===0x28&&(command.value&0xf0)),`${execution}: shipped Mega CD starter FM and PCM`);
    assert.equal(native.current.mode,'mega-cd');
    const prepared=commands().find(command=>command.type==='rf5c164-load-memory');
    assert(prepared&&prepared.offset===0&&prepared.data.length>5600,'loadSample must encode and upload the full finite bass sample');
    assert.equal(prepared.data[5600],255,'The finite starter must retain its RF end marker');
    const keyOn=commands().find(command=>command.type==='rf5c164-key-on'&&command.channel===0);
    assert(Number.isSafeInteger(keyOn.frame)&&keyOn.frame>=0);
    assert(Number.isSafeInteger(keyOn.voice)&&keyOn.voice>0,'Each PCM retrigger must carry a channel voice lease');
    if(execution==='worker')assert(keyOn.performance&&keyOn.owner&&keyOn.frame>0,'Worker PCM must share the performance ownership and frame scheduler');
    const snapshot=await page.evaluate(async()=>({
      backend:window.__nativeBackendTest.runtime.megaDrive.backend,
      pcm:window.__nativeBackendTest.runtime.megaDrive.capabilities.pcm,
      chips:await window.__nativeBackendTest.runtime.chipInspector.list(),
      state:await window.__nativeBackendTest.runtime.chipInspector.read('rf5c164'),
    }));
    assert.equal(snapshot.backend,'native-genesis');assert.equal(snapshot.pcm,true);
    assert(snapshot.chips.some(chip=>chip.id==='rf5c164'),'The Native PCM must be discoverable by Operators and Keyboard');
    assert.equal(snapshot.state.channels[0].active,true);
    await assertNoLiveAudio(page);
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    const stopped=await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('rf5c164'));
    assert(stopped.channels.every(channel=>!channel.active),'Stop must release the authored PCM channel state');
  }
  await nativeImportedMegaCd(page,native);
  const compressedUrl=new URL('./samples/sonic-pi/drum_heavy_kick.flac',page.url()).href;
  for(const execution of ['main','worker']) {
    const first=native.calls.length;
    await page.evaluate(async({execution,compressedUrl})=>{
      await window.__nativeBackendTest.runtime.playSource(`
        const pcm=await useSoundChip('rf5c164');
        const decoded=await pcm.loadSample(${JSON.stringify(compressedUrl)},{address:8192});
        await pcm.setChannel(7,{...decoded,volume:70,pan:{left:15,right:15}});
        await pcm.keyOn(7);
      `,{execution});
    },{execution,compressedUrl});
    const commands=native.calls.slice(first).flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]);
    assert(commands.some(command=>command.type==='rf5c164-load-memory'&&command.offset===8192&&command.data.length>10000),`${execution}: RF loadSample must decode the real FLAC and encode chip RAM`);
    assert(commands.some(command=>command.type==='rf5c164-key-on'&&command.channel===7));
    await assertNoLiveAudio(page);
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  }
  // The ordinary chip-target Keyboard path must reach the same Native endpoint.
  await page.click('#keyboardTab');
  await page.selectOption('#playgroundKeyboardChip','chip:rf5c164');
  await page.selectOption('#playgroundKeyboardTargetChannel','0');
  await page.locator('#keyboardTab').focus();
  let first=native.calls.length;
  const pcmCommands=()=>native.calls.slice(first).flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]).filter(command=>command.type.startsWith('rf5c164-'));
  await page.keyboard.down('z');
  await until(()=>pcmCommands().some(command=>command.type==='rf5c164-key-on'&&command.channel===0),'RF Keyboard key-on');
  await page.keyboard.up('z');
  await until(()=>pcmCommands().some(command=>command.type==='rf5c164-key-off'&&command.channel===0),'RF Keyboard key-off');
  const pitchCommands=()=>pcmCommands().filter(command=>command.type==='rf5c164-write'&&command.audition&&[2,3].includes(command.register));
  const firstPitch=pitchCommands().map(({register,value})=>({register,value}));
  assert.equal(firstPitch.length,2,'RF Keyboard must mark its temporary pitch writes');
  const beforeRepeat=pcmCommands().filter(command=>command.type==='rf5c164-key-on').length;
  await page.keyboard.down('z');
  await until(()=>pcmCommands().filter(command=>command.type==='rf5c164-key-on').length>beforeRepeat,'Repeated RF Keyboard key-on');
  await page.keyboard.up('z');
  assert.deepEqual(pitchCommands().slice(2).map(({register,value})=>({register,value})),firstPitch,'Repeated audition must preserve the authored sample pitch');
  // Use the real shared sample-instrument builder and binding in both execution
  // modes. The decoded PCM is synthetic; no microphone or output device is used.
  for(const execution of ['main','worker']) {
    first=native.calls.length;
    await page.evaluate(async execution=>{
      await window.__nativeBackendTest.runtime.playSource(`
        const frames=512;
        const audio={channels:[Float32Array.from({length:frames},(_,i)=>Math.sin(i*Math.PI*2/64)*0.5)],sampleRate:16000,rootMidi:60,loopEnabled:true,loopStartFrame:0,loopEndFrame:frames};
        keyboard.bind('native-cd-sampler',await createSampleInstrument(audio));
      `,{execution});
    },execution);
    await page.waitForFunction(()=>window.__nativeBackendTest.runtime.getKeyboardTarget()?.name==='native-cd-sampler');
    await until(()=>pcmCommands().some(command=>command.type==='rf5c164-load-memory'&&command.data.length>=544),`${execution}: sample-instrument RAM upload`);
    await page.locator('#keyboardTab').focus();
    const before=pcmCommands().length;
    await page.keyboard.down('z');await page.keyboard.down('x');
    await until(()=>[0,1].every(channel=>pcmCommands().slice(before).some(command=>command.type==='rf5c164-key-on'&&command.channel===channel)),`${execution}: polyphonic sampled Keyboard`);
    await page.keyboard.up('z');await page.keyboard.up('x');
    await until(()=>[0,1].every(channel=>pcmCommands().slice(before).some(command=>command.type==='rf5c164-key-off'&&command.channel===channel)),`${execution}: sampled Keyboard release`);
    await assertNoLiveAudio(page);
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  }
  await page.evaluate(starter=>window.__nativeBackendTest.runtime.playSource(starter,{execution:'main'}),starter);
  native.monitor.reads.length=0;
  await nativeAudioMonitor(page,native,artifacts,name+'-megacd');
  await nativeRecording(page,native);
  await assertNoLiveAudio(page);
  await page.evaluate(source=>window.__nativeBackendTest.editor.setValue(source),source);
  await changeNativeMode(page,native,'genesis','keep');
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.editor.getValue()),source,'Returning from Mega CD must preserve edited project code');
  for(const execution of ['main','worker']) {
    const message=await page.evaluate(async execution=>{
      try {await window.__nativeBackendTest.runtime.playSource(`const rf=await createSoundChip('rf5c164');`,{execution});return null;}
      catch(error){return error.message;}
    },execution);
    assert.match(message,/Mega CD/,'Genesis must still reject an independent RF chip and explain the supported machine');
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  }
  await nativeRun(page,native);
  assert.equal(native.current.mode,'genesis');
}
async function nativeDx7State(page,predicate,label) {
  const deadline=Date.now()+10000;
  while(Date.now()<deadline) {
    const state=await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('dx7'));
    if(predicate(state))return state;
    await page.waitForTimeout(20);
  }
  throw Error('Native DX7 '+label+' snapshot timed out');
}
async function nativeDx7(page,native,artifacts,name) {
  const {createInitVoice,createBankSysex}=await import('../web/msfa_dx7/src/sysex.js');
  const {voiceToPreset}=await import('../web/msfa_dx7/src/preset.js');
  const bank=Array.from(createBankSysex(Array.from({length:32},(_,index)=>createInitVoice('BANK '+String(index).padStart(2,'0')))));
  await changeNativeMode(page,native,'dx7');
  const starter=await fs.readFile(path.resolve(__dirname,'../docs/playground/defaults/dx7/index.js'),'utf8');
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.editor.getValue()),starter,'DX7 selection must install its shipped starter');
  const allCommands=()=>native.calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]);
  for(const execution of ['main','worker']) {
    const first=native.calls.length;
    const commands=()=>native.calls.slice(first).flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]);
    await page.evaluate(({starter,execution})=>window.__nativeBackendTest.runtime.playSource(starter,{execution}),{starter,execution});
    await until(()=>commands().some(entry=>entry.type==='dx7'&&entry.message.method==='note-on'),execution+' shipped Native DX7 starter');
    const snapshot=await page.evaluate(async()=>{
      const synth=window.__nativeBackendTest.runtime.megaDrive;
      return {backend:synth.backend,chip:synth.chip,fm:synth.fm,psg:synth.psg,pcm:synth.pcm,
        endpoints:synth.primaryEndpoints.map(endpoint=>endpoint.name),chips:await synth.mixer.list(),
        inspected:await synth.chipInspector.list(),preset:await synth.dx7.getPreset()};
    });
    assert.equal(snapshot.backend,'native-genesis');assert.equal(snapshot.chip,'dx7');
    assert.equal(snapshot.fm,null);assert.equal(snapshot.psg,null);assert.equal(snapshot.pcm,null);
    assert.deepEqual(snapshot.endpoints,['dx7']);
    assert.deepEqual(snapshot.chips.filter(chip=>chip.connected).map(chip=>chip.name),['dx7']);
    assert.deepEqual(snapshot.inspected.map(chip=>chip.id),['dx7']);
    assert.equal(snapshot.preset.name,'MODE KEYS');
    assert(commands().every(entry=>!['write','psg-write','psg-stereo','reset'].includes(entry.type)&&!entry.type.startsWith('rf5c164-')),'DX7 starter must never write to hidden YM/PSG/PCM chips');
    if(execution==='worker')assert(commands().some(entry=>entry.type==='dx7'&&entry.message.method==='note-on'&&entry.frame>0&&entry.performance&&entry.owner),'Worker DX7 note must retain its frame reservation and owner');
    await assertNoLiveAudio(page);
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    const session=native.current.session;
    await page.evaluate(async({execution,bank})=>{
      await window.__nativeBackendTest.runtime.playSource(`
        const shared=await useSoundChip('dx7');
        if(shared!==dx7)throw Error('Native DX7 was not reused');
        await dx7.loadSysex(new Uint8Array(${JSON.stringify(bank)}));
        await dx7.selectVoice(31);
        await dx7.setPreset({name:'NATIVE UI',algorithm:14,feedback:1,operators:{1:{coarse:2,outputLevel:88}}});
        await dx7.setOperator(1,{fine:17});
        await dx7.setOperators([[2,{coarse:3}],[6,{outputLevel:50}]]);
        await dx7.setFeedback(5);
        let invalid=false;try{await dx7.loadSysex(new Uint8Array([0xf0,0x43,0xf7]));}catch{invalid=true;}
        if(!invalid||dx7.voices.length!==32||dx7.selectedVoice!==31)throw Error('Invalid SysEx changed the Native bank');
        await mixer.set(dx7.id,{volume:0.6,pan:-0.4});
        const gain=fx.gain({gain:0.4});fx.setChain([gain]);
        liveFx('native-dx7-fx',{process(input,output){output.forEach((channel,index)=>channel.set(input[index]));}});
        liveLoop('native-dx7-bank',async()=>{dx7.noteOn(60,100);await beat(0.02);dx7.noteOff(60);await beat(0.02);});
      `,{execution});
    },{execution,bank});
    await until(()=>commands().some(entry=>entry.type==='dx7'&&entry.message.method==='note-on'&&entry.message.note===60),execution+' Native DX7 loaded bank');
    const edited=await nativeDx7State(page,state=>state.voices.length===32&&state.selectedVoice===31&&state.preset.feedback===5,execution+' selected bank');
    assert.equal(edited.preset.name,'NATIVE UI');assert.equal(edited.preset.operators[1].fine,17);
    assert.equal(edited.preset.operators[2].coarse,3);assert.equal(edited.preset.operators[6].outputLevel,50);
    assert(commands().some(entry=>entry.type==='dx7'&&entry.message.method==='mix'),'DX7 mixer must use the Native chip gain');
    assert(native.calls.slice(first).some(call=>call.command==='native_genesis_fx'&&call.args.message.op==='chain'));
    // Chip and FX use independent Worker ports. A delivered note does not
    // acknowledge the FX installation on its separate preparation queue.
    await until(()=>native.liveFx.has('native-dx7-fx'),execution+' Native DX7 JavaScript FX installation');
    assert(native.liveFx.has('native-dx7-fx'),'DX7 must share the existing Native JavaScript FX stage');
    assert.equal(native.current.session,session,'Patch loading and editing must reuse one Native DX7 instance');
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    assert.equal(native.dx7Notes.size,0,'Stop must clear all Native DX7 note gates');
    const stopped=await nativeDx7State(page,state=>state.preset.name==='NATIVE UI',execution+' retained bank after Stop');
    assert.deepEqual(stopped.preset,edited.preset,'Stop must retain the selected edited DX7 patch');
    assert.equal(stopped.activeNotes.length,0);
    assert.equal(voiceToPreset(Uint8Array.from(native.dx7.voices[31])).feedback,5);
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource('dx7.noteOn(72,80);dx7.noteOff(72);',{execution}),execution);
    await until(()=>commands().some(entry=>entry.type==='dx7'&&entry.message.method==='note-on'&&entry.message.note===72),execution+' Native DX7 restart');
    assert.equal(native.current.session,session);assert.equal(native.dx7.voices.length,32);
    const velocityZero=commands().length;
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource('dx7.noteOn(84,20);dx7.noteOn(84,0);',{execution}),execution);
    await until(()=>commands().slice(velocityZero).some(entry=>entry.type==='dx7'&&entry.message.method==='note-off'&&entry.message.note===84),execution+' velocity-zero release');
    const zeroCommands=commands().slice(velocityZero).filter(entry=>entry.type==='dx7'&&entry.message.note===84);
    const zeroOn=zeroCommands.find(entry=>entry.message.method==='note-on');
    const zeroOff=zeroCommands.find(entry=>entry.message.method==='note-off');
    assert(zeroOn&&zeroOff&&zeroOn.message.voice===zeroOff.message.voice,'Velocity-zero noteOn must release the existing voice lease');
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    await assertNoLiveAudio(page);
  }
  // The shared Guitar layout accepts both computer keys and pointer presses.
  await page.click('#keyboardTab');
  await page.selectOption('#playgroundKeyboardChip','chip:dx7');
  await page.selectOption('#playgroundKeyboardTargetChannel','0');
  await page.locator('#keyboardTab').focus();
  let first=allCommands().length;
  const added=()=>allCommands().slice(first).filter(entry=>entry.type==='dx7');
  await page.keyboard.down('z');
  await until(()=>added().some(entry=>entry.message.method==='note-on'),'Native DX7 computer Keyboard');
  await page.keyboard.up('z');await until(()=>added().some(entry=>entry.message.method==='note-off'),'Native DX7 computer Keyboard release');
  const key=page.locator('#operatorKeyboardRoot .key').first();
  await key.scrollIntoViewIfNeeded();const rect=await key.boundingBox();
  first=allCommands().length;
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
  await until(()=>added().some(entry=>entry.message.method==='note-on'),'Native DX7 Guitar pointer');
  await page.mouse.move(5,5);await page.mouse.up();
  await until(()=>added().some(entry=>entry.message.method==='note-off'),'Native DX7 Guitar pointer release');
  await page.click('#dx7Tab');
  const field=async(name,value)=>page.locator(`#dx7Panel [data-chip-control="dx7-${name}"]`).evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('change',{bubbles:true}));},value);
  await page.locator('#dx7Panel [data-chip-control="dx7-feedback"]').waitFor();
  await field('feedback',6);await field('op-fine',23);
  await nativeDx7State(page,state=>state.preset.feedback===6&&state.preset.operators[1].fine===23,'Operator panel patch editing');
  first=allCommands().length;
  const hold=page.locator('#dx7Panel [data-chip-action="dx7-hold"]');await hold.scrollIntoViewIfNeeded();const holdRect=await hold.boundingBox();
  await page.mouse.move(holdRect.x+holdRect.width/2,holdRect.y+holdRect.height/2);await page.mouse.down();
  await until(()=>added().some(entry=>entry.message.method==='note-on'),'Native DX7 Operator Hold');
  await page.mouse.move(5,5);await page.mouse.up();
  await until(()=>added().some(entry=>entry.message.method==='note-off'),'Native DX7 Operator release outside');
  await page.click('#dx7Panel [data-chip-action="dx7-keyboard"]');
  await page.locator('#keyboardPanel').waitFor({state:'visible'});await page.locator('#dx7Tab').focus();
  first=allCommands().length;await page.keyboard.down('z');
  await until(()=>added().some(entry=>entry.message.method==='note-on'),'Native DX7 Operator Keyboard');
  await page.keyboard.up('z');await until(()=>added().some(entry=>entry.message.method==='note-off'),'Native DX7 Operator Keyboard release');
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  await page.evaluate(starter=>window.__nativeBackendTest.runtime.playSource(starter,{execution:'main'}),starter);
  native.monitor.reads.length=0;
  await nativeAudioMonitor(page,native,artifacts,name+'-dx7');
  await nativeRecording(page,native);
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  assert.deepEqual(native.dx7WasmRequests,[],'Native DX7 must never fetch a WASM sound core');
  await assertNoLiveAudio(page);
  await page.evaluate(source=>window.__nativeBackendTest.editor.setValue(source),source);
  await changeNativeMode(page,native,'genesis','keep');
  await nativeRun(page,native);
  assert.equal(native.current.mode,'genesis');
}
async function nativeNes(page,native,artifacts,name) {
  await changeNativeMode(page,native,'nes');
  const starter=await fs.readFile(path.resolve(__dirname,'../docs/playground/defaults/nes/index.js'),'utf8');
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.editor.getValue()),starter,'NES selection installs its shipped starter');
  const allCommands=()=>native.calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]);
  const flatten=messages=>messages.flatMap(message=>message.method==='batch'?flatten(message.commands):[message]);
  for(const execution of ['main','worker']) {
    const first=allCommands().length;
    const commands=()=>allCommands().slice(first).filter(entry=>entry.type==='nes');
    const writes=()=>flatten(commands().map(entry=>entry.message));
    await page.evaluate(({starter,execution})=>window.__nativeBackendTest.runtime.playSource(starter,{execution}),{starter,execution});
    await until(()=>writes().some(message=>message.method==='enable'&&message.channel===0&&message.enabled),execution+' NES starter');
    const snapshot=await page.evaluate(async()=>{
      const synth=window.__nativeBackendTest.runtime.megaDrive;
      return {chip:synth.capabilities.chip,fm:synth.fm,psg:synth.psg,pcm:synth.pcm,dx7:synth.dx7,
        endpoints:synth.primaryEndpoints.map(endpoint=>endpoint.name),chips:synth.chipInspector.list(),mixer:synth.mixer.list()};
    });
    assert.equal(snapshot.chip,'nes');for(const key of ['fm','psg','pcm','dx7'])assert.equal(snapshot[key],null);
    assert.deepEqual(snapshot.endpoints,['nes']);assert.deepEqual(snapshot.chips.map(chip=>chip.id),['nes']);
    assert.deepEqual(snapshot.mixer.filter(chip=>chip.connected).map(chip=>chip.id),['nes']);
    if(execution==='worker')assert(commands().some(entry=>entry.frame>0&&entry.performance&&entry.owner),'Worker NES writes retain scheduling and owner');
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    const session=native.current.session;
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`
      if(typeof fm!=='undefined'||typeof psg!=='undefined'||typeof play!=='undefined')throw Error('Hidden OPN helpers in NES');
      if(await useSoundChip('nes')!==nes)throw Error('Built-in NES not borrowed');
      nes.pulse.setVoice(0,{duty:0.25,volume:10});nes.triangle.noteOn('C3');
      nes.noise.setVoice({period:5,volume:4,shortMode:true});nes.noise.noteOn();
      await nes.dmc.loadSample(new Uint8Array(33).fill(0x5a));nes.dmc.play({rate:15,loop:true,level:70});
      nes.fds.setWave(Array.from({length:64},(_,i)=>i));nes.fds.setVolume(23,2);
      nes.fds.setModulation({table:Array.from({length:32},(_,i)=>i%8),rate:500,depth:11,bias:-5});nes.fds.noteOn('A3');
      await mixer.set(nes.id,{volume:0.7,pan:0.25});
      const gain=fx.gain({gain:0.5});fx.setChain([gain]);
      liveFx('native-nes-fx',{process(input,output){output.forEach((channel,index)=>channel.set(input[index]));}});
      liveLoop('native-nes-phrase',async()=>{nes.pulse.noteOn(0,'E4');await beat(.05);nes.pulse.keyOff(0);await beat(.05);});
    `,{execution}),execution);
    await until(()=>writes().some(message=>message.method==='write'&&message.address===0x4087&&!(message.value&128))&&writes().some(message=>message.method==='load-memory'),execution+' NES DMC/FDS');
    const applied=await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('nes'));
    assert.equal(applied.fdsEnabled,true);assert.equal(applied.channels.length,6);assert.deepEqual(applied.fds.wave,Array.from({length:64},(_,i)=>i));
    assert.equal(applied.fds.gain,23);assert.equal(applied.fds.master,2);assert.equal(applied.fds.modulation.depth,11);assert.equal(applied.dmc.loaded,true);
    assert.equal(native.nesChip.engine.memory[0xc000],0x5a);
    assert(writes().some(message=>message.method==='mix'),'NES mixer must reach Native');
    await until(()=>native.liveFx.has('native-nes-fx'),execution+' NES Native liveFx registration');
    await assertNoLiveAudio(page);
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    const stopped=await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('nes'));
    assert(stopped.channels.every(channel=>!channel.active));assert.deepEqual(stopped.fds.wave,applied.fds.wave);assert.equal(stopped.dmc.loaded,true);
    assert.equal(native.current.session,session);assert.equal(native.nesChip.engine.memory[0xc000],0x5a);
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource("nes.fds.noteOn('C4');nes.fds.keyOff();",{execution}),execution);
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    const error=await page.evaluate(async execution=>{try{await window.__nativeBackendTest.runtime.playSource("await createSoundChip('nes');",{execution});return null;}catch(error){return error.message;}},execution);
    assert.match(error,/useSoundChip\(['"]nes['"]\)/);
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  }
  await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:nes');
  for(const channel of [0,1,2,3,4,5]){
    await page.selectOption('#playgroundKeyboardTargetChannel',String(channel));await page.locator('#keyboardTab').focus();
    const first=allCommands().length;
    await page.keyboard.down('z');await until(()=>allCommands().slice(first).some(entry=>entry.type==='nes'&&entry.message.method==='batch'&&entry.message.action==='on'&&entry.message.channel===channel),'NES Keyboard '+channel);
    await page.keyboard.up('z');await until(()=>allCommands().slice(first).some(entry=>entry.type==='nes'&&entry.message.method==='batch'&&entry.message.action==='off'&&entry.message.channel===channel),'NES Keyboard release '+channel);
  }
  await page.click('#nesTab');await page.locator('#nesPanel [data-nes-control="pulse-0-volume"]').waitFor();
  await page.locator('#nesPanel [data-nes-control="pulse-0-volume"]').evaluate(node=>{node.value='13';node.dispatchEvent(new Event('change',{bubbles:true}));});
  await until(()=>native.nesInspector.registers[0]%16===13,'NES Operator pulse edit');
  await page.click('#nesPanel [data-nes-channel="5"]');
  await page.locator('#nesPanel [data-nes-control="fds-gain"]').evaluate(node=>{node.value='19';node.dispatchEvent(new Event('change',{bubbles:true}));});
  await until(()=>native.nesInspector.fdsGain===19,'NES Operator FDS edit');
  const hold=page.locator('#nesPanel [data-nes-action="audition"]');await hold.scrollIntoViewIfNeeded();const rect=await hold.boundingBox();
  let first=allCommands().length;await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
  await until(()=>allCommands().slice(first).some(entry=>entry.type==='nes'&&entry.message.action==='on'&&entry.message.channel===5),'FDS Operator hold');
  await page.mouse.move(5,5);await page.mouse.up();await until(()=>allCommands().slice(first).some(entry=>entry.type==='nes'&&entry.message.action==='off'),'FDS Operator release outside');
  await page.click('#nesPanel [data-nes-action="keyboard"]');await page.locator('#keyboardPanel').waitFor({state:'visible'});await page.locator('#nesTab').focus();
  first=allCommands().length;await page.keyboard.down('z');await until(()=>allCommands().slice(first).some(entry=>entry.type==='nes'&&entry.message.action==='on'),'FDS Operator Keyboard');
  await page.keyboard.up('z');await until(()=>allCommands().slice(first).some(entry=>entry.type==='nes'&&entry.message.action==='off'),'FDS Operator Keyboard release');
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  await page.evaluate(starter=>window.__nativeBackendTest.runtime.playSource(starter,{execution:'main'}),starter);
  native.monitor.reads.length=0;await nativeAudioMonitor(page,native,artifacts,name+'-nes');await nativeRecording(page,native);
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());await assertNoLiveAudio(page);
  await nativeImportedNes(page,native);
  await page.evaluate(source=>window.__nativeBackendTest.editor.setValue(source),source);
  await changeNativeMode(page,native,'genesis','keep');await nativeRun(page,native);
}
async function nativeConsoles(page,native,artifacts,name) {
  const allCommands=()=>native.calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]);
  for(const [mode,kind,count]of [['gameboy','gameboy',4],['snes','snes',8],['pc-engine','huc6280',6]]){
    const only=process.argv.find(value=>value.startsWith('--console='));if(only&&only.slice(10)!==mode)continue;
    await changeNativeMode(page,native,mode);
    const starter=await fs.readFile(path.resolve(__dirname,`../docs/playground/defaults/${mode}/index.js`),'utf8');
    for(const execution of ['main','worker']){
      let first=allCommands().length;
      await page.evaluate(({starter,execution})=>window.__nativeBackendTest.runtime.playSource(starter,{execution}),{starter,execution});
      const commands=()=>allCommands().slice(first).filter(command=>command.type===kind);
      await until(()=>commands().length>0,`${mode}/${execution} starter commands`);
      const state=await page.evaluate(async()=>{
        const synth=window.__nativeBackendTest.runtime.megaDrive;
        return {backend:synth.backend,chip:synth.capabilities.chip,endpoints:synth.primaryEndpoints.map(endpoint=>endpoint.name),
          fm:synth.fm,psg:synth.psg,pcm:synth.pcm,dx7:synth.dx7,nes:synth.nes,inspected:await synth.chipInspector.list()};
      });
      assert.equal(state.backend,'native-genesis');assert.equal(state.chip,kind);assert.deepEqual(state.endpoints,[kind]);
      assert.deepEqual(state.inspected.map(chip=>chip.id),[kind]);for(const field of ['fm','psg','dx7','nes'])assert.equal(state[field],null,`${mode} has no hidden ${field}`);
      if(kind!=='huc6280')assert.equal(state.pcm,null);
      if(execution==='worker')assert(commands().some(command=>command.performance&&command.owner&&command.frame>0),`${mode} Worker must retain frame/owner timing`);
      await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
      const session=native.current.session;
      const extras=kind==='gameboy'?`
        if(await useSoundChip('gameboy')!==gameboy)throw Error('Game Boy primary was not reused');
        gameboy.wave.setWaveform(Array.from({length:32},(_,i)=>i%16));gameboy.wave.noteOn('C3');
        gameboy.pulse.setVoice(1,{duty:0.5,volume:10});gameboy.noise.setVoice({volume:7});gameboy.noise.keyOn();
        await mixer.set(gameboy.id,{volume:0.7,pan:-0.2});
        liveLoop('native-console-extra',async()=>{gameboy.pulse.noteOn(0,'E4');await beat(.05);gameboy.pulse.keyOff(0);await beat(.05);});
      `:kind==='huc6280'?`
        if(await useSoundChip('huc6280')!==pce)throw Error('PC Engine primary was not reused');
        for(let ch=0;ch<6;ch++){pce.setWaveform(ch,Array.from({length:32},(_,i)=>(i+ch)&31));pce.setVolume(ch,25);pce.setPan(ch,15,14);}
        pce.setNoise(4,{enabled:true,frequency:17});pce.keyOn(4);
        await mixer.set(pce.id,{volume:0.6,pan:0.25});
        liveLoop('native-console-extra',async()=>{pce.noteOn(0,'E4');await beat(.05);pce.keyOff(0);await beat(.05);});
      `:`
        if(await useSoundChip('snes')!==snes)throw Error('SNES primary was not reused');
        const instrument=await snes.loadBRR(new Uint8Array([0xb3,0x12,0x34,0x56,0x78,0x9a,0xbc,0xde,0xf0]),{baseFrequencyHz:2000,loopStartSamples:0});
        for(let ch=0;ch<8;ch++)snes.setPreset(ch,{sample:instrument,adsr1:0,adsr2:0,gain:100,volumeLeft:80,volumeRight:90});
        await mixer.set(snes.id,{volume:0.65,pan:0.15});
        liveLoop('native-console-extra',async()=>{snes.noteOn(0,'E4');await beat(.05);snes.noteOff(0);await beat(.05);});
      `;
      first=allCommands().length;
      await page.evaluate(({extras,execution})=>window.__nativeBackendTest.runtime.playSource(extras,{execution}),{extras,execution});
      await until(()=>commands().some(command=>command.message.method==='mix'),`${mode}/${execution} Native mixer`);
      const inspected=await page.evaluate(kind=>window.__nativeBackendTest.runtime.chipInspector.read(kind),kind);
      assert.equal(inspected.kind,kind);assert.equal(inspected.channels.length,count);
      await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());assert.equal(native.current.session,session);
      if(kind==='gameboy'){assert.equal(native.gameboyInspector.voice[32],1);assert(native.gameboyInspector.gates.every(gate=>!gate));}
      if(kind==='huc6280'){assert.equal(native.hucInspector.waveforms[3][7],10);assert(native.hucInspector.registers.every(row=>!(row[4]&128)));}
      if(kind==='snes'){assert(native.snes.ram.includes(0xb3));assert.equal(native.snes.enabled,0);}
      await assertNoLiveAudio(page);
    }
    // Every fixed physical voice uses the ordinary computer-key and pointer
    // Guitar path; no additional sound chip may be constructed.
    await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:'+kind);
    for(let channel=0;channel<count;channel++){
      await page.selectOption('#playgroundKeyboardTargetChannel',String(channel));await page.locator('#keyboardTab').focus();
      const first=allCommands().length,commands=()=>allCommands().slice(first).filter(command=>command.type===kind);
      await page.keyboard.down('z');await until(()=>commands().some(command=>command.message.method==='batch'&&command.message.channel===channel&&command.message.action==='on'),`${mode} Keyboard channel ${channel}`);
      await page.keyboard.up('z');await until(()=>commands().some(command=>command.message.method==='batch'&&command.message.action==='off'),`${mode} Keyboard release ${channel}`);
    }
    await page.selectOption('#playgroundKeyboardTargetChannel','0');
    const first=allCommands().length,commands=()=>allCommands().slice(first).filter(command=>command.type===kind);
    const key=page.locator('#operatorKeyboardRoot .key').first();
    assert.equal(await key.count(),1,`${mode} Guitar key must be visible`);await key.scrollIntoViewIfNeeded();
    {
      const rect=await key.boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await until(()=>commands().some(command=>command.message.action==='on'),`${mode} Guitar pointer`);await page.mouse.up();await until(()=>commands().some(command=>command.message.action==='off'),`${mode} Guitar pointer release`);
    }
    if(kind!=='snes'){
      await page.click(`#${kind}Tab`);const prefix=kind==='gameboy'?'gb':'pce';const root=`#${kind}Panel`;
      const hold=page.locator(`${root} [data-chip-action="${prefix}-hold"]`);await hold.waitFor();await hold.scrollIntoViewIfNeeded();const rect=await hold.boundingBox();
      const before=allCommands().length;await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await until(()=>allCommands().slice(before).some(command=>command.type===kind&&command.message.action==='on'),`${mode} Operators hold`);
      await page.mouse.move(5,5);await page.mouse.up();await until(()=>allCommands().slice(before).some(command=>command.type===kind&&command.message.action==='off'),`${mode} Operators release outside`);
      await page.click(`${root} [data-chip-action="${prefix}-keyboard"]`);await page.locator(`#${kind}Tab`).focus();
      const keyboardFirst=allCommands().length;await page.keyboard.down('z');await until(()=>allCommands().slice(keyboardFirst).some(command=>command.type===kind&&command.message.action==='on'),`${mode} Operators Keyboard`);await page.keyboard.up('z');await until(()=>allCommands().slice(keyboardFirst).some(command=>command.type===kind&&command.message.action==='off'),`${mode} Operators Keyboard release`);
    }
    if(kind==='huc6280'){
      const first=allCommands().length;
      const state=await page.evaluate(async()=>{
        const inspector=window.__nativeBackendTest.runtime.chipInspector;
        await inspector.invoke('huc6280','auditionOn',[0,60,'dda-transition']);
        await inspector.invoke('huc6280','setVoice',[0,{dda:true,ddaValue:17}]);
        const state=await inspector.read('huc6280');
        await inspector.invoke('huc6280','setVoice',[0,{dda:false}]);return state;
      });
      assert.equal(state.channels[0].dda,true);assert.equal(state.channels[0].active,false,'DDA edits must release the previous Keyboard lease');
      assert(allCommands().slice(first).some(command=>command.type==='huc6280'&&command.message.action==='off'),'DDA transition must reach Native release');
    }
    if(kind==='snes')for(const execution of ['main','worker']){
      const first=allCommands().length;
      await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`
        const initial=await snes.snapshot();if(initial.ram.length!==65536||initial.dsp.length!==128)throw Error('Native SNES snapshot incomplete');
        await snes.prepareTimeline({version:1,clockRate:1024000,durationClocks:32000,initialState:{ram:initial.ram,dsp:initial.dsp,outputDelayFrames:4},events:new Uint32Array([0,0,0x5c,0,0,0,0x4c,1])});
        await snes.playTimeline();const state=await snes.getTimelineState();if(!state.ended)throw Error('Native SNES timeline completion missing');
      `,{execution}),execution);
      assert(allCommands().slice(first).some(command=>command.type==='snes'&&command.message.method==='prepare-timeline'),`${execution} captured SNES timeline`);
      await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    }
    await assertNoLiveAudio(page);
  }
  await changeNativeMode(page,native,'genesis','keep');
  await page.evaluate(source=>window.__nativeBackendTest.editor.setValue(source),source);await nativeRun(page,native);
}
function importedNativeNesVgm(clock=1789773) {
  const write=(register,value)=>[0xb4,register,value];
  const ram=Array.from({length:17},(_,index)=>(index*29+0x55)&255);
  const commands=[0x67,0x66,0xc2,ram.length+2,0,0,0,0,0xc0,...ram,
    ...write(0x15,1),...write(0,0xbf),...write(2,0xfd),...write(3,8),
    ...write(0x3f,2),...write(0x29,128),
    ...Array.from({length:64},(_,index)=>write(0x40+index,(index*3)&63)).flat(),
    ...write(0x29,2),...write(0x20,0x98),...write(0x22,0x74),...write(0x23,0),
    ...write(0x10,0x4f),...write(0x11,64),...write(0x12,0),...write(0x13,1),...write(0x15,17),
    0x61,0x22,0x11,0x66];
  const bytes=new Uint8Array(256+commands.length),header=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);header.setUint32(4,bytes.length-4,true);header.setUint32(8,0x161,true);
  header.setUint32(0x34,0xcc,true);header.setUint32(0x84,(clock|0x80000000)>>>0,true);bytes.set(commands,256);
  return {bytes:Array.from(bytes),ram};
}
async function nativeImportedNes(page,native) {
  const {bytes,ram}=importedNativeNesVgm();
  for(const mode of ['raw','readable','high'])for(const execution of ['main','worker']) {
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    const first=native.calls.length,session=native.current.session;
    const calls=()=>native.calls.slice(first);
    const commands=()=>calls().flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]).filter(command=>command.type==='nes');
    const flatten=messages=>messages.flatMap(message=>message.method==='batch'?flatten(message.commands):[message]);
    await page.evaluate(async({bytes,mode})=>{
      await window.__nativeBackendTest.importVgmFile(new File([Uint8Array.from(bytes)],'native-nes-import.vgm'),{
        targetPath:'/native-nes-import.js',nesMode:mode,
      });
    },{bytes,mode});
    const generated=await page.evaluate(()=>window.__nativeBackendTest.editor.getValue());
    assert.match(generated,/await useSoundChip\(['"]nes['"]\)/,`${mode}/${execution}: real NTSC import must borrow Native NES`);
    assert.doesNotMatch(generated,/createSoundChip\(['"]nes['"]\)|nes\.dispose\(/,'Borrowed NES import must preserve the owning Native device');
    if(mode==='high'){assert.match(generated,/nes\.pulse\.setVoice/);assert.match(generated,/nes\.setFrequency/);}
    await page.evaluate(({generated,execution})=>window.__nativeBackendTest.runtime.playSource(generated,{execution}),{generated,execution});
    await until(()=>commands().some(command=>command.message.method==='load-memory')&&
      flatten(commands().map(command=>command.message)).some(message=>message.method==='write'&&message.address===0x4015&&message.value===17),`${mode}/${execution}: imported DMC RAM and mixed APU/FDS writes`);
    assert.deepEqual(Array.from(native.nesChip.engine.memory.slice(0xc000,0xc000+ram.length)),ram,'Imported DMC RAM must survive its generated cleanup');
    assert.equal(native.current.session,session,'VGM import and cleanup must reuse the Native NES session');
    assert.equal(calls().filter(call=>call.command==='native_genesis_shutdown').length,0);
    // The Worker's run-result and direct chip port have independent delivery
    // order. Wait for its final releases to reach Native before reading state.
    await until(()=>native.nesInspector.enabled===0&&Boolean(native.nesInspector.registers[0x83]&128)&&
      native.nesInspector.registers[0x80]===128,`${mode}/${execution}: imported NES channel cleanup admission`);
    const snapshot=await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('nes'));
    assert.deepEqual(snapshot.fds.wave,Array.from({length:64},(_,index)=>(index*3)&63));
    assert(snapshot.channels.every(channel=>!channel.active),`${mode}/${execution}: Generated NES VGM cleanup must release the stream channels: ${JSON.stringify({channels:snapshot.channels.map(channel=>({channel:channel.channel,active:channel.active})),tail:commands().slice(-12).map(command=>command.message)})}`);
    if(execution==='worker')assert(commands().some(command=>command.frame>0&&command.performance&&command.owner),'Imported Worker NES commands must retain their performance timing and owner');
    await assertNoLiveAudio(page);
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  }
  // PAL uses different noise/DMC/frame periods. A Native NTSC core must not
  // silently claim support by applying only an outer clock ratio.
  const pal=importedNativeNesVgm(1662607).bytes;
  for(const execution of ['main','worker']) {
    await page.evaluate(async bytes=>window.__nativeBackendTest.importVgmFile(new File([Uint8Array.from(bytes)],'pal-nes-import.vgm'),{
      targetPath:'/pal-nes-import.js',nesMode:'raw',
    }),pal);
    const generated=await page.evaluate(()=>window.__nativeBackendTest.editor.getValue());
    assert.match(generated,/createSoundChip\(['"]nes['"].*1662607/,'PAL import must retain its authored region constructor');
    const message=await page.evaluate(async({generated,execution})=>{
      try{await window.__nativeBackendTest.runtime.playSource(generated,{execution});return null;}
      catch(error){return error.message;}
    },{generated,execution});
    assert.match(message,/Web Audio/,'Unsupported PAL playback must explain the available backend');
    assert.match(message,/clock|region|1789773/i,'Unsupported PAL playback must identify the region/clock difference');
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  }
}
async function compareNativeFft(browser,name,fixture) {
  assert.equal(fixture.samples?.length,4096);assert.equal(fixture.bins?.length,2048);
  assert(fixture.samples.every(Number.isFinite)&&fixture.bins.every(Number.isFinite));
  const page=await browser.newPage();
  try {
    const result=await page.evaluate(async({sampleRate,samples})=>{
      const Type=window.OfflineAudioContext??window.webkitOfflineAudioContext;
      const context=new Type(1,8192,sampleRate),analyser=context.createAnalyser();
      analyser.fftSize=4096;analyser.smoothingTimeConstant=0;analyser.minDecibels=-100;analyser.maxDecibels=0;
      // Repeat the exact native period so every analyser window sees the same
      // steady source, regardless of the browser's final render quantum.
      const buffer=context.createBuffer(1,8192,sampleRate),pcm=buffer.getChannelData(0);
      pcm.set(samples);pcm.set(samples,4096);
      const source=context.createBufferSource();source.buffer=buffer;source.connect(analyser);analyser.connect(context.destination);source.start();
      await context.startRendering();
      const bins=new Float32Array(2048),wave=new Float32Array(4096);
      analyser.getFloatFrequencyData(bins);analyser.getFloatTimeDomainData(wave);
      let square=0,peak=0;for(const value of wave){square+=value*value;peak=Math.max(peak,Math.abs(value));}
      return {bins:Array.from(bins),rms:Math.sqrt(square/wave.length),peak};
    },fixture);
    const clamp=value=>Math.max(-100,Math.min(0,value));
    let maxError=0,maxBin=0;
    for(let i=0;i<2048;i++) {
      assert(!Number.isNaN(result.bins[i]));const error=Math.abs(clamp(result.bins[i])-clamp(fixture.bins[i]));
      if(error>maxError){maxError=error;maxBin=i;}
    }
    assert(maxError<.02,`${name}: native FFT differs from OfflineAudioContext by ${maxError} dB at bin ${maxBin}`);
    assert(Math.abs(result.rms-fixture.rms)<1e-6,`${name}: native RMS must match the offline analyser window`);
    assert(Math.abs(result.peak-fixture.peak)<1e-6,`${name}: native peak must match the offline analyser window`);
    console.log(`${name}: PASS actual native 4096-point Blackman FFT/RMS/peak vs offline Web Audio; maximum ${maxError.toExponential(3)} dB at bin ${maxBin}; no output device`);
  } finally {await page.close();}
}

async function checkBrowser(name, type, url, artifacts,fftFixture) {
  const browser = await type.launch({headless:true,...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  try {
    if(fftFixture)await compareNativeFft(browser,name,fftFixture);
    const plain = await browser.newContext({serviceWorkers:'block'});
    const normal = await plain.newPage();
    // Exercise the real textarea fallback; external Monaco CDN availability is
    // unrelated to native transport/settings and is not required by this check.
    await normal.route('**/vs/loader*.js', route => route.abort());
    await normal.goto(url);
    await ready(normal);
    assert.equal(await normal.locator('#audioEngineButton').count(), 0);
    await plain.close();
    const context = await browser.newContext({serviceWorkers:'block'}), page = await context.newPage();
    const native = new FakeNative(), errors = [];
    native.dx7WasmRequests=[];
    page.on('request',request=>{if(request.url().includes('/msfa_dx7/wasm/msfa.wasm'))native.dx7WasmRequests.push(request.url());});
    await page.exposeBinding('__nativeInvoke', (_event, command, args) => native.invoke(command, args));
    await page.addInitScript(observeAudioCreation);
    await page.addInitScript(observeMonitorDrawing);
    await page.addInitScript(() => {window.__TAURI_INTERNALS__ = {invoke:(command,args) => window.__nativeInvoke(command,args)};});
    await page.route('**/vs/loader*.js', route => route.abort());
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(20000);
    await page.goto(url); await ready(page);
    const allModeIds=await modeIds(page);
    assert(allModeIds.length>1&&allModeIds.includes('genesis')&&allModeIds.includes('gameboy'),'Web Audio must list every machine mode');
    assert.equal(native.count('native_genesis_start'), 0);
    await openSettings(page);
    assert.equal(await page.locator('#audioEngineSelect').inputValue(), 'webaudio');
    await page.locator('#audioEngineDialog').evaluate(dialog => dialog.close());
    await page.evaluate(source => {window.__nativeBackendTest.editor.setValue(source); document.getElementById('workerExecution').checked = false;}, source);
    await run(page);
    assert(await page.evaluate(() => window.__audioConstructions.contexts > 0 && window.__audioConstructions.worklets.includes('ym2612-processor')));
    assert.equal(native.count('native_genesis_start'), 0);
    await selectEngine(page, 'native');
    assert.equal(native.count('native_genesis_start'), 0, 'Selection alone must not open a device');
    await nativeRun(page, native);
    if(process.argv.includes('--consoles-only')) {
      await nativeConsoles(page,native,artifacts,name);
      assert.deepEqual(errors,[]);
      await fs.writeFile(path.join(artifacts,name+'-native-consoles.json'),JSON.stringify({mockedNative:true,calls:native.calls},null,2));
      await context.close();console.log(name+': PASS focused Native Game Boy / SNES / PC Engine Main/Worker, shipped starters, Keyboard, Operators, RAM/wave retention, SNES timeline, mode handoff; Native IPC mocked');return;
    }
    if(process.argv.includes('--nes-only')) {
      await nativeNes(page,native,artifacts,name);
      assert.deepEqual(errors,[]);
      await context.close();
      console.log(name+': PASS focused Native NES + FDS Main/Worker/Keyboard/Operators/Stop/recording and mode handoff; Native IPC mocked');
      return;
    }
    await assertNativeModeRestriction(page,native);
    const firstSession = native.current.session;
    await page.click('#stopButton');
    await until(() => native.count('native_genesis_stop') > 0);
    await page.waitForFunction(() => window.__nativeBackendTest.runtime.getState().playback === 'stopped');
    await keyboard(page, native);
    await workerMediaRun(page,native);
    await compressedSampleRuns(page,native);
    await nativeNoiseRuns(page,native);
    await nativeLiveFxRuns(page,native);
    await nativeLiveFxDiagnostics(page,native);
    await nativeRun(page, native);
    await nativeAudioMonitor(page,native,artifacts,name);
    await nativeRecording(page,native);
    assert.equal(native.current.session, firstSession, 'Stop/Run should reuse the stream clock');
    await nativeMegaCd(page,native,artifacts,name);
    await nativeDx7(page,native,artifacts,name);
    await nativeNes(page,native,artifacts,name);
    await nativeConsoles(page,native,artifacts,name);
    await openSettings(page);
    await page.screenshot({path:path.join(artifacts, name + '-native-settings.png')});
    await page.locator('#audioEngineDialog').evaluate(dialog => dialog.close());
    await selectEngine(page, 'webaudio');
    assert(native.count('native_genesis_shutdown') > 0);
    assert.equal(native.current, null);
    assert.deepEqual(await modeIds(page),allModeIds,'Returning to Web Audio must restore the full machine list');
    // Native failure remains visible and selected, with no silent Web Audio fallback.
    native.failStart = true;
    await selectEngine(page, 'native');
    await page.click('#runButton');
    await page.waitForFunction(() => document.body.textContent.includes('Simulated native device unavailable'));
    assert.equal(await page.evaluate(() => new URL(location.href).searchParams.get('audioEngine')), 'native');
    await assertNoLiveAudio(page);
    await selectEngine(page, 'webaudio'); await run(page);
    assert(await page.evaluate(() => window.__audioConstructions.contexts > 0));
    // Unsupported machines can be selected after explicitly returning to Web Audio.
    assert.deepEqual(await modeIds(page),allModeIds);
    await page.locator('#mainMenu > summary').click();
    await page.selectOption('#playgroundMode', 'msx');
    await page.locator('#changeModeDialog').waitFor({state:'visible'});
    await Promise.all([page.waitForURL(url => url.searchParams.get('mode') === 'msx'), page.locator('#changeModeDialog').evaluate(dialog => dialog.close('keep'))]);
    await ready(page);
    assert.equal(native.current, null);
    assert.notEqual(await page.evaluate(() => window.__nativeBackendTest.runtime.megaDrive.backend), 'native-genesis');
    assert.deepEqual(await modeIds(page),allModeIds,'Non-Genesis Web Audio must retain the complete mode list');
    await openSettings(page);
    assert.equal(await page.locator('#audioEngineSelect option[value="native"]').isDisabled(), true);
    assert.equal(await page.locator('#audioEngineSelect').inputValue(), 'webaudio');
    const gameboyUrl=page.url(),gameboyStarts=native.count('native_genesis_start');
    await page.locator('#audioEngineSelect').evaluate(select=>{select.value='native';});
    await page.click('#audioEngineApply');
    assert.equal(page.url(),gameboyUrl,'A forged disabled Native selection must not navigate');
    assert.equal(native.count('native_genesis_start'),gameboyStarts);
    await page.locator('#audioEngineDialog').evaluate(dialog => dialog.close());
    // A manually supplied incompatible URL must truthfully display the actual Web Audio backend.
    const starts=native.count('native_genesis_start');
    const preservedSource=await page.evaluate(()=>window.__nativeBackendTest.editor.getValue());
    const incompatible=new URL(page.url());incompatible.searchParams.set('audioEngine','native');
    const encodedSource=Buffer.from(preservedSource).toString('base64url');incompatible.searchParams.set('src',encodedSource);
    await page.goto(incompatible.href);await ready(page);
    assert.equal(await page.evaluate(()=>window.__nativeBackendTest.selectedMode.id),'msx');
    assert.equal(new URL(page.url()).searchParams.get('audioEngine'),null,'The incompatible Native query must be removed');
    assert.equal(new URL(page.url()).searchParams.get('src'),encodedSource,'URL normalization must preserve the source parameter');
    assert.equal(await page.evaluate(()=>window.__nativeBackendTest.editor.getValue()),preservedSource,'URL normalization must preserve the current project');
    assert.notEqual(await page.evaluate(()=>window.__nativeBackendTest.runtime.megaDrive.backend),'native-genesis');
    assert.equal(native.count('native_genesis_start'),starts,'An incompatible URL must never start Native');
    assert.deepEqual(await modeIds(page),allModeIds,'An incompatible URL uses the full Web Audio mode list');
    await openSettings(page);
    assert.equal(await page.locator('#audioEngineSelect').inputValue(),'webaudio');
    assert.equal(await page.locator('#audioEngineSelect option[value="native"]').isDisabled(),true);
    assert.equal(await page.locator('#audioEngineButton .menu-value').textContent(),'Web Audio');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(artifacts, name + '-native-settings.json'), JSON.stringify({mockedNative:true, calls:native.calls}, null, 2));
    await context.close();
    console.log(`${name}: PASS Web Audio default, project handoff, Native Genesis/Mega CD/NES + FDS/DX7 Main/Worker and shipped starters, actual RF High/Write and NES Raw/Readable/High VGM imports with shared cleanup/RAM retention and PAL guard, RF RAM/loadSample and polyphonic sample Keyboard, NES six-channel Keyboard/Operators/DMC RAM/FDS wave/modulation and Stop retention, DX7 SysEx/live operators/PC and Guitar Keyboard/Operators audition and bank retention, real FLAC decoding, DAC/sample/FX/noise/liveFx, Envelope/Wave/Spectrum and observation lifecycle, loop cancellation, recording, Stop/Run, failure/recovery, Native mode restrictions and incompatible URL; no native live AudioContext/Worklet (native IPC mocked)`);
  } finally {await browser.close();}
}

(async () => {
  const option = process.argv.find(value => value.startsWith('--out='));
  const artifacts = option ? path.resolve(option.slice(6)) : await fs.mkdtemp(path.join(os.tmpdir(), 'playground-native-backend-'));
  await fs.mkdir(artifacts, {recursive:true});
  const fftOption=process.argv.find(value=>value.startsWith('--fft-fixture='));
  const fftFixture=fftOption?JSON.parse(await fs.readFile(path.resolve(fftOption.slice(14)),'utf8')):null;
  await new Promise((resolve,reject) => {server.once('error',reject); server.listen(0,'127.0.0.1',resolve);});
  try {
    const url = `http://127.0.0.1:${server.address().port}${entryPath}?mode=genesis`;
    for (const [name,type] of [['chromium',chromium],['webkit',webkit]]) {
      if (!process.argv.includes('--chromium') && !process.argv.includes('--webkit') || process.argv.includes('--' + name)) await checkBrowser(name,type,url,artifacts,fftFixture);
    }
    console.log('Artifacts: ' + artifacts);
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1;});
