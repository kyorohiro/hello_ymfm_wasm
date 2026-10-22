// Real shared Playground/settings, real Web Audio regression, mocked native IPC.
// No native audio device is opened. Native PCM is covered by Rust/C++ offline tests.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {chromium, webkit} = require('playwright');
const {observeNativeLifecycle,trackNativeLifecycle,runNativeLifecycle}=require('./native_backend_lifecycle.cjs');
const {runMixerState}=require('./native_backend_mixer_state.cjs');
const rootOption = process.argv.find(value => value.startsWith('--root='));
const docs = rootOption ? path.resolve(rootOption.slice(7)) : path.resolve(__dirname, '../docs');
const entryPath = rootOption ? '/index.html' : '/playground/index.html';
const nativeModeIds=['genesis','mega-cd','genesis-full','genesis-full-nuked','pc98-26','pc98','neogeo','neogeo-b','gameboy','nes','snes','x68000','pc-engine','game-gear','master-system','msx','msx-audio','dx7','ym3812','ym3526','ymf262'];
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'};
const accessor = '\nwindow.__nativeBackendTest={runtime,selectedMode,importVgmFile,virtualFiles,captureProjectSnapshot,restoreProjectSnapshot,exportCassette,loadCassetteSource,...(typeof mixerState==="undefined"?{}:{mixerState}),get editor(){return editorAdapter}};';
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
      ymClock:7670454,psgClock:3579545,mode:this.current.mode,engine:['genesis-full-nuked','genesis-nuked'].includes(this.current.mode)?'nuked':'ymfm',rf5c164Clock:['mega-cd','32x','genesis-full-nuked'].includes(this.current.mode)?12500000:null,pwmClock:['32x','genesis-full-nuked'].includes(this.current.mode)?23011361:null,running:true,queued:0,lateCommands:0,queueOverflows:0,error:null,
      liveFx:{active:this.liveFx.size,initialized:this.liveFx.size>0,latencyFrames:this.liveFx.size?2048:0,
        blockFrames:128,queuedCommands:0,processCalls:0,underruns:0,overruns:0,error:this.liveFxError}};
  }
  async invoke(command, args = {}) {
    this.calls.push({command,args});
    if (command === 'native_genesis_start') {
      if (this.failStart) {this.failStart = false; throw Error('Simulated native device unavailable');}
      this.liveFx.clear(); this.liveFxError = null;
      assert(args.mode===undefined||nativeModeIds.includes(args.mode)||args.mode==='32x'||args.mode==='genesis-nuked');
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
      const {PWM32X}=await import('../web/pwm32x.js');
      this.pwm=new PWM32X({sampleRate:48000,outputMode:'duty',gain:1});
      this.pwmQueue=[];this.pwmLastSchedule=null;
      this.ym2203={clock:4000000,registers:[Array(256).fill(0)],keyMasks:[0,0,0],ssgLevels:[0,0,0],ssgGates:[false,false,false],held:new Map(),sourceMuteMask:0,status:0,irq:false,prescaler:6,revision:0};
      this.opna={registers:[Array(256).fill(0),Array(256).fill(0)],clock:8000000,romLoaded:false,adpcmMemoryBytes:0,
        memory:new Uint8Array(0x200000),held:new Map(),revision:0};
      this.opnb={registers:[Array(256).fill(0),Array(256).fill(0)],clock:8000000,roms:[new Uint8Array(0x1000000),new Uint8Array(0x1000000)],loaded:[0,0],held:new Map(),revision:0};
      this.x68000={ym2151:{clock:4000000,registers:Array(256).fill(0),keyMasks:Array(8).fill(0),amDepth:0,pmDepth:0,status:0,irq:false,sourceMuteMask:0,held:new Map()},okim6258:{clock:8000000,divider:512,pan:0,playing:false,streaming:false,repeat:false,positionFrames:0,fedBytes:0,memoryRevision:0,sampleId:0,sample:null,held:new Map()},memory:new Uint8Array(),staging:null};
      this.gameGear={segapsg:{clock:3579545,periods:[0,0,0],attenuations:[15,15,15,15],lastVolumes:[0,0,0,0],latched:0,mode:0,stereo:255,stereoEnabled:true,sourceMuteMask:0,held:new Map()}};
      this.masterSystem={segapsg:{clock:3579545,periods:[0,0,0],attenuations:[15,15,15,15],lastVolumes:[0,0,0,0],latched:0,mode:0,sourceMuteMask:0,held:new Map()},ym2413:{clock:3579545,registers:Array(64).fill(0),sourceMuteMask:0,status:0,irq:false,held:new Map()}};
      this.msx={ym2413:{clock:3579545,registers:Array(64).fill(0),sourceMuteMask:0,status:0,irq:false,held:new Map()},ay8910:{clock:1789773,registers:Array(16).fill(0),levels:[9,9,9],gates:[false,false,false],sourceMuteMask:0,held:new Map()}};
      const oplChip=args.mode==='msx-audio'?'y8950':['ym3526','ym3812','ymf262'].includes(args.mode)?args.mode:'ym3812';this.opl={chip:oplChip,clock:oplChip==='ymf262'?14318180:3579545,registers:Array(oplChip==='ymf262'?512:256).fill(0),sourceMuteMask:oplChip==='ymf262'?262143:511,status:0,irq:false,held:new Map()};
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
    if (command === 'native_genesis_stop') {this.liveFx.clear();this.liveFxError=null;if(this.pcm)this.pcm.mask=255;this.pcmVoices.fill(0);this.dx7Notes.clear();this.nesInspector?.stopVoices();this.stopConsoleVoices();this.stopYm2203Voices();this.stopOpnaVoices();this.stopOpnbVoices();this.stopX68000Voices();this.stopMasterSystemVoices();this.stopMasterSystemVoices(undefined,this.gameGear);this.stopMsxVoices();this.stopOplVoices();this.pwm?.reset();this.pwmQueue=[];return this.status();}
    if (command === 'native_genesis_status') return this.status();
    if(command==='native_genesis_pwm_status') {
      assert(['32x','genesis-full-nuked'].includes(this.current.mode));this.applyPwmQueue();
      return {model:'mame',outputMode:'duty',clock:this.pwm.clock,sampleRate:48000,currentFrame:this.status().frame,queuedWrites:this.pwmQueue.length,
        registers:Array.from({length:5},(_,reg)=>this.pwm.read(reg)),lastSchedule:this.pwmLastSchedule,revision:0,pendingCommands:[]};
    }
    if (command === 'native_genesis_rf5c164_status') {assert(['mega-cd','32x','genesis-full-nuked'].includes(this.current.mode));const state=this.pcm.read();return {...state,mask:this.pcm.mask,selected:this.pcm.selected,channels:state.channels.map(channel=>({...channel,configuredStep:this.pcm.configuredSteps[channel.channel]}))};}
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
    if(command==='native_genesis_opl_status') {
      assert.equal(this.current.mode,this.opl.chip==='y8950'?'msx-audio':this.opl.chip);const s=this.opl;
      return {sampleRate:48000,frame:this.status().frame,revision:this.calls.length,[s.chip]:{...s,held:[...s.held.keys()],pendingCommands:[],sampleRate:48000}};
    }
    if(command==='native_genesis_msx_audio_status') {
      assert.equal(this.current.mode,'msx-audio');
      return {sampleRate:48000,frame:this.status().frame,revision:this.calls.length,...Object.fromEntries([['y8950',this.opl],['ym2413',this.msx.ym2413],['ay8910',this.msx.ay8910]].map(([chip,state])=>[chip,{...state,held:[...state.held.keys()],pendingCommands:[],sampleRate:48000}]))};
    }
    if(command==='native_genesis_msx_status') {
      assert(['msx','msx-audio'].includes(this.current.mode));
      return {sampleRate:48000,frame:this.status().frame,revision:this.calls.length,...Object.fromEntries(['ym2413','ay8910'].map(chip=>{const s=this.msx[chip];return [chip,{...s,held:[...s.held.keys()],pendingCommands:[],sampleRate:48000}];}))};
    }
    if(command==='native_genesis_game_gear_status') {
      assert.equal(this.current.mode,'game-gear');const s=this.gameGear.segapsg;
      return {sampleRate:48000,frame:this.status().frame,revision:this.calls.length,segapsg:{...s,held:[...s.held.keys()],pendingCommands:[],sampleRate:48000}};
    }
    if(command==='native_genesis_master_system_status') {
      assert.equal(this.current.mode,'master-system');
      return {sampleRate:48000,frame:this.status().frame,revision:this.calls.length,...Object.fromEntries(['segapsg','ym2413'].map(chip=>{const s=this.masterSystem[chip];return [chip,{...s,held:[...s.held.keys()],pendingCommands:[],sampleRate:48000}];}))};
    }
    if(command==='native_genesis_x68000_status') {
      assert.equal(this.current.mode,'x68000');
      return {sampleRate:48000,frame:this.status().frame,revision:this.calls.length,...Object.fromEntries(['ym2151','okim6258'].map(chip=>{const s=this.x68000[chip];return [chip,{...s,held:[...s.held.keys()],pendingCommands:[],sampleRate:48000}];}))};
    }
    if(command==='native_genesis_ym2610b_status') {
      assert(['neogeo','neogeo-b'].includes(this.current.mode));const s=this.opnb;
      return {variant:this.current.mode==='neogeo-b'?'ym2610b':'ym2610',clock:s.clock,sampleRate:48000,registers:s.registers.map(row=>row.slice()),adpcmARomBytes:s.loaded[0],adpcmBRomBytes:s.loaded[1],
        held:[...s.held.keys()],sourceMuteMask:0,status:0,statusHi:0,irq:false,frame:this.status().frame,revision:s.revision,pendingCommands:[]};
    }
    if(command==='native_genesis_ym2203_status') {
      assert.equal(this.current.mode,'pc98-26');const s=this.ym2203;
      return {...s,registers:s.registers.map(r=>r.slice()),keyMasks:s.keyMasks.slice(),ssgLevels:s.ssgLevels.slice(),ssgGates:s.ssgGates.slice(),held:[...s.held.keys()],frame:this.status().frame,sampleRate:48000,pendingCommands:[]};
    }
    if(command==='native_genesis_ym2608_status') {
      assert.equal(this.current.mode,'pc98');const s=this.opna;
      return {clock:s.clock,sampleRate:48000,registers:s.registers.map(row=>row.slice()),romLoaded:s.romLoaded,adpcmMemoryBytes:s.adpcmMemoryBytes,
        held:[...s.held.keys()],sourceMuteMask:0,status:0,statusHi:0,irq:false,frame:this.status().frame,revision:s.revision,pendingCommands:[]};
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
      for(const entry of args.commands.filter(entry=>entry.type==='pwm')){
        assert(['32x','genesis-full-nuked'].includes(this.current.mode));const m=entry.message;
        if(m.method==='write'){assert(Number.isInteger(m.register)&&m.register>=0&&m.register<=4);assert(Number.isInteger(m.value)&&m.value>=0&&m.value<=65535);this.pwm.write(m.register,m.value);}
        else if(m.method==='schedule-writes'){
          assert(Array.isArray(m.entries)&&m.entries.length+this.pwmQueue.length<=1000000);
          const baseFrame=m.baseFrame??this.status().frame;
          for(const op of m.entries){assert(Number.isSafeInteger(op.frame)&&op.frame>=0&&Number.isInteger(op.register)&&op.register>=0&&op.register<=4&&Number.isInteger(op.value)&&op.value>=0&&op.value<=65535);this.pwmQueue.push({...op,frame:baseFrame+op.frame});}
          this.pwmQueue.sort((a,b)=>a.frame-b.frame);this.pwmLastSchedule={id:m.id,baseFrame,error:null};this.applyPwmQueue();
        }else if(m.method==='reset'||m.method==='stop-voices'){this.pwm.reset();this.pwmQueue=[];}
        else if(m.method==='clear-schedule')this.pwmQueue=[];
        else if(m.method==='clock')this.pwm.clock=m.hz;
        else assert(['mix','barrier'].includes(m.method),'Unknown Native PWM operation '+m.method);
      }
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
      for(const entry of args.commands.filter(entry=>entry.type==='ym2203')){assert.equal(this.current.mode,'pc98-26');this.applyYm2203(entry.message);}
      if(this.current.mode==='pc98-26')assert(args.commands.every(entry=>['ym2203','mix','noise','fx'].includes(entry.type)),'Native YM2203 has only FM/SSG');
      for(const entry of args.commands.filter(entry=>entry.type==='ym2608')){assert.equal(this.current.mode,'pc98');this.applyOpna(entry.message);}
      for(const entry of args.commands.filter(entry=>entry.type==='ym2610b')){assert(['neogeo','neogeo-b'].includes(this.current.mode));this.applyOpnb(entry.message);}
      for(const entry of args.commands.filter(entry=>entry.type==='opl')){assert.equal(this.current.mode,this.opl.chip==='y8950'?'msx-audio':this.opl.chip);this.applyOpl(entry.message);}
      if(['ym3526','ym3812','ymf262'].includes(this.current.mode))assert(args.commands.every(entry=>['opl','mix','noise','fx'].includes(entry.type)),'Native DOS PC has only selected OPL');
      for(const entry of args.commands.filter(entry=>entry.type==='msx')){assert(['msx','msx-audio'].includes(this.current.mode));this.applyMsx(entry.message);}
      if(this.current.mode==='msx-audio')assert(args.commands.every(entry=>['opl','msx','mix','noise','fx'].includes(entry.type)),'Native MSX Audio has only Y8950, OPLL and AY');
      if(this.current.mode==='msx')assert(args.commands.every(entry=>['msx','mix','noise','fx'].includes(entry.type)),'Native MSX has only OPLL and AY');
      for(const entry of args.commands.filter(entry=>entry.type==='master-system')){assert(['master-system','game-gear'].includes(this.current.mode));if(this.current.mode==='game-gear')assert.equal(entry.message.chip,'segapsg');this.applyMasterSystem(entry.message,this.current.mode==='game-gear'?this.gameGear:this.masterSystem);}
      if(this.current.mode==='game-gear')assert(args.commands.every(entry=>['master-system','mix','noise','fx'].includes(entry.type)),'Native Game Gear has only PSG');
      if(this.current.mode==='master-system')assert(args.commands.every(entry=>['master-system','mix','noise','fx'].includes(entry.type)),'Native Master System has only PSG and OPLL');
      for(const entry of args.commands.filter(entry=>entry.type==='x68000')){assert.equal(this.current.mode,'x68000');this.applyX68000(entry.message);}
      if(this.current.mode==='x68000')assert(args.commands.every(entry=>!['write','psg-write','psg-stereo','reset','dx7','nes','gameboy','snes','huc6280','pwm','ym2608','ym2610b'].includes(entry.type)&&!entry.type.startsWith('rf5c164-')),'Native X68000 must not send hidden chips');
      if(['neogeo','neogeo-b'].includes(this.current.mode))assert(args.commands.every(entry=>!['write','psg-write','psg-stereo','reset','dx7','nes','gameboy','snes','huc6280','pwm','ym2608'].includes(entry.type)&&!entry.type.startsWith('rf5c164-')),'Native Neo Geo must not send hidden chips');
      if(this.current.mode==='pc98')assert(args.commands.every(entry=>!['write','psg-write','psg-stereo','reset','dx7','nes','gameboy','snes','huc6280','pwm'].includes(entry.type)&&!entry.type.startsWith('rf5c164-')),'Native PC-98 must not send hidden YM2612/PSG/other-chip commands');
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
        assert(['mega-cd','32x','genesis-full-nuked'].includes(this.current.mode),'Genesis must never accept PCM commands');
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
  applyPwmQueue(){const frame=this.status().frame;while(this.pwmQueue[0]?.frame<=frame){const op=this.pwmQueue.shift();this.pwm.write(op.register,op.value);}}
  applyOpna(message,bypass=false) {
    const s=this.opna;
    if(message.method==='batch'){
      assert(Number.isInteger(message.channel)&&message.channel>=0&&message.channel<16);assert(Array.isArray(message.commands));
      if(message.action==='off'&&s.held.get(message.channel)!==message.voice)return;
      if(message.action==='on'){assert(Number.isSafeInteger(message.voice)&&message.voice>0);s.held.set(message.channel,message.voice);}
      for(const op of message.commands)this.applyOpna(op,true);
      if(message.action==='off')s.held.delete(message.channel);
    }else if(message.method==='write'){
      const {port,register}=message;let {value}=message;
      assert(Number.isInteger(port)&&port>=0&&port<=1);assert(Number.isInteger(register)&&register>=0&&register<=255);assert(Number.isInteger(value)&&value>=0&&value<=255);
      if(!bypass){
        if(port===0&&register===0x28){const code=value&7,channel=(code&3)+(code&4?3:0);if(s.held.has(channel))return;}
        if(((register>=0xa0&&register<=0xa2)||(register>=0xa4&&register<=0xa6))&&s.held.has(port*3+(register&3)))return;
        if(port===0&&register<6&&s.held.has(6+(register>>1)))return;
        if(port===0&&register>=8&&register<=10&&s.held.has(register-2)&&!(value&31))return;
        if(port===0&&register===7)for(let ch=0;ch<3;ch++)if(s.held.has(6+ch)){const bits=(1<<ch)|(8<<ch);value=(value&~bits)|(s.registers[0][7]&bits);}
        if(port===0&&register===0x10)for(let ch=0;ch<6;ch++)if(s.held.has(9+ch))value&=~(1<<ch);
        if(port===1&&[0,9,10].includes(register)&&s.held.has(15))return;
      }
      s.registers[port][register]=value;
    }else if(message.method==='rom'){
      assert.equal(message.offset,0);assert.equal(message.data.length,8192);s.romLoaded=true;
    }else if(message.method==='memory'){
      assert(message.data.length<=65536);assert(message.offset+message.data.length<=0x200000);s.memory.set(message.data,message.offset);s.adpcmMemoryBytes=Math.max(s.adpcmMemoryBytes,message.offset+message.data.length);
    }else if(message.method==='clock')s.clock=message.hz;
    else if(message.method==='reset'){if(!s.held.size)for(const row of s.registers)row.fill(0);}
    else if(message.method==='stop-voices')this.stopOpnaVoices();
    else assert(['mix','source-mute'].includes(message.method),'Unknown Native YM2608 operation '+message.method);
    s.revision++;
  }
  stopYm2203Voices(){if(!this.ym2203)return;const s=this.ym2203;s.keyMasks.fill(0);s.ssgGates.fill(false);s.registers[0].fill(0,8,11);s.held.clear();}
  applyYm2203(m){
    const s=this.ym2203,r=s.registers[0];
    if(m.method==='batch'){
      if(m.action==='off'&&s.held.get(m.channel)!==m.voice)return;
      if(m.action==='on')s.held.set(m.channel,m.voice);
      for(const op of m.commands)this.applyYm2203(op);
      if(m.action==='off')s.held.delete(m.channel);
    }else if(m.method==='write'){
      assert.equal(m.port??0,0);r[m.register]=m.value;
      if(m.register===0x28&&(m.value&3)<3)s.keyMasks[m.value&3]=m.value>>4&15;
      if(m.register>=8&&m.register<=10){const ch=m.register-8;s.ssgGates[ch]=!!(m.value&31);if(m.value&31)s.ssgLevels[ch]=m.value&31;}
      if(m.register>=0x2d&&m.register<=0x2f)s.prescaler=[6,3,2][m.register-0x2d];
    }else if(m.method==='set-retained-level')s.ssgLevels[m.channel]=m.level;
    else if(m.method==='clock')s.clock=m.hz;
    else if(m.method==='key-off'){if(m.channel<3)s.keyMasks[m.channel]=0;else{r[8+m.channel-3]=0;s.ssgGates[m.channel-3]=false;}}
    else if(m.method==='audition-key-on'){s.keyMasks[m.channel]=15;}
    else if(m.method==='reset'){this.stopYm2203Voices();r.fill(0);s.ssgLevels.fill(0);s.prescaler=6;}
    else if(m.method==='stop-voices')this.stopYm2203Voices();
    else if(m.method==='source-mute')s.sourceMuteMask=m.mask;
    else assert.equal(m.method,'mix','Unknown Native YM2203 operation '+m.method);
    s.revision++;
  }
  applyMasterSystem(m,states=this.masterSystem) {
    assert(['segapsg','ym2413'].includes(m.chip));const s=states[m.chip];
    if(m.method==='batch'){
      if(m.action==='off'&&s.held.get(m.channel)!==m.voice)return;
      if(m.action==='on')s.held.set(m.channel,m.voice);
      m.commands.forEach(op=>this.applyMasterSystem({...op,chip:m.chip},states));if(m.action==='off')s.held.delete(m.channel);
    }else if(m.method==='write'){
      if(m.chip==='ym2413')s.registers[m.register]=m.value;
      else{const b=m.value;if(b&128)s.latched=b>>4&7;else if(m.psgRegister!==undefined)s.latched=m.psgRegister;const ch=s.latched>>1;
        if(s.latched&1){s.attenuations[ch]=b&15;if((b&15)!==15)s.lastVolumes[ch]=b&15;}
        else if(ch===3)s.mode=b&7;
        else if(b&128)s.periods[ch]=(s.periods[ch]&1008)|(b&15);else s.periods[ch]=(s.periods[ch]&15)|((b&63)<<4);
      }
    }else if(m.method==='stereo'){assert.equal(this.current.mode,'game-gear');s.stereo=m.mask;}
    else if(m.method==='clock')s.clock=m.hz;
    else if(m.method==='key-off'){
      if(m.chip==='segapsg')s.attenuations[m.channel]=15;
      else if(m.channel<9)s.registers[0x20+m.channel]&=~16;
      else s.registers[0x0e]&=~[16,8,4,2,1][m.channel-9];
    }else if(m.method==='audition-key-on'){
      if(m.chip==='segapsg')s.attenuations[m.channel]=s.lastVolumes[m.channel];
      else if(m.channel<9)s.registers[0x20+m.channel]|=16;
      else s.registers[0x0e]|=[16,8,4,2,1][m.channel-9];
    }else if(m.method==='stop-voices')this.stopMasterSystemVoices(m.chip,states);
    else if(m.method==='reset'){
      this.stopMasterSystemVoices(m.chip,states);if(m.chip==='ym2413')s.registers.fill(0);else{s.periods.fill(0);s.attenuations.fill(15);s.lastVolumes.fill(0);s.latched=s.mode=0;if(s.stereoEnabled)s.stereo=255;}
    }else if(m.method==='source-mute')s.sourceMuteMask=m.mask;
    else assert.equal(m.method,'mix','Unknown Native Master System operation '+m.method);
  }
  stopMasterSystemVoices(chip,states=this.masterSystem){
    if(!states)return;for(const [name,s]of Object.entries(states)){if(chip&&name!==chip)continue;s.held.clear();if(name==='segapsg')s.attenuations.fill(15);else{for(let ch=0;ch<9;ch++)s.registers[0x20+ch]&=~16;s.registers[0x0e]&=~31;}}
  }
  applyMsx(m){
    assert(['ym2413','ay8910'].includes(m.chip));if(m.chip==='ym2413')return this.applyMasterSystem(m,{ym2413:this.msx.ym2413});const s=this.msx.ay8910;
    if(m.method==='batch'){
      if(m.action==='off'&&s.held.get(m.channel)!==m.voice)return;
      if(m.action==='on')s.held.set(m.channel,m.voice);
      m.commands.forEach(op=>this.applyMsx({...op,chip:m.chip}));if(m.action==='off')s.held.delete(m.channel);
    }else if(m.method==='write'){
      s.registers[m.register]=m.value;
      if(m.register>=8&&m.register<=10){const ch=m.register-8;s.gates[ch]=!!(m.value&31);if(m.value&31)s.levels[ch]=m.value&31;}
    }else if(m.method==='set-retained-level')s.levels[m.channel]=m.level;
    else if(m.method==='key-off'){s.registers[8+m.channel]=0;s.gates[m.channel]=false;}
    else if(m.method==='clock')s.clock=m.hz;
    else if(m.method==='stop-voices')this.stopMsxVoices('ay8910');
    else if(m.method==='reset'){this.stopMsxVoices('ay8910');s.registers.fill(0);s.levels.fill(9);}
    else if(m.method==='source-mute')s.sourceMuteMask=m.mask;
    else assert.equal(m.method,'mix','Unknown Native MSX AY operation '+m.method);
  }
  stopMsxVoices(chip){
    if(!this.msx)return;if(!chip||chip==='ym2413')this.stopMasterSystemVoices('ym2413',{ym2413:this.msx.ym2413});
    if(!chip||chip==='ay8910'){const s=this.msx.ay8910;s.held.clear();s.gates.fill(false);for(let ch=0;ch<3;ch++)s.registers[8+ch]=0;}
  }
  applyOpl(m){
    const s=this.opl;assert.equal(m.chip,s.chip);const r=s.registers,n=s.chip==='ymf262'?18:9,pairs=[0,1,2,9,10,11],physical=ch=>{const bit=pairs.indexOf(ch);return bit>=0&&(r[0x104]&(1<<bit))?[ch,ch+3]:[ch];};
    if(m.method==='batch'){
      if(m.action==='off'&&s.held.get(m.channel)!==m.voice)return;if(m.action==='on')s.held.set(m.channel,m.voice);
      m.commands.forEach(op=>this.applyOpl({...op,chip:m.chip}));if(m.action==='off')s.held.delete(m.channel);
    }else if(m.method==='write'){
      const reg=m.register+(m.bank??0)*256;r[reg]=m.value;
      if((reg&255)>=0xb0&&(reg&255)<=0xb8&&(m.value&32))for(const ch of physical((reg>=256?9:0)+(reg&255)-0xb0))s.sourceMuteMask&=~(1<<ch);
      if(reg===0xbd&&(m.value&31))s.sourceMuteMask&=~(7<<6);
    }else if(m.method==='key-off'){
      if(m.channel>=18){r[0xbd]&=~(16>>(m.channel-18));return;}
      for(const ch of physical(m.channel)){r[(ch>=9?256:0)+0xb0+ch%9]&=~32;s.sourceMuteMask|=1<<ch;}
    }else if(m.method==='rhythm-off')r[0xbd]&=~(16>>m.index);
    else if(m.method==='audition-key-on'){
      r[(m.channel>=9?256:0)+0xb0+m.channel%9]|=32;for(const ch of physical(m.channel))s.sourceMuteMask&=~(1<<ch);
    }else if(m.method==='clock')s.clock=m.hz;
    else if(m.method==='stop-voices')this.stopOplVoices();
    else if(m.method==='reset'){this.stopOplVoices();r.fill(0);s.status=0;s.irq=false;}
    else if(m.method==='source-mute')s.sourceMuteMask=m.mask;
    else assert.equal(m.method,'mix','Unknown Native OPL operation '+m.method);
  }
  stopOplVoices(){if(!this.opl)return;const s=this.opl,n=s.chip==='ymf262'?18:9;s.held.clear();for(let ch=0;ch<n;ch++)s.registers[(ch>=9?256:0)+0xb0+ch%9]&=~32;s.registers[0xbd]&=~31;s.sourceMuteMask=(1<<n)-1;}
  applyX68000(m) {
    assert(['ym2151','okim6258'].includes(m.chip));const x=this.x68000,s=x[m.chip];
    if(m.method==='batch'){
      if(m.action==='off'&&s.held.get(m.channel)!==m.voice)return;
      if(m.action==='on')s.held.set(m.channel,m.voice);
      m.commands.forEach(op=>this.applyX68000({...op,chip:m.chip}));if(m.action==='off')s.held.delete(m.channel);
    }else if(m.method==='write'){
      if(m.chip==='ym2151'){s.registers[m.register]=m.value;if(m.register===8)s.keyMasks[m.value&7]=(m.value>>3)&15;if(m.register===0x19)s[m.value&128?'pmDepth':'amDepth']=m.value&127;}
      else{if(m.register===12)s.divider=[1024,768,512,512][m.value&3];if(m.register===2)s.pan=m.value&3;if(m.register===0){s.streaming=false;s.playing=!!(m.value&2)&&!(m.value&1);}}
    }else if(m.method==='clock')s.clock=m.hz;
    else if(m.method==='memory-begin'){assert(m.byteLength>0&&m.byteLength<=0x1000000);assert(Array.isArray(m.metadata.waveform));x.staging={sampleId:m.sampleId,metadata:m.metadata,bytes:new Uint8Array(m.byteLength)};}
    else if(m.method==='memory-chunk'){assert.equal(m.sampleId,x.staging.sampleId);assert(m.data.length<=65536);x.staging.bytes.set(m.data,m.offset);}
    else if(m.method==='memory-commit'){assert.equal(m.sampleId,x.staging.sampleId);x.memory=x.staging.bytes;s.sampleId=m.sampleId;s.sample={...x.staging.metadata,bytes:x.memory.length,durationSeconds:x.staging.metadata.frames/x.staging.metadata.sampleRate};s.memoryRevision++;x.staging=null;s.playing=s.streaming=false;}
    else if(m.method==='play'){assert(s.sample,'OKI sample loaded before playback');s.playing=s.streaming=true;s.repeat=m.repeat;s.positionFrames=s.fedBytes=0;}
    else if(m.method==='set-repeat')s.repeat=m.repeat;
    else if(m.method==='key-off'){if(m.chip==='ym2151')s.keyMasks[m.channel]=0;else s.playing=s.streaming=false;}
    else if(m.method==='stop'||m.method==='stop-voices'){s.held.clear();if(m.chip==='ym2151')s.keyMasks.fill(0);else s.playing=s.streaming=false;}
    else if(m.method==='reset'){s.held.clear();if(m.chip==='ym2151'){s.registers.fill(0);s.keyMasks.fill(0);s.amDepth=s.pmDepth=0;}else{s.playing=s.streaming=false;s.divider=512;s.pan=0;}}
    else if(m.method==='source-mute')s.sourceMuteMask=m.mask;
    else assert.equal(m.method,'mix','Unknown Native X68000 operation');
  }
  stopX68000Voices(){const x=this.x68000;if(x){x.ym2151.held.clear();x.ym2151.keyMasks.fill(0);x.okim6258.held.clear();x.okim6258.playing=x.okim6258.streaming=false;x.staging=null;}}
  applyOpnb(message) {
    const s=this.opnb;
    if(message.method==='batch') {
      assert(Number.isInteger(message.channel)&&message.channel>=0&&message.channel<16);
      if(message.action==='off'&&s.held.get(message.channel)!==message.voice)return;
      if(message.action==='on')s.held.set(message.channel,message.voice);
      message.commands.forEach(op=>this.applyOpnb(op));
      if(message.action==='off')s.held.delete(message.channel);
    }else if(message.method==='write')s.registers[message.port][message.register]=message.value;
    else if(message.method==='memory') {
      assert([0,1].includes(message.kind));assert(message.data.length<=65536);assert(message.offset+message.data.length<=0x1000000);
      s.roms[message.kind].set(message.data,message.offset);s.loaded[message.kind]=Math.max(s.loaded[message.kind],message.offset+message.data.length);
    }else if(message.method==='clock')s.clock=message.hz;
    else if(message.method==='reset')s.registers.forEach(row=>row.fill(0));
    else if(message.method==='stop-voices')this.stopOpnbVoices();
    else if(message.method==='clear-memory')for(const kind of message.kind===undefined?[0,1]:[message.kind]){s.roms[kind].fill(0);s.loaded[kind]=0;}
    else assert(['mix','source-mute'].includes(message.method),'Unknown Native YM2610/B operation '+message.method);
    s.revision++;
  }
  stopOpnbVoices(){const s=this.opnb;if(!s)return;s.held.clear();for(let channel=0;channel<3;channel++)s.registers[0][8+channel]=0;s.registers[1][0]=0xbf;s.registers[0][0x10]=1;}
  stopOpnaVoices(){const s=this.opna;if(!s)return;s.held.clear();for(let channel=0;channel<3;channel++)s.registers[0][8+channel]=0;s.registers[0][0x10]=0xbf;s.registers[1][0]=1;}
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
    const option=new Option('Forged unknown machine','unknown-machine');option.dataset.forgedMode='true';select.append(option);
    select.value='unknown-machine';select.dispatchEvent(new Event('change',{bubbles:true}));
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
async function nativePrimaryLookupRuns(page,native,artifacts,name) {
  const program=`
    const [a,b,p,q]=await Promise.all([
      useSoundChip('ym2612'),useSoundChip('ym2612'),
      useSoundChip('segapsg'),useSoundChip('segapsg'),
    ]);
    if(a!==fm||b!==fm||p!==psg||q!==psg)throw Error('Primary chip identity changed');
    if(a.id!=='ym2612'||p.id!=='segapsg')throw Error('Primary mixer id missing');
    if(typeof a.dispose!=='undefined'||typeof p.dispose!=='undefined')throw Error('Borrowed primary exposes dispose');
    await mixer.set(p.id,{volume:0.6,pan:-0.25});
    p.setStereo(0xf0);
    p.tone(PSG1,{note:'C4',attenuation:7});
    a.setPreset(CH1,FM_PRESETS['one-op-basic']);
    a.noteOn(CH1,4,1000);
  `;
  const rows=[];
  for(const mode of ['genesis','mega-cd','genesis-full','genesis-full-nuked']) {
    if(await page.evaluate(()=>window.__nativeBackendTest.selectedMode.id)!==mode)await changeNativeMode(page,native,mode,'keep');
    let session;
    for(const execution of ['main','worker','worker','main']) {
      await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
      const first=native.calls.length;
      await page.evaluate(async({program,execution})=>{
        await window.__nativeBackendTest.runtime.playSource(program,{execution});
      },{program,execution});
      const commands=()=>native.calls.slice(first).filter(c=>c.command==='native_genesis_commands').flatMap(c=>c.args.commands);
      await until(()=>commands().some(c=>c.type==='psg-write'&&c.value===0x97)&&
        commands().some(c=>c.type==='write'&&c.register===0x28&&(c.value&0xf0))&&
        commands().some(c=>c.type==='psg-stereo'&&c.value===0xf0),mode+' '+execution+' borrowed FM/PSG writes');
      if(session===undefined)session=native.current.session;
      assert.equal(native.current.session,session,'Borrowed lookups and Stop/Run must reuse the Native session');
      const mixer=await page.evaluate(()=>window.__nativeBackendTest.runtime.megaDrive.mixer.list().filter(s=>s.connected).map(s=>s.id).sort());
      assert.deepEqual(mixer,['ym2612','segapsg',...(mode==='mega-cd'?['rf5c164']:mode.startsWith('genesis-full')?['rf5c164','pwm']:[])].sort(),'Borrowed lookups must not connect extra mixer sources');
      await assertNoLiveAudio(page);
      await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
      rows.push({mode,execution,session,commands:commands().length,mixer});
    }
  }
  await fs.writeFile(path.join(artifacts,name+'-native-primary-lookup.json'),JSON.stringify({passed:true,mockedNative:true,rows},null,2));
  await changeNativeMode(page,native,'genesis','keep');
  await page.evaluate(source=>window.__nativeBackendTest.editor.setValue(source),source);
  await nativeRun(page,native);
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
async function nativeRecording(page,native,artifacts,name) {
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
  const savingJson=page.waitForEvent('download');await panel.getByRole('button',{name:'Save JSON',exact:true}).click();
  const jsonDownload=await savingJson,report=JSON.parse(await fs.readFile(await jsonDownload.path(),'utf8'));
  assert.equal(report.format,'tetorica-audio-diagnostic-v1');assert.equal(report.backend,'native-genesis');assert.equal(report.audioContext,null);assert.equal(report.capture.frames,16);
  const diagnostics=report.nativeDiagnostics;
  for(const side of ['start','end']) {
    const status=diagnostics[side];assert.equal(status.available,true,side+' Native diagnostic status');
    const snapshot=status.snapshot;assert.equal(snapshot.session,native.current.session);assert.equal(snapshot.mode,native.current.mode);assert.equal(snapshot.sampleRate,48000);
    assert(Number.isSafeInteger(snapshot.frame)&&snapshot.frame>=0);
    for(const key of ['queued','lateCommands','queueOverflows'])assert.equal(snapshot[key],0,side+' '+key);
    for(const key of ['pendingCommands','acceptedCommands','acceptedRequests'])assert(Number.isSafeInteger(snapshot.transport[key])&&snapshot.transport[key]>=0,side+' '+key);
    assert.equal(snapshot.liveFx.underruns,0);assert.equal(snapshot.liveFx.overruns,0);
    if(['genesis','mega-cd','32x','genesis-full-nuked','genesis-nuked'].includes(native.current.mode))assert.equal(snapshot.engine,native.status().engine);
  }
  assert(Number.isSafeInteger(diagnostics.delta.frames)&&diagnostics.delta.frames>=0);
  for(const key of ['lateCommands','queueOverflows','liveFxUnderruns','liveFxOverruns'])assert.equal(diagnostics.delta[key],0,key+' recording delta');
  assert.match(report.limitations,/not audio-device dropout counts/);
  if(artifacts)await fs.writeFile(path.join(artifacts,name+'-'+native.current.mode+'-recording-diagnostics.json'),JSON.stringify({mockedNative:true,report},null,2));
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
  await nativeRecording(page,native,artifacts,name);
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
async function native32x(page,native,artifacts,name,{nuked=false}={}) {
  const mode=nuked?'genesis-full-nuked':'genesis-full',nativeMode=nuked?mode:'32x';
  await changeNativeMode(page,native,mode);
  const allCommands=()=>native.calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]);
  if(nuked){
    const starter=await fs.readFile(path.resolve(__dirname,'../docs/playground/defaults/genesis-full-nuked/index.js'),'utf8');
    for(const execution of ['main','worker']){
      const first=allCommands().length;
      await page.evaluate(({starter,execution})=>window.__nativeBackendTest.runtime.playSource(starter,{execution}),{starter,execution});
      await until(()=>allCommands().slice(first).some(c=>c.type==='write'&&c.register===0x28&&(c.value&0xf0))&&allCommands().slice(first).some(c=>c.type==='psg-write'),execution+' shipped 32X Nuked starter');
      assert.equal(native.current.mode,'genesis-full-nuked');assert.equal(native.status().engine,'nuked');await assertNoLiveAudio(page);
      await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    }
  }
  const phrase=`
    if(await useSoundChip('pwm')!==pwm)throw Error('32X PWM must borrow the built-in Native endpoint');
    fm.setPreset(CH1,FM_PRESETS['one-op-basic']);
    psg.tone(PSG1,{note:'C4',attenuation:8});
    const pcm=await useSoundChip('rf5c164');await pcm.loadMemory(new Uint8Array([0x81,0x91,0xa1,0xff]));
    await pcm.setChannel(0,{start:0,loopStart:0,volume:80,pan:{left:15,right:15},pitch:2048});await pcm.keyOn(0);
    await pwm.writeRegister(0,5);await pwm.writeRegister(1,767);
    await pwm.setClock(23011361);
    const base=await pwm.scheduleWrites([{frame:96000,register:4,value:384},{frame:0,register:4,value:256}]);
    if(!Number.isSafeInteger(base)||base<0)throw Error('Native schedule did not return its absolute base frame');
    const state=await pwm.getState();if(state.model!=='mame'||state.outputMode!=='duty'||state.queuedWrites<1||state.queuedWrites>2)throw Error('Native PWM state missing reservation');
    if(await pwm.read(1)!==767)throw Error('Native PWM register read mismatch');
    await pwm.clearSchedule();
    if((await pwm.getState()).queuedWrites!==0)throw Error('Native clearSchedule failed');
    await mixer.set(pwm.id,{volume:.7,pan:.25});
    liveLoop('native-32x',async()=>{
      await pwm.writeRegister(4,384);
      await play('E3',{channel:CH1,duration:.1});await beat(.1);
    });
  `;
  for(const execution of ['main','worker']){
    const first=allCommands().length,calls=native.calls.length;
    await page.evaluate(({phrase,execution})=>window.__nativeBackendTest.runtime.playSource(phrase,{execution}),{phrase,execution});
    const commands=()=>allCommands().slice(first),pwmCommands=()=>commands().filter(command=>command.type==='pwm');
    await until(()=>pwmCommands().some(command=>command.message.method==='mix')&&
      commands().some(command=>command.type==='write'&&command.register===0x28&&(command.value&0xf0))&&
      commands().some(command=>command.type==='psg-write')&&commands().some(command=>command.type==='rf5c164-key-on'),`${execution} shared Native FM/PSG/RF/PWM playback`);
    assert.equal(native.current.mode,nativeMode);
    assert(pwmCommands().some(command=>command.message.method==='schedule-writes'&&command.message.entries.length===2));
    assert(native.calls.slice(calls).some(call=>call.command==='native_genesis_pwm_status'&&Number.isSafeInteger(call.args.after)),'PWM state/read must await their applied command barrier');
    if(execution==='worker')assert(pwmCommands().some(command=>command.message.method==='write'&&command.performance&&command.owner&&command.frame>0),'Worker PWM must preserve loop ownership and frame timing');
    const state=await page.evaluate(async()=>{
      const synth=window.__nativeBackendTest.runtime.megaDrive;
      return {backend:synth.backend,mode:synth.mode,engine:synth.engine,pwm:synth.capabilities.pwm,pcm:synth.capabilities.pcm,
        endpoints:synth.primaryEndpoints.map(endpoint=>endpoint.name),chips:await synth.chipInspector.list(),state:await synth.chipInspector.read('pwm')};
    });
    assert.equal(state.backend,'native-genesis');assert.equal(state.mode,nativeMode);assert.equal(state.pwm,true);assert.equal(state.pcm,true);
    assert.equal(state.engine,nuked?'nuked':'ymfm');
    assert.deepEqual(state.endpoints,['pwm']);assert.deepEqual(state.chips.map(chip=>chip.id).sort(),['pwm','rf5c164','segapsg','ym2612']);
    assert.equal(state.state.kind,'pwm');assert.equal(state.state.cycle,767);assert.equal(state.state.queuedWrites,0);
    await assertNoLiveAudio(page);
    if(execution==='main'){
      // Cancelling a loop releases its PWM reservation, but an older loop
      // cannot silence a later script which has taken over the endpoint.
      await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource(`
        liveLoop('pwm-old-owner',async()=>{await pwm.write(4,123);await sleep(60);});
      `,{execution:'main'}));
      await until(()=>allCommands().some(command=>command.type==='pwm'&&command.message.method==='write'&&command.message.value===123),'Main PWM old owner');
      const replacement=allCommands().length;
      await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource(`
        liveLoop('pwm-old-owner',async()=>{await sleep(60);});
        await pwm.write(4,456);stopLoop('pwm-old-owner');
      `,{execution:'main'}));
      await page.evaluate(()=>window.__nativeBackendTest.runtime.megaDrive.flush());
      const replaced=allCommands().slice(replacement),taken=replaced.findIndex(command=>command.type==='pwm'&&command.message.method==='write'&&command.message.value===456);
      assert(taken>=0,'New Main script must take over PWM');
      assert(!replaced.slice(taken+1).some(command=>command.type==='pwm'&&command.message.method==='stop-voices'),'Cancelling an old Main loop cannot stop a newer PWM owner');
      await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource(`
        liveLoop('pwm-reservation-owner',async()=>{
          await pwm.scheduleWrites([{frame:96000,register:4,value:789}]);await sleep(60);
        });
      `,{execution:'main'}));
      await until(()=>native.pwmQueue.some(write=>write.value===789),'Main loop PWM reservation');
      const release=allCommands().length;
      await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource(`stopLoop('pwm-reservation-owner');`,{execution:'main'}));
      await until(()=>allCommands().slice(release).some(command=>command.type==='pwm'&&command.message.method==='stop-voices'),'Main loop removal must release PWM');
      assert.equal(native.pwmQueue.length,0,'Removing the owning loop must cancel future FIFO writes');
    }
    const session=native.current.session;
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    assert.equal(native.current.session,session,'Stop/Run must preserve the 32X device');assert.equal(native.pwm.read(0),0);assert.equal(native.pwmQueue.length,0);
    // Stop preserves the endpoint. A subsequent script can reserve a fresh
    // finite PWM phrase without constructing another native output stream.
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`
      await pwm.write(0,5);await pwm.write(1,511);
      await pwm.scheduleWrites([{frame:96000,register:4,value:255}]);
      await pwm.reset();if(await pwm.read(0)!==0||(await pwm.getState()).queuedWrites!==0)throw Error('PWM reset did not clear FIFO and reservations');
    `,{execution}),execution);
    assert.equal(native.current.session,session);await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  }
  await keyboard(page,native);
  const inspected=await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.invoke('pwm','writeRegister',[1,1023]));
  assert.equal(inspected.cycle,1023,'Operators PWM edits must reach Native');
  await assertNoLiveAudio(page);
  await page.screenshot({path:path.join(artifacts,name+(nuked?'-native-32x-nuked.png':'-native-32x.png'))});
  await changeNativeMode(page,native,'genesis','keep');
  await page.evaluate(source=>window.__nativeBackendTest.editor.setValue(source),source);await nativeRun(page,native);
}
async function nativeNuked(page,native,artifacts,name){
  await native32x(page,native,artifacts,name,{nuked:true});
  const starter=await fs.readFile(path.resolve(__dirname,'../docs/playground/defaults/genesis-nuked/index.js'),'utf8');
  await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
  const legacy=new URL(page.url());legacy.searchParams.set('mode','genesis-nuked');legacy.searchParams.set('audioEngine','native');legacy.searchParams.set('src',Buffer.from(starter).toString('base64url'));legacy.searchParams.delete('modeProject');
  await page.goto(legacy.href);await ready(page);
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.selectedMode.id),'genesis-nuked');
  assert.deepEqual(await modeIds(page),[...nativeModeIds,'genesis-nuked']);
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]);
  for(const execution of ['main','worker']){
    const first=all().length;
    await page.evaluate(({starter,execution})=>window.__nativeBackendTest.runtime.playSource(starter,{execution}),{starter,execution});
    await until(()=>all().slice(first).some(c=>c.type==='write'&&c.register===0x28&&(c.value&0xf0)),execution+' hidden legacy Nuked starter');
    assert.equal(native.current.mode,'genesis-nuked');assert.equal(native.status().engine,'nuked');
    assert.deepEqual(await page.evaluate(()=>{const s=window.__nativeBackendTest.runtime.megaDrive;return {engine:s.engine,pcm:s.pcm,pwm:s.pwm,chips:s.chipInspector.list().map(c=>c.id)};}),{engine:'nuked',pcm:null,pwm:null,chips:['ym2612','segapsg']});
    assert(!all().slice(first).some(c=>c.type.startsWith('rf5c164')||c.type==='pwm'),'Legacy Nuked has no hidden PCM/PWM');
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());await assertNoLiveAudio(page);
  }
  await keyboard(page,native);await page.screenshot({path:path.join(artifacts,name+'-native-genesis-nuked.png')});
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  await changeNativeMode(page,native,'genesis','keep');await page.evaluate(source=>window.__nativeBackendTest.editor.setValue(source),source);await nativeRun(page,native);
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
async function nativeYm2203(page,native,artifacts,name) {
  await changeNativeMode(page,native,'pc98-26');
  const starter=await fs.readFile(path.resolve(__dirname,'../docs/playground/defaults/pc98-26/index.js'),'utf8');
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.editor.getValue()),starter);
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]);
  const flatten=messages=>messages.flatMap(m=>m.method==='batch'?flatten(m.commands):[m]);
  const read=()=>page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('ym2203'));
  for(const execution of ['main','worker']) {
    let first=all().length;const commands=()=>all().slice(first),writes=()=>flatten(commands().filter(c=>c.type==='ym2203').map(c=>c.message));
    await page.evaluate(({starter,execution})=>window.__nativeBackendTest.runtime.playSource(starter,{execution}),{starter,execution});
    await until(()=>writes().some(m=>m.method==='write'&&m.register===0x28&&(m.value&240))&&writes().some(m=>m.method==='write'&&m.register===8&&m.value===8),execution+' YM2203 starter FM/SSG');
    const info=await page.evaluate(()=>{const s=window.__nativeBackendTest.runtime.megaDrive;return {chip:s.chip,mode:s.mode,id:s.fm.id,channels:s.capabilities.fmChannels,sections:[!!s.fm.ssg,!!s.fm.rhythm,!!s.fm.adpcm],psg:s.psg,pcm:s.pcm,mixer:s.mixer.list().filter(c=>c.connected).map(c=>c.id),inspector:s.chipInspector.list().map(c=>c.id)};});
    assert.deepEqual(info,{chip:'ym2203',mode:'pc98-26',id:'ym2203',channels:3,sections:[true,false,false],psg:null,pcm:null,mixer:['ym2203'],inspector:['ym2203']});
    assert.equal((await read()).keyboardChannels.length,6);
    assert(commands().every(c=>['ym2203','mix','noise','fx'].includes(c.type)),'YM2203 must not send hidden Genesis/OPNA commands');
    assert(writes().filter(m=>m.method==='write').every(m=>(m.port??0)===0));
    if(execution==='worker')assert(commands().some(c=>c.type==='ym2203'&&c.frame>0&&c.performance&&c.owner),'Worker FM/SSG retain frame and owner');
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());first=all().length;
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`
      if(await useSoundChip('ym2203')!==fm||fm.ssg!==ssg)throw Error('YM2203 primary/SSG was not reused');
      await fm.setClock(3600000);
      fm.setPreset(CH3,FM_PRESETS['one-op-basic']);fm.setAlgo(CH3,7,3);
      fm.setChannel3SpecialMode(true);for(let op=0;op<4;op++)fm.setChannel3SpecialFrequency(op,3+op%2,700+op*80);fm.keyOn(CH3);
      ssg.tone(0,{frequency:440,volume:7});ssg.noise(1,{period:21,volume:5});ssg.tone(2,{frequency:220,volume:9,envelope:true});ssg.setEnvelope({period:1234,shape:10});
      fm.write(0,14,0xab);fm.write(0,15,0xcd);
      await mixer.set(fm.id,{volume:.65,pan:-.2});
    `,{execution}),execution);
    // Mixer RPC and the ordered chip port have independent delivery. Wait for
    // the final register write before inspecting the chip's applied state.
    await until(()=>writes().some(m=>m.method==='mix')&&native.ym2203.clock===3600000&&writes().some(m=>m.method==='write'&&m.register===15&&m.value===0xcd),execution+' YM2203 custom voices and mixer');
    const edited=await read(),r=edited.registers[0];
    assert.equal(edited.clock,3600000);assert.equal(edited.fmState.channels.length,3);assert.equal(edited.fmState.channels[2].algorithm,7);assert.equal(r[0x27]&64,64,execution+' CH3 mode; writes='+JSON.stringify(writes().filter(m=>m.method==='write'&&m.register===0x27)));
    assert.equal(r[6],21);assert.equal(r[11]|r[12]<<8,1234);assert.equal(r[13],10);assert.equal(r[14],0xab);assert.equal(r[15],0xcd);assert.deepEqual(edited.ssgLevels,[7,5,16]);
    assert.equal(writes().filter(m=>m.method==='clock').length,1,'Worker clock observations must not echo commands');
    assert.doesNotMatch(await page.locator('#consoleOutput').textContent(),/Observer:/);
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    const stopped=await read();assert.equal(stopped.clock,3600000);assert.equal(stopped.registers[0][0x27]&64,64);assert.equal(stopped.registers[0][11]|stopped.registers[0][12]<<8,1234);assert.deepEqual(stopped.ssgLevels,[7,5,16]);assert(stopped.keyMasks.every(v=>v===0));assert(stopped.ssgGates.every(v=>!v));
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`ssg.setVolume(0,0);ssg.keyOff(0);ssg.keyOn(0);fm.write(0,9,0);fm.ssg.keyOn(1);`,{execution}),execution);
    await until(()=>writes().some(m=>m.method==='set-retained-level'&&m.channel===0&&m.level===0)&&writes().some(m=>m.method==='set-retained-level'&&m.channel===1&&m.level===0),execution+' explicit SSG zero metadata');
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());assert.deepEqual((await read()).ssgLevels,[0,0,16]);
    await page.evaluate(async()=>{const s=window.__nativeBackendTest.runtime.megaDrive;await s.fm.setClock(4000000);s.fm.setChannel3SpecialMode(false);await s.flush();});
    await assertNoLiveAudio(page);
  }
  await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:ym2203');
  assert.deepEqual(await page.locator('#playgroundKeyboardTargetChannel option').evaluateAll(nodes=>nodes.map(n=>n.value)),['fm:0','fm:1','fm:2','ssg:0','ssg:1','ssg:2','fm:all']);
  for(const [voice,channel]of [['fm:0',0],['fm:1',1],['fm:2',2],['ssg:0',3],['ssg:1',4],['ssg:2',5]]) {
    await page.selectOption('#playgroundKeyboardTargetChannel',voice);await page.locator('#keyboardTab').focus();const first=all().length,added=()=>all().slice(first).filter(c=>c.type==='ym2203');
    await page.keyboard.down('z');await until(()=>added().some(c=>c.message.method==='batch'&&c.message.action==='on'&&c.message.channel===channel),'YM2203 Keyboard '+voice);
    await page.keyboard.up('z');await until(()=>added().some(c=>c.message.method==='batch'&&c.message.action==='off'),'YM2203 Keyboard release '+voice);
  }
  await page.selectOption('#playgroundKeyboardTargetChannel','fm:all');await page.locator('#keyboardTab').focus();
  let roundRobinFirst=all().length;for(const key of ['z','x','c'])await page.keyboard.down(key);
  await until(()=>new Set(all().slice(roundRobinFirst).filter(c=>c.type==='ym2203'&&c.message.action==='on').map(c=>c.message.channel)).size===3,'YM2203 round-robin three voices');
  for(const key of ['z','x','c'])await page.keyboard.up(key);
  await page.selectOption('#playgroundKeyboardTargetChannel','ssg:1');const key=page.locator('#operatorKeyboardRoot .key').first();await key.scrollIntoViewIfNeeded();const rect=await key.boundingBox();let first=all().length;
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await until(()=>all().slice(first).some(c=>c.type==='ym2203'&&c.message.action==='on'&&c.message.channel===4),'YM2203 SSG Guitar');
  await page.mouse.up();await until(()=>all().slice(first).some(c=>c.type==='ym2203'&&c.message.action==='off'),'YM2203 Guitar release');
  await page.click('#operatorTabButton');await page.selectOption('#operatorTabChannelSelect','0');
  assert.equal(await page.locator('#operatorTabChannelSelect option').count(),3);
  assert.equal(await page.locator('#operatorTabPanLeft').isDisabled(),true);assert.equal(await page.locator('#operatorTabPanRight').isDisabled(),true);
  await page.locator('#operatorTabButton').focus();first=all().length;
  await page.keyboard.down('z');await until(()=>all().slice(first).some(c=>c.type==='ym2203'&&c.message.action==='on'),'YM2203 Operators Keyboard');
  await page.keyboard.up('z');await until(()=>all().slice(first).some(c=>c.type==='ym2203'&&c.message.action==='off'),'YM2203 Operators release');
  await page.screenshot({path:path.join(artifacts,name+'-native-ym2203.png')});await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  await changeNativeMode(page,native,'genesis','keep');await page.evaluate(source=>window.__nativeBackendTest.editor.setValue(source),source);await nativeRun(page,native);
}
async function nativePc98(page,native,artifacts,name) {
  await changeNativeMode(page,native,'pc98');
  const starter=await fs.readFile(path.resolve(__dirname,'../docs/playground/defaults/pc98/index.js'),'utf8');
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.editor.getValue()),starter,'PC-98 selection installs its shipped starter');
  const allCommands=()=>native.calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]);
  const flatten=messages=>messages.flatMap(message=>message.method==='batch'?flatten(message.commands):[message]);
  for(const execution of ['main','worker']) {
    let first=allCommands().length;
    const commands=()=>allCommands().slice(first).filter(command=>command.type==='ym2608');
    const writes=()=>flatten(commands().map(command=>command.message));
    await page.evaluate(({starter,execution})=>window.__nativeBackendTest.runtime.playSource(starter,{execution}),{starter,execution});
    await until(()=>writes().some(message=>message.method==='write'&&message.port===0&&message.register===0x28&&(message.value&0xf0)),execution+' PC-98 FM starter');
    await until(()=>writes().some(message=>message.method==='write'&&message.port===0&&message.register===0x10&&!(message.value&128)),execution+' PC-98 rhythm starter');
    const state=await page.evaluate(async()=>{
      const synth=window.__nativeBackendTest.runtime.megaDrive;
      return {backend:synth.backend,chip:synth.chip,fmId:synth.fm.id,sections:['ssg','rhythm','adpcm'].map(name=>!!synth.fm[name]),
        psg:synth.psg,pcm:synth.pcm,dx7:synth.dx7,nes:synth.nes,mixer:synth.mixer.list(),inspected:synth.chipInspector.list(),
        snapshot:await synth.chipInspector.read('ym2608')};
    });
    assert.equal(state.backend,'native-genesis');assert.equal(state.chip,'ym2608');assert.equal(state.fmId,'ym2608');assert.deepEqual(state.sections,[true,true,true]);
    for(const key of ['psg','pcm','dx7','nes'])assert.equal(state[key],null,'PC-98 must not construct a hidden '+key);
    assert.deepEqual(state.mixer.filter(entry=>entry.connected).map(entry=>entry.id),['ym2608']);assert.deepEqual(state.inspected.map(entry=>entry.id),['ym2608']);
    assert.equal(state.snapshot.romLoaded,true);assert.equal(state.snapshot.registers[0][0x29],0x9f);
    if(execution==='worker')assert(commands().some(command=>command.frame>0&&command.performance&&command.owner),'Worker PC-98 notes retain timing and ownership');
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    const session=native.current.session;first=allCommands().length;
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`
      const shared=await useSoundChip('ym2608');
      if(shared!==fm||!shared.ssg||!shared.rhythm||!shared.adpcm)throw Error('Native YM2608 sections were not reused');
      await fm.setClock(7000000);
      fm.setPreset(CH6,FM_PRESETS['one-op-basic']);fm.setAlgo(CH6,7,3);
      ssg.tone(1,{frequency:440,volume:11});ssg.setEnvelope({period:192,shape:9});
      rhythm.setVolume(49);rhythm.setVoice('snare',{volume:23,left:true,right:false});rhythm.keyOn('snare');
      const loaded=await shared.adpcm.loadSample({sampleRate:16000,channels:[Float32Array.from({length:130},(_,i)=>Math.sin(i/8)*.4)]},{address:64});
      if(loaded.start!==64||loaded.end<=64)throw Error('ADPCM-B sample preparation failed');
      adpcm.setVolume(190);adpcm.setPan(true,false);adpcm.keyOn({repeat:true});
      await mixer.set(fm.id,{volume:0.65,pan:0.2});
      liveLoop('native-pc98-sixth',async()=>{await play('E4',{channel:CH6,beats:.04});await beat(.04);});
    `,{execution}),execution);
    await until(()=>writes().some(message=>message.method==='memory')&&writes().some(message=>message.method==='write'&&message.port===1&&message.register===0&&(message.value&128)),execution+' PC-98 ADPCM-B');
    const applied=await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('ym2608'));
    assert.equal(applied.clock,7000000);assert(applied.adpcmMemoryBytes>64);assert.equal(applied.fmState.channels[5].algorithm,7);assert.equal(applied.registers[0][9],11);
    assert.equal(applied.registers[0][0x19],0x80|23);assert.equal(applied.registers[1][11],190);assert.equal(applied.registers[1][1]&0xc0,128);
    assert.equal(writes().filter(message=>message.method==='clock').length,1,'observing a Worker clock acknowledgement must not send it back to Native');
    assert.doesNotMatch(await page.locator('#consoleOutput').textContent(),/Observer:.*(?:_adoptClock|setClock)/);
    assert(writes().some(message=>message.method==='mix'),'PC-98 mixer reaches its Native chip');
    if(execution==='worker')assert(commands().some(command=>command.message.method==='memory'&&command.frame===0&&command.performance&&command.owner),'Worker ADPCM preparation retains ownership without future scheduling');
    const memory=Array.from(native.opna.memory.slice(64,applied.adpcmMemoryBytes));
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());const stopped=await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('ym2608'));
    assert.equal(native.current.session,session);assert.equal(stopped.clock,7000000);assert.equal(stopped.romLoaded,true);assert.equal(stopped.fmState.channels[5].algorithm,7);assert.equal(stopped.registers[1][0],1);
    assert.deepEqual(Array.from(native.opna.memory.slice(64,applied.adpcmMemoryBytes)),memory,'Stop preserves uploaded ADPCM-B memory');assert.deepEqual(stopped.held,[]);
    await assertNoLiveAudio(page);
  }
  await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:ym2608');
  const channels=[...Array.from({length:6},(_,ch)=>[`fm:${ch}`,ch]),...Array.from({length:3},(_,ch)=>[`ssg:${ch}`,ch+6]),...Array.from({length:6},(_,ch)=>[`rhythm:${ch}`,ch+9]),['adpcm-b:0',15]];
  for(const [target,channel]of channels){
    await page.selectOption('#playgroundKeyboardTargetChannel',target);await page.locator('#keyboardTab').focus();const first=allCommands().length;
    const added=()=>allCommands().slice(first).filter(command=>command.type==='ym2608');
    await page.keyboard.down('z');await until(()=>added().some(command=>command.message.method==='batch'&&command.message.channel===channel&&command.message.action==='on'),'PC-98 Keyboard '+target);
    await page.keyboard.up('z');await until(()=>added().some(command=>command.message.method==='batch'&&command.message.channel===channel&&command.message.action==='off'),'PC-98 Keyboard release '+target);
  }
  await page.selectOption('#playgroundKeyboardTargetChannel','fm:0');const first=allCommands().length;
  const key=page.locator('#operatorKeyboardRoot .key').first();await key.scrollIntoViewIfNeeded();const rect=await key.boundingBox();
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await until(()=>allCommands().slice(first).some(command=>command.type==='ym2608'&&command.message.action==='on'),'PC-98 Guitar pointer');
  await page.mouse.up();await until(()=>allCommands().slice(first).some(command=>command.type==='ym2608'&&command.message.action==='off'),'PC-98 Guitar pointer release');
  await page.click('#operatorTabButton');await page.locator('#operatorTabButton').focus();const operatorFirst=allCommands().length;
  await page.keyboard.down('z');await until(()=>allCommands().slice(operatorFirst).some(command=>command.type==='ym2608'&&command.message.action==='on'),'PC-98 Operators Keyboard');
  await page.keyboard.up('z');await until(()=>allCommands().slice(operatorFirst).some(command=>command.type==='ym2608'&&command.message.action==='off'),'PC-98 Operators Keyboard release');
  await page.screenshot({path:path.join(artifacts,name+'-native-pc98.png')});await assertNoLiveAudio(page);
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  await changeNativeMode(page,native,'genesis','keep');await page.evaluate(source=>window.__nativeBackendTest.editor.setValue(source),source);await nativeRun(page,native);
}
async function nativeNeoGeo(page,native,artifacts,name) {
  const allCommands=()=>native.calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]);
  const flatten=messages=>messages.flatMap(message=>message.method==='batch'?flatten(message.commands):[message]);
  for(const mode of ['neogeo','neogeo-b']) {
    await changeNativeMode(page,native,mode);
    const variant=mode==='neogeo-b',chip=variant?'ym2610b':'ym2610',count=variant?6:4;
    const starter=await fs.readFile(path.resolve(__dirname,'../docs/playground/defaults/'+mode+'/index.js'),'utf8');
    assert.equal(await page.evaluate(()=>window.__nativeBackendTest.editor.getValue()),starter);
    for(const execution of ['main','worker']) {
      let first=allCommands().length;
      const commands=()=>allCommands().slice(first).filter(command=>command.type==='ym2610b');
      const writes=()=>flatten(commands().map(command=>command.message));
      await page.evaluate(({starter,execution})=>window.__nativeBackendTest.runtime.playSource(starter,{execution}),{starter,execution});
      await until(()=>writes().some(m=>m.method==='write'&&m.port===0&&m.register===0x28&&(m.value&0xf0)),mode+' '+execution+' FM starter');
      const state=await page.evaluate(async chip=>{const s=window.__nativeBackendTest.runtime.megaDrive;return {chip:s.chip,fmId:s.fm.id,channels:s.capabilities.fmChannels,mixer:s.mixer.list().filter(c=>c.connected).map(c=>c.id),inspector:s.chipInspector.list(),psg:s.psg,pcm:s.pcm,snapshot:await s.chipInspector.read(chip)};},chip);
      assert.equal(state.chip,chip);assert.equal(state.fmId,chip);assert.equal(state.channels,count);assert.deepEqual(state.mixer,[chip]);assert.deepEqual(state.inspector.map(c=>c.id),[chip]);assert.equal(state.psg,null);assert.equal(state.pcm,null);
      assert.equal(state.snapshot.keyboardChannels.length,count+10);
      if(execution==='worker')assert(commands().some(c=>c.frame>0&&c.performance&&c.owner),'Worker timing and ownership');
      await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());first=allCommands().length;
      await page.evaluate(({execution,variant})=>window.__nativeBackendTest.runtime.playSource(`
        const shared=await useSoundChip('${variant?'ym2610b':'ym2610'}');
        if(shared!==fm||!shared.ssg||!shared.adpcmA||!shared.adpcmB)throw Error('Native OPNB sections were not reused');
        await fm.setClock(7000000);
        fm.setPreset(${variant?'CH6':'CH4'},FM_PRESETS['one-op-basic']);fm.setAlgo(${variant?'CH6':'CH4'},7,3);
        ssg.tone(1,{frequency:440,volume:11});ssg.setEnvelope({period:192,shape:9});
        await adpcmA.loadMemory(new Uint8Array(256).fill(0x17),256);
        adpcmA.setVolume(50);adpcmA.setSample(5,{start:256,end:512});adpcmA.setVoice(5,{volume:25,left:true,right:false});adpcmA.keyOn(5);
        const sample=await createSampleInstrument({sampleRate:16000,channels:[Float32Array.from({length:512},(_,i)=>Math.sin(i/8)*.4)]});
        await sample.noteOn({id:'browser-sample',midi:60,velocity:100});
        await mixer.set(fm.id,{volume:.65,pan:.2});
        liveLoop('native-neogeo-last',async()=>{await play('E4',{channel:${variant?'CH6':'CH4'},beats:.04});await beat(.04);});
      `,{execution}),{execution,variant});
      await until(()=>writes().some(m=>m.method==='memory'&&m.kind===0)&&writes().some(m=>m.method==='memory'&&m.kind===1)&&writes().some(m=>m.method==='write'&&m.port===0&&m.register===0x10&&(m.value&128)),mode+' '+execution+' ADPCM-A/B and sampler');
      const applied=await page.evaluate(chip=>window.__nativeBackendTest.runtime.chipInspector.read(chip),chip);
      assert.equal(applied.clock,7000000);assert(applied.adpcmARomBytes>=512);assert(applied.adpcmBRomBytes>=256);assert.equal(applied.fmState.channels[5].algorithm,7);assert.equal(applied.registers[0][9],11);assert.equal(applied.registers[1][13],0x80|25);
      assert.equal(writes().filter(m=>m.method==='clock').length,1,'clock observer must not echo to Native');
      assert.doesNotMatch(await page.locator('#consoleOutput').textContent(),/Observer:.*(?:_adoptClock|setClock)/);
      assert(writes().some(m=>m.method==='mix'));
      if(execution==='worker')assert(commands().filter(c=>c.message.method==='memory').every(c=>c.frame===0&&c.performance&&c.owner),'sample preparation retains ownership without future scheduling');
      const a=Array.from(native.opnb.roms[0].slice(0,512)),b=Array.from(native.opnb.roms[1].slice(0,512));
      await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
      const stopped=await page.evaluate(chip=>window.__nativeBackendTest.runtime.chipInspector.read(chip),chip);
      assert.equal(stopped.clock,7000000);assert.equal(stopped.fmState.channels[5].algorithm,7);assert.equal(stopped.registers[0][0x10],1);assert.deepEqual(stopped.held,[]);
      assert.deepEqual(Array.from(native.opnb.roms[0].slice(0,512)),a);assert.deepEqual(Array.from(native.opnb.roms[1].slice(0,512)),b);await assertNoLiveAudio(page);
    }
    await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:'+chip);
    const channels=[...Array.from({length:count},(_,ch)=>[`fm:${ch}`,variant?ch:[1,2,4,5][ch]]),...Array.from({length:3},(_,ch)=>[`ssg:${ch}`,ch+6]),...Array.from({length:6},(_,ch)=>[`adpcm-a:${ch}`,ch+9]),['adpcm-b:0',15]];
    for(const [target,channel]of channels){
      await page.selectOption('#playgroundKeyboardTargetChannel',target);await page.locator('#keyboardTab').focus();const first=allCommands().length;
      const added=()=>allCommands().slice(first).filter(c=>c.type==='ym2610b');
      await page.keyboard.down('z');await until(()=>added().some(c=>c.message.action==='on'&&c.message.channel===channel),mode+' Keyboard '+target);
      await page.keyboard.up('z');await until(()=>added().some(c=>c.message.action==='off'&&c.message.channel===channel),mode+' Keyboard release '+target);
    }
    await page.selectOption('#playgroundKeyboardTargetChannel','fm:0');let first=allCommands().length;
    const key=page.locator('#operatorKeyboardRoot .key').first();await key.scrollIntoViewIfNeeded();const rect=await key.boundingBox();
    await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await until(()=>allCommands().slice(first).some(c=>c.type==='ym2610b'&&c.message.action==='on'),mode+' Guitar pointer');
    await page.mouse.up();await until(()=>allCommands().slice(first).some(c=>c.type==='ym2610b'&&c.message.action==='off'),mode+' Guitar release');
    await page.click('#operatorTabButton');await page.locator('#operatorTabButton').focus();first=allCommands().length;
    await page.keyboard.down('z');await until(()=>allCommands().slice(first).some(c=>c.type==='ym2610b'&&c.message.action==='on'),mode+' Operators Keyboard');
    await page.keyboard.up('z');await until(()=>allCommands().slice(first).some(c=>c.type==='ym2610b'&&c.message.action==='off'),mode+' Operators Keyboard release');
    await page.screenshot({path:path.join(artifacts,name+'-native-'+mode+'.png')});await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  }
  await changeNativeMode(page,native,'genesis','keep');await page.evaluate(source=>window.__nativeBackendTest.editor.setValue(source),source);await nativeRun(page,native);
}
async function nativeOpl(page,native,artifacts,name) {
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]),flatten=ms=>ms.flatMap(m=>m.method==='batch'?flatten(m.commands).map(op=>({...op,chip:m.chip})):[m]);
  for(const chip of ['ym3526','ym3812','ymf262']){
    const stereo=chip==='ymf262',count=stereo?18:9,baseClock=stereo?14318180:3579545,editedClock=stereo?14000000:4000000,last=count-1,bank=stereo?256:0,wave=stereo?7:chip==='ym3812'?3:0;
    await changeNativeMode(page,native,chip);
    const starter=await fs.readFile(path.resolve(__dirname,'../docs/playground/defaults/'+chip+'/index.js'),'utf8');assert.equal(await page.evaluate(()=>window.__nativeBackendTest.editor.getValue()),starter);
    for(const execution of ['main','worker']){
      let first=all().length;const commands=()=>all().slice(first).filter(c=>c.type==='opl'),writes=()=>flatten(commands().map(c=>c.message));
      await page.evaluate(({starter,execution})=>window.__nativeBackendTest.runtime.playSource(starter,{execution}),{starter,execution});
      await until(()=>writes().some(m=>m.method==='write'&&m.register===0xb0&&(m.value&32)),chip+' '+execution+' starter');
      const info=await page.evaluate(async()=>{const s=window.__nativeBackendTest.runtime.megaDrive;return {chip:s.chip,fm:s.fm,psg:s.psg,mixer:s.mixer.list().filter(c=>c.connected).map(c=>c.id),inspected:s.chipInspector.list().map(c=>c.id),voice:await s.chipInspector.read(s.chip)};});
      assert.equal(info.chip,chip);assert.equal(info.fm,null);assert.equal(info.psg,null);assert.deepEqual(info.mixer,[chip]);assert.deepEqual(info.inspected,[chip]);assert.equal(info.voice.clock,baseClock);assert.equal(info.voice.channels.length,count);
      if(execution==='worker')assert(commands().some(c=>c.frame>0&&c.performance&&c.owner),chip+' Worker timing');
      await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());first=all().length;
      await page.evaluate(({chip,execution,last,editedClock,stereo,wave})=>window.__nativeBackendTest.runtime.playSource(`
        if(await useSoundChip('${chip}')!==opl)throw Error('Selected OPL primary was not reused');
        opl.setRhythm({enabled:false});${stereo?'for(const ch of [0,1,2,9,10,11])opl.setFourOp(ch,false);':''}
        for(const ch of [6,7,8]){opl.setPreset(ch,OPL_PRESETS.organ);opl.setNote(ch,'G3');}
        opl.setPreset(${last},OPL_PRESETS.organ);opl.setAlgo(${last},1,5);
        opl.setOperator(${last},0,{mul:3,tl:23,ar:14,dr:5,sl:6,rr:9,waveform:${wave}});opl.setOperator(${last},1,{tl:7});
        ${stereo?`opl.setPan(${last},false,true);opl.writeRegister(0x1c8,0x2b);`:''}
        opl.noteOn(${last},'A4');opl.setLFO({amDepth:true,pmDepth:true});
        opl.setRhythm({enabled:true,bassDrum:true,snare:true,tom:true,cymbal:true,hiHat:true});
        await opl.setClock(${editedClock});await mixer.set(opl.id,{volume:.6,pan:-.2});
      `,{execution}),{chip,execution,last,editedClock,stereo,wave});
      await until(()=>writes().some(m=>m.method==='clock')&&writes().some(m=>m.method==='mix'),chip+' edited voice clock and mix');
      const applied=await page.evaluate(()=>{const s=window.__nativeBackendTest.runtime.megaDrive;return s.chipInspector.read(s.chip);});
      assert.equal(applied.clock,editedClock);assert.equal(applied.registers[bank+0x32]&15,3);assert.equal(applied.registers[bank+0x52]&63,23);assert.equal(applied.registers[bank+0x55]&63,7);assert.equal(applied.registers[bank+0xf2]&7,wave);assert.equal(applied.registers[0xbd],255);
      if(stereo){assert.equal(applied.registers[0x1c8]&48,32);assert(writes().some(m=>m.method==='write'&&m.register>=256),'OPL3 bank one writes');}
      assert.equal(writes().filter(m=>m.method==='clock').length,1);await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
      const stopped=await page.evaluate(()=>{const s=window.__nativeBackendTest.runtime.megaDrive;return s.chipInspector.read(s.chip);});
      assert.equal(stopped.clock,editedClock);assert.equal(stopped.registers[bank+0x55]&63,7);assert.equal(stopped.registers[0xbd],224);assert(stopped.channels.every(c=>!c.active));assert.deepEqual(stopped.held,[]);await assertNoLiveAudio(page);
      await page.evaluate(baseClock=>window.__nativeBackendTest.runtime.megaDrive.opl.setClock(baseClock),baseClock);
    }
    await page.evaluate(stereo=>{const s=window.__nativeBackendTest.runtime.megaDrive;s.opl.setRhythm({enabled:false});if(stereo)for(const ch of [0,1,2,9,10,11])s.opl.setFourOp(ch,false);},stereo);
    await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:'+chip);await page.waitForFunction(n=>document.querySelectorAll('#playgroundKeyboardTargetChannel option').length===n,count);
    for(let ch=0;ch<count;ch++){
      await page.selectOption('#playgroundKeyboardTargetChannel',String(ch));await page.locator('#keyboardTab').focus();const first=all().length,added=()=>all().slice(first).filter(c=>c.type==='opl');
      await page.keyboard.down('z');await until(()=>added().some(c=>c.message.action==='on'&&c.message.channel===ch),chip+' Keyboard '+ch);await page.keyboard.up('z');await until(()=>added().some(c=>c.message.action==='off'),chip+' Keyboard release '+ch);
    }
    if(stereo){
      await page.evaluate(async()=>{const i=window.__nativeBackendTest.runtime.chipInspector;for(const ch of [0,1,2,9,10,11])await i.invoke('ymf262','setFourOp',[ch,true]);});
      await page.waitForFunction(()=>document.querySelectorAll('#playgroundKeyboardTargetChannel option').length===12);
      const ids=await page.locator('#playgroundKeyboardTargetChannel option').evaluateAll(nodes=>nodes.map(n=>n.value));for(const ch of [3,4,5,12,13,14])assert(!ids.includes(String(ch)),'Borrowed secondary must be excluded');
      for(const ch of [0,1,2,9,10,11]){await page.selectOption('#playgroundKeyboardTargetChannel',String(ch));await page.locator('#keyboardTab').focus();const first=all().length;await page.keyboard.down('z');await until(()=>all().slice(first).some(c=>c.type==='opl'&&c.message.action==='on'&&c.message.channel===ch),'OPL3 four-op pair '+ch);await page.keyboard.up('z');await until(()=>all().slice(first).some(c=>c.type==='opl'&&c.message.action==='off'),'OPL3 four-op release');}
    }
    const root='#'+chip+'Panel',tab='#'+chip+'Tab';await page.click(tab);const selected=stereo?9:0;await page.locator(root+' [data-chip-channel="'+selected+'"]').click();
    if(stereo){await page.locator(root+' [data-chip-control="opl-four-op"]').setChecked(false);await until(()=>!(native.opl.registers[0x104]&8),'OPL3 pair disabled');await page.locator(root+' [data-chip-control="opl-four-op"]').setChecked(true);await until(()=>!!(native.opl.registers[0x104]&8),'OPL3 pair enabled');await page.selectOption(root+' [data-chip-control="opl-algorithm"]','3');await page.locator(root+' [data-chip-control="opl-op-3-tl"]').evaluate(node=>{node.value='12';node.dispatchEvent(new Event('change',{bubbles:true}));});await until(()=>native.opl.registers[0x14b]===12&&(native.opl.registers[0x1c0]&1)&&(native.opl.registers[0x1c3]&1),'OPL3 fourth operator and routing');}
    else{await page.locator(root+' [data-chip-control="opl-op-0-tl"]').evaluate(node=>{node.value='19';node.dispatchEvent(new Event('change',{bubbles:true}));});await until(()=>(native.opl.registers[0x40]&63)===19,chip+' operator edit');}
    await page.locator(root+' [data-chip-control="opl-rhythm"]').setChecked(true);await until(()=>!!(native.opl.registers[0xbd]&32),chip+' rhythm UI enable');
    await page.locator(root+' [data-chip-control="opl-rhythm-bassDrum"]').setChecked(true);await until(()=>!!(native.opl.registers[0xbd]&16),chip+' rhythm UI trigger');await page.locator(root+' [data-chip-control="opl-rhythm-bassDrum"]').setChecked(false);await until(()=>!(native.opl.registers[0xbd]&16),chip+' rhythm UI release');await page.locator(root+' [data-chip-control="opl-rhythm"]').setChecked(false);
    await page.click(root+' [data-chip-action="opl-keyboard"]');await page.locator(tab).focus();let first=all().length;
    await page.keyboard.down('z');await until(()=>all().slice(first).some(c=>c.type==='opl'&&c.message.action==='on'&&c.message.channel===selected),chip+' Operators Keyboard');await page.keyboard.up('z');await until(()=>all().slice(first).some(c=>c.type==='opl'&&c.message.action==='off'),chip+' Operators release');
    await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:'+chip);await page.selectOption('#playgroundKeyboardTargetChannel',String(selected));const key=page.locator('#operatorKeyboardRoot .key').first();await key.scrollIntoViewIfNeeded();const rect=await key.boundingBox();first=all().length;
    await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await until(()=>all().slice(first).some(c=>c.type==='opl'&&c.message.action==='on'),chip+' Guitar pointer');await page.mouse.up();await until(()=>all().slice(first).some(c=>c.type==='opl'&&c.message.action==='off'),chip+' Guitar release');
    await page.screenshot({path:path.join(artifacts,name+'-native-'+chip+'.png')});await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  }
  await changeNativeMode(page,native,'genesis','keep');await page.evaluate(source=>window.__nativeBackendTest.editor.setValue(source),source);await nativeRun(page,native);
}
async function nativeMsx(page,native,artifacts,name,{audio=false}={}) {
  const mode=audio?'msx-audio':'msx',expected=audio?['y8950','ym2413','ay8910']:['ym2413','ay8910'];
  await changeNativeMode(page,native,mode);
  const starter=await fs.readFile(path.resolve(__dirname,'../docs/playground/defaults/'+mode+'/index.js'),'utf8');
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.editor.getValue()),starter);
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]),flatten=ms=>ms.flatMap(m=>m.method==='batch'?flatten(m.commands).map(op=>({...op,chip:m.chip})):[m]);
  for(const execution of ['main','worker']) {
    let first=all().length;const commands=()=>all().slice(first).filter(c=>c.type==='msx'||audio&&c.type==='opl'),writes=()=>flatten(commands().map(c=>c.message));
    await page.evaluate(({starter,execution})=>window.__nativeBackendTest.runtime.playSource(starter,{execution}),{starter,execution});
    await until(()=>writes().some(m=>m.chip==='ay8910'&&m.method==='write'&&m.register===8&&m.value)&&writes().some(m=>m.chip==='ym2413'&&m.method==='write'&&m.register===0x20&&(m.value&16)),execution+' MSX starter');
    if(audio)await until(()=>writes().some(m=>m.chip==='y8950'&&m.method==='write'&&m.register===0xb0&&(m.value&32)),execution+' Y8950 starter');
    const info=await page.evaluate(async()=>{const s=window.__nativeBackendTest.runtime.megaDrive;return {chip:s.chip,fm:s.fm,psg:s.psg,mixer:s.mixer.list().filter(c=>c.connected).map(c=>c.id),inspected:s.chipInspector.list().map(c=>c.id),ay:await s.chipInspector.read('ay8910'),opll:await s.chipInspector.read('ym2413')};});
    assert.equal(info.chip,mode);assert.equal(info.fm,null);assert.equal(info.psg,null);assert.deepEqual(info.mixer,expected);assert.deepEqual(info.inspected,expected);assert.equal(info.ay.clock,1789773);assert.equal(info.opll.clock,3579545);
    if(audio){assert(commands().every(c=>['opl','msx','mix','noise','fx'].includes(c.type)));assert.equal(native.opl.chip,'y8950');}
    if(execution==='worker')assert(commands().some(c=>c.frame>0&&c.performance&&c.owner),'MSX Worker timed lease');
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());first=all().length;
    await page.evaluate(({execution,audio})=>window.__nativeBackendTest.runtime.playSource(`
      if(await useSoundChip('ym2413')!==opll||await useSoundChip('ay8910')!==ay)throw Error('MSX primary was not reused');
      ay.setVoice(0,{tone:true,noise:false,volume:7,envelope:false});ay.noteOn(0,'A4');
      ay.setVoice(1,{tone:false,noise:true,volume:5,envelope:false});ay.keyOn(1);
      ay.setVoice(2,{tone:true,noise:true,volume:9,envelope:true});ay.noteOn(2,'C3');
      ay.setNoisePeriod(21);ay.setEnvelope({period:1234,shape:10});ay.setEnvelope({shape:10});
      ay.writeRegister(14,0xab);ay.writeRegister(15,0xcd);
      opll.setUserPatch({feedback:3});opll.setVoice(8,{instrument:0,attenuation:4});opll.noteOn(8,'A4');
      await ay.setClock(1800000);await opll.setClock(3600000);
      await mixer.set(ay.id,{volume:.6,pan:.2});await mixer.set(opll.id,{volume:.4,pan:-.1});
      ${audio?`if(await useSoundChip('y8950')!==opl)throw Error('Y8950 primary was not reused');
      for(const ch of [6,7,8])opl.setPreset(ch,OPL_PRESETS.bell);
      opl.setPreset(0,OPL_PRESETS.bell);opl.setAlgo(0,1);opl.setOperator(0,0,{mul:3,tl:23});opl.setOperator(0,1,{tl:7});opl.noteOn(0,'D4');
      opl.setRhythm({enabled:true,bassDrum:true,snare:true,tom:true,cymbal:true,hiHat:true});
      await opl.setClock(3300000);await mixer.set(opl.id,{volume:.5,pan:0});`:''}
    `,{execution}),{execution,audio});
    await until(()=>writes().filter(m=>m.method==='clock').length>=(audio?3:2)&&writes().some(m=>m.chip==='ay8910'&&m.method==='set-retained-level'&&m.channel===0),execution+' MSX clocks and retained levels');
    const applied=await page.evaluate(async()=>({ay:await window.__nativeBackendTest.runtime.chipInspector.read('ay8910'),opll:await window.__nativeBackendTest.runtime.chipInspector.read('ym2413')}));
    assert.equal(applied.ay.noise.period,21);assert.equal(applied.ay.envelope.period,1234);assert.equal(applied.ay.envelope.shape,10);assert.equal(applied.ay.registers[14],0xab);assert.equal(applied.ay.registers[15],0xcd);assert.equal(applied.ay.clock,1800000);assert.equal(applied.opll.clock,3600000);assert.equal(applied.opll.registers[0x38],4);
    assert.equal(applied.ay.channels[1].toneEnabled,false);assert.equal(applied.ay.channels[1].noiseEnabled,true);assert.equal(applied.ay.channels[2].configuredEnvelope,true);assert.equal(applied.ay.channels[2].configuredVolume,9);
    assert.equal(writes().filter(m=>m.chip==='ay8910'&&m.method==='write'&&m.register===13).length,2,'equal envelope-shape writes retrigger twice');assert(writes().some(m=>m.method==='mix'&&m.chip==='ay8910'));assert(writes().some(m=>m.method==='mix'&&m.chip==='ym2413'));
    if(audio){const y=await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('y8950'));assert.equal(y.clock,3300000);assert.equal(y.registers[0x40]&63,23);assert.equal(y.registers[0x43]&63,7);assert.equal(y.registers[0xbd]&63,63);assert(writes().some(m=>m.chip==='y8950'&&m.method==='mix'));}
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    if(audio){const y=await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('y8950'));assert.equal(y.clock,3300000);assert.equal(y.registers[0x40]&63,23);assert.equal(y.registers[0xbd]&63,32);assert(y.channels.every(c=>!c.active));await page.evaluate(async()=>{const s=window.__nativeBackendTest.runtime.megaDrive;await s.opl.setClock(3579545);await s.chipInspector.invoke('y8950','setRhythm',[{enabled:false}]);});}
    const stopped=await page.evaluate(async()=>({ay:await window.__nativeBackendTest.runtime.chipInspector.read('ay8910'),opll:await window.__nativeBackendTest.runtime.chipInspector.read('ym2413')}));
    assert.equal(stopped.ay.envelope.period,1234);assert.equal(stopped.ay.envelope.shape,10);assert.equal(stopped.ay.noise.period,21);assert.equal(stopped.ay.registers[14],0xab);assert(stopped.ay.channels.every(c=>!c.active));assert.deepEqual(stopped.ay.channels.map(c=>c.configuredVolume),[7,5,9]);assert.equal(stopped.ay.channels[2].configuredEnvelope,true);assert.equal(stopped.opll.registers[0x38],4);assert(stopped.opll.channels.every(c=>!c.active));await assertNoLiveAudio(page);
    await page.evaluate(async()=>{const s=window.__nativeBackendTest.runtime.megaDrive;await s.ay.setClock(1789773);await s.opll.setClock(3579545);});
    first=all().length;
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`ay.setVolume(0,0,false);ay.keyOff(0);ay.keyOn(0);`,{execution}),execution);
    await until(()=>writes().some(m=>m.chip==='ay8910'&&m.method==='set-retained-level'&&m.channel===0&&m.level===0),'explicit zero volume metadata');
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    assert.equal((await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('ay8910'))).channels[0].configuredVolume,0);
    await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.invoke('ay8910','setVoice',[0,{tone:true,noise:false,volume:9,envelope:false}]));
  }
  for(const [chip,count]of [...(audio?[['y8950',9]]:[]),['ym2413',9],['ay8910',3]]){
    await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:'+chip);
    for(let ch=0;ch<count;ch++){
      await page.selectOption('#playgroundKeyboardTargetChannel',String(ch));await page.locator('#keyboardTab').focus();const first=all().length,added=()=>all().slice(first).filter(c=>c.type===(chip==='y8950'?'opl':'msx')&&c.message.chip===chip);
      await page.keyboard.down('z');await until(()=>added().some(c=>c.message.action==='on'&&c.message.channel===ch),chip+' MSX Keyboard '+ch);await page.keyboard.up('z');await until(()=>added().some(c=>c.message.action==='off'),chip+' MSX Keyboard release '+ch);
    }
  }
  await page.evaluate(async()=>{const i=window.__nativeBackendTest.runtime.chipInspector;await i.invoke('ym2413','setRhythm',[{enabled:true}]);await i.invoke('ym2413','setRhythmLevels',[{bassDrum:4,snare:5,tom:6,cymbal:7,hiHat:8}]);});
  await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:ym2413');await page.waitForFunction(()=>document.querySelectorAll('#playgroundKeyboardTargetChannel option').length===11);
  for(let drum=0;drum<5;drum++){await page.selectOption('#playgroundKeyboardTargetChannel','rhythm:'+drum);await page.locator('#keyboardTab').focus();const first=all().length;await page.keyboard.down('z');await until(()=>all().slice(first).some(c=>c.type==='msx'&&c.message.action==='on'&&c.message.channel===9+drum),'MSX OPLL drum '+drum);await page.keyboard.up('z');await until(()=>all().slice(first).some(c=>c.type==='msx'&&c.message.action==='off'),'MSX OPLL drum release');}
  await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.invoke('ym2413','setRhythm',[{enabled:false}]));
  for(const [chip,prefix]of [...(audio?[['y8950','opl']]:[]),['ym2413','opll'],['ay8910','ay']]){
    const tab='#'+chip+'Tab',root='#'+chip+'Panel';await page.click(tab);
    if(chip==='y8950'){
      await page.locator(root+' [data-chip-channel="0"]').click();await page.locator(root+' [data-chip-control="opl-op-0-tl"]').evaluate(node=>{node.value='19';node.dispatchEvent(new Event('change',{bubbles:true}));});await until(()=>(native.opl.registers[0x40]&63)===19,'Y8950 operator edit');
      await page.locator(root+' [data-chip-control="opl-rhythm"]').setChecked(true);await page.locator(root+' [data-chip-control="opl-rhythm-bassDrum"]').setChecked(true);await until(()=>!!(native.opl.registers[0xbd]&16),'Y8950 rhythm UI trigger');await page.locator(root+' [data-chip-control="opl-rhythm-bassDrum"]').setChecked(false);await page.locator(root+' [data-chip-control="opl-rhythm"]').setChecked(false);
    }else if(chip==='ym2413'){
      await page.selectOption(root+' [data-chip-control="opll-instrument"]','0');await page.locator(root+' [data-chip-control="opll-user-feedback"]').evaluate(node=>{node.value='6';node.dispatchEvent(new Event('change',{bubbles:true}));});await until(()=>(native.msx.ym2413.registers[3]&7)===6,'MSX User patch edit');
    }else{
      await page.locator(root+' [data-chip-control="ay-volume"]').evaluate(node=>{node.value='11';node.dispatchEvent(new Event('change',{bubbles:true}));});await until(()=>native.msx.ay8910.levels[0]%16===11,'AY live volume edit');
      await page.locator(root+' [data-chip-control="ay-envelope-period"]').evaluate(node=>{node.value='2345';node.dispatchEvent(new Event('change',{bubbles:true}));});await until(()=>(native.msx.ay8910.registers[11]|native.msx.ay8910.registers[12]<<8)===2345,'AY live shared envelope edit');
      const first=all().length;await page.click(root+' [data-chip-action="ay-envelope-retrigger"]');await until(()=>flatten(all().slice(first).filter(c=>c.type==='msx').map(c=>c.message)).some(m=>m.chip==='ay8910'&&m.method==='write'&&m.register===13),'AY envelope UI retrigger');
    }
    await page.click(root+' [data-chip-action="'+prefix+'-keyboard"]');await page.locator(tab).focus();const first=all().length;
    await page.keyboard.down('z');await until(()=>all().slice(first).some(c=>c.type===(chip==='y8950'?'opl':'msx')&&c.message.chip===chip&&c.message.action==='on'),chip+' MSX Operators Keyboard');await page.keyboard.up('z');await until(()=>all().slice(first).some(c=>c.type===(chip==='y8950'?'opl':'msx')&&c.message.chip===chip&&c.message.action==='off'),chip+' MSX Operators release');
  }
  await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:ay8910');await page.selectOption('#playgroundKeyboardTargetChannel','2');const key=page.locator('#operatorKeyboardRoot .key').first();await key.scrollIntoViewIfNeeded();const rect=await key.boundingBox();let first=all().length;
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await until(()=>all().slice(first).some(c=>c.type==='msx'&&c.message.chip==='ay8910'&&c.message.action==='on'),'MSX AY Guitar pointer');await page.mouse.up();await until(()=>all().slice(first).some(c=>c.type==='msx'&&c.message.action==='off'),'MSX AY Guitar release');
  await page.screenshot({path:path.join(artifacts,name+'-native-'+mode+'.png')});await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  await changeNativeMode(page,native,'genesis','keep');await page.evaluate(source=>window.__nativeBackendTest.editor.setValue(source),source);await nativeRun(page,native);
}
async function nativeGameGear(page,native,artifacts,name) {
  await changeNativeMode(page,native,'game-gear');
  const starter=await fs.readFile(path.resolve(__dirname,'../docs/playground/defaults/game-gear/index.js'),'utf8');
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.editor.getValue()),starter);
  const all=()=>native.calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]);
  const flatten=messages=>messages.flatMap(m=>m.method==='batch'?flatten(m.commands.map(c=>({...c,chip:m.chip}))):[m]);
  for(const execution of ['main','worker']) {
    const first=all().length,commands=()=>all().slice(first),writes=()=>flatten(commands().filter(c=>c.type==='master-system').map(c=>c.message));
    await page.evaluate(({starter,execution})=>window.__nativeBackendTest.runtime.playSource(starter,{execution}),{starter,execution});
    await until(()=>writes().some(m=>m.method==='stereo'&&m.mask===255)&&writes().some(m=>m.method==='write'&&m.value===0xe6),execution+' Game Gear starter tone/noise and stereo');
    const state=await page.evaluate(()=>{const s=window.__nativeBackendTest.runtime.megaDrive;return {mode:s.mode,chip:s.chip,fm:s.fm,opll:s.opll,ay:s.ay,pcm:s.pcm,stereo:s.psg.stereoEnabled,endpoints:s.primaryEndpoints.map(e=>e.name),chips:s.mixer.list().filter(c=>c.connected).map(c=>c.id),inspected:s.chipInspector.list().map(c=>c.id)};});
    assert.deepEqual(state,{mode:'game-gear',chip:'segapsg',fm:null,opll:null,ay:null,pcm:null,stereo:true,endpoints:['segapsg'],chips:['segapsg'],inspected:['segapsg']});
    assert(commands().every(c=>['master-system','mix','noise','fx'].includes(c.type)),'Game Gear must never send hidden FM/OPLL commands');
    assert(writes().every(m=>m.chip==='segapsg'));
    if(execution==='worker')assert(commands().some(c=>c.type==='master-system'&&c.message.method==='stereo'&&c.frame>0&&c.performance&&c.owner),'Worker stereo must keep frame and owner');
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`
      if(await useSoundChip('segapsg')!==psg)throw Error('Game Gear primary PSG was not reused');
      if(typeof fm!=='undefined'||typeof opll!=='undefined')throw Error('Unexpected hidden Game Gear chip');
      for(const mask of [0,0x10,1,0x11,0x80,8,0x88,0xff])psg.setStereo(mask);
      psg.tone(PSG1,{note:'C4',attenuation:6});
      psg.tone(PSG3,{period:321,attenuation:9});
      psg.noise({type:'white',rate:'tone3',attenuation:11});
      psg.setStereo(0x96);
      await psg.setClock(3579546);
      await mixer.set(psg.id,{volume:0.6,pan:-0.2});
    `,{execution}),execution);
    await until(()=>native.gameGear.segapsg.stereo===0x96&&native.gameGear.segapsg.clock===3579546,execution+' Game Gear routing and clock');
    const read=()=>page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.read('segapsg'));
    const edited=await read();assert.equal(edited.channels[2].period,321);assert.equal(edited.noise.rate,'tone3');assert.equal(edited.noise.type,'white');assert.equal(edited.stereo,0x96);assert.equal(edited.stereoEnabled,true);assert.equal(edited.clock,3579546);
    for(const mask of [0,0x10,1,0x11,0x80,8,0x88,0xff])assert(writes().some(m=>m.method==='stereo'&&m.mask===mask));
    assert(writes().some(m=>m.method==='mix'&&m.volume===0.6));
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    const stopped=await read();assert.equal(stopped.stereo,0x96);assert.equal(stopped.channels[2].period,321);assert.equal(stopped.noise.rate,'tone3');assert(stopped.channels.every(c=>c.attenuation===15));assert.equal(stopped.noise.attenuation,15);
    await page.evaluate(async()=>{const s=window.__nativeBackendTest.runtime.megaDrive;s.psg.keyOn(2);await s.flush();});
    assert.equal((await read()).channels[2].attenuation,9);assert.equal(native.gameGear.segapsg.stereo,0x96);
    await page.evaluate(async()=>{const s=window.__nativeBackendTest.runtime.megaDrive;await s.psg.setClock(3579545);await s.stopNativeAudio();});
    await assertNoLiveAudio(page);
  }
  await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:segapsg');
  assert.equal(await page.locator('#playgroundKeyboardChip option').count(),1);
  assert.equal(await page.locator('#playgroundKeyboardTargetChannel option').count(),4);
  for(const voice of ['0','1','2','3']) {
    await page.selectOption('#playgroundKeyboardTargetChannel',voice);await page.locator('#keyboardTab').focus();
    const first=all().length,added=()=>all().slice(first).filter(c=>c.type==='master-system');
    await page.keyboard.down('z');await until(()=>added().some(c=>c.message.action==='on'&&c.message.channel===Number(voice)),'Game Gear Keyboard '+voice);
    await page.keyboard.up('z');await until(()=>added().some(c=>c.message.action==='off'),'Game Gear Keyboard release '+voice);
    assert.equal(native.gameGear.segapsg.stereo,0x96);
  }
  await page.click('#segapsgTab');await page.locator('#segapsgPanel [data-chip-keyboard-channel="2"]').click();
  await page.locator('#segapsgPanel [data-chip-control="tone-2-volume"]').evaluate(node=>{node.value='8';node.dispatchEvent(new Event('input',{bubbles:true}));});
  await until(()=>native.gameGear.segapsg.attenuations[2]===7,'Game Gear Operators volume');
  await page.locator('#segapsgTab').focus();let first=all().length;
  await page.keyboard.down('z');await until(()=>all().slice(first).some(c=>c.type==='master-system'&&c.message.action==='on'),'Game Gear Operators Keyboard');
  await page.keyboard.up('z');await until(()=>all().slice(first).some(c=>c.type==='master-system'&&c.message.action==='off'),'Game Gear Operators release');
  if(!await page.locator('#keyboardTab').isVisible())await page.locator('.dock-toggle').click();
  await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardTargetChannel','0');
  const key=page.locator('#operatorKeyboardRoot .key').first();await key.scrollIntoViewIfNeeded();const rect=await key.boundingBox();first=all().length;
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await until(()=>all().slice(first).some(c=>c.type==='master-system'&&c.message.action==='on'),'Game Gear Guitar pointer');
  await page.mouse.up();await until(()=>all().slice(first).some(c=>c.type==='master-system'&&c.message.action==='off'),'Game Gear Guitar release');
  await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.invoke('segapsg','reset'));
  assert.equal(native.gameGear.segapsg.stereo,255);assert(native.gameGear.segapsg.attenuations.every(v=>v===15));
  await page.screenshot({path:path.join(artifacts,name+'-native-game-gear.png')});await assertNoLiveAudio(page);
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  await changeNativeMode(page,native,'genesis','keep');await page.evaluate(source=>window.__nativeBackendTest.editor.setValue(source),source);await nativeRun(page,native);
}
async function nativeMasterSystem(page,native,artifacts,name) {
  await changeNativeMode(page,native,'master-system');
  const starter=await fs.readFile(path.resolve(__dirname,'../docs/playground/defaults/master-system/index.js'),'utf8');
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.editor.getValue()),starter);
  const all=()=>native.calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[]);
  const flatten=ms=>ms.flatMap(m=>m.method==='batch'?flatten(m.commands).map(op=>({...op,chip:m.chip})):[m]);
  for(const execution of ['main','worker']) {
    let first=all().length;const commands=()=>all().slice(first).filter(c=>c.type==='master-system'),writes=()=>flatten(commands().map(c=>c.message));
    await page.evaluate(({starter,execution})=>window.__nativeBackendTest.runtime.playSource(starter,{execution}),{starter,execution});
    await until(()=>writes().some(m=>m.chip==='segapsg'&&m.method==='write')&&writes().some(m=>m.chip==='ym2413'&&m.method==='write'&&m.register===0x20&&(m.value&16)),execution+' SMS starter');
    const info=await page.evaluate(async()=>{const s=window.__nativeBackendTest.runtime.megaDrive;return {chip:s.chip,fm:s.fm,psgStereo:s.psg.stereoEnabled,hasStereo:typeof s.psg.setStereo,capabilities:s.capabilities,mixer:s.mixer.list().filter(c=>c.connected).map(c=>c.id),inspected:s.chipInspector.list().map(c=>c.id),psg:await s.chipInspector.read('segapsg'),opll:await s.chipInspector.read('ym2413')};});
    assert.equal(info.chip,'segapsg');assert.equal(info.fm,null);assert.equal(info.capabilities.fmChannels,0);assert.equal(info.capabilities.psg,true);assert.equal(info.psgStereo,false);assert.equal(info.hasStereo,'undefined');assert.deepEqual(info.mixer,['segapsg','ym2413']);assert.deepEqual(info.inspected,['segapsg','ym2413']);assert.equal(info.psg.clock,3579545);assert.equal(info.opll.clock,3579545);
    if(execution==='worker')assert(commands().some(c=>c.frame>0&&c.performance&&c.owner),'Master System Worker timed lease');
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());first=all().length;
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`
      if(await useSoundChip('segapsg')!==psg||await useSoundChip('ym2413')!==opll)throw Error('SMS primary was not reused');
      if(psg.stereoEnabled!==false||typeof psg.setStereo!=='undefined')throw Error('Master System must be mono');
      for(let ch=0;ch<9;ch++){opll.setVoice(ch,{instrument:ch%15+1,attenuation:5});opll.noteOn(ch,'A4');}
      opll.setUserPatch({feedback:3});opll.setVoice(8,{instrument:0,attenuation:4});
      psg.setPeriod(2,321);psg.setAttenuation(2,6);psg.noise({type:'white',rate:'tone3',attenuation:9});
      await psg.setClock(3579546);await opll.setClock(3579546);
      await mixer.set(psg.id,{volume:.6,pan:.2});await mixer.set(opll.id,{volume:.4,pan:-.1});
    `,{execution}),execution);
    await until(()=>writes().some(m=>m.chip==='ym2413'&&m.register===0x38)&&writes().filter(m=>m.method==='clock').length===2,execution+' SMS voices and clocks');
    const applied=await page.evaluate(async()=>({psg:await window.__nativeBackendTest.runtime.chipInspector.read('segapsg'),opll:await window.__nativeBackendTest.runtime.chipInspector.read('ym2413')}));
    assert.equal(applied.psg.channels[2].period,321);assert.equal(applied.psg.noise.rate,'tone3');assert.equal(applied.opll.registers[0x38],4);assert.equal(applied.opll.registers[3]&7,3);assert.equal(applied.psg.clock,3579546);assert.equal(applied.opll.clock,3579546);assert(writes().some(m=>m.method==='mix'&&m.chip==='segapsg'));assert(writes().some(m=>m.method==='mix'&&m.chip==='ym2413'));
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    const stopped=await page.evaluate(async()=>({psg:await window.__nativeBackendTest.runtime.chipInspector.read('segapsg'),opll:await window.__nativeBackendTest.runtime.chipInspector.read('ym2413')}));
    assert.equal(stopped.psg.channels[2].period,321);assert.equal(stopped.psg.noise.rate,'tone3');assert(stopped.psg.channels.every(c=>c.attenuation===15));assert.equal(stopped.opll.registers[0x38],4);assert(stopped.opll.channels.every(c=>!c.active));await assertNoLiveAudio(page);
    await page.evaluate(async()=>{const s=window.__nativeBackendTest.runtime.megaDrive;await s.psg.setClock(3579545);await s.opll.setClock(3579545);});
  }
  for(const [chip,voices]of [['segapsg',['0','1','2','3']],['ym2413',Array.from({length:9},(_,i)=>String(i))]]){
    await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:'+chip);
    for(const voice of voices){await page.selectOption('#playgroundKeyboardTargetChannel',voice);await page.locator('#keyboardTab').focus();const first=all().length,added=()=>all().slice(first).filter(c=>c.type==='master-system'&&c.message.chip===chip);
      await page.keyboard.down('z');await until(()=>added().some(c=>c.message.action==='on'),chip+' Keyboard '+voice);await page.keyboard.up('z');await until(()=>added().some(c=>c.message.action==='off'),chip+' Keyboard release '+voice);
    }
  }
  await page.evaluate(async()=>{const i=window.__nativeBackendTest.runtime.chipInspector;await i.invoke('ym2413','setRhythm',[{enabled:true}]);await i.invoke('ym2413','setRhythmLevels',[{bassDrum:4,snare:5,tom:6,cymbal:7,hiHat:8}]);});
  await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:ym2413');
  await page.waitForFunction(()=>document.querySelectorAll('#playgroundKeyboardTargetChannel option').length===11);
  for(let drum=0;drum<5;drum++){await page.selectOption('#playgroundKeyboardTargetChannel','rhythm:'+drum);await page.locator('#keyboardTab').focus();const first=all().length;await page.keyboard.down('z');await until(()=>all().slice(first).some(c=>c.type==='master-system'&&c.message.action==='on'&&c.message.channel===9+drum),'OPLL rhythm Keyboard '+drum);await page.keyboard.up('z');await until(()=>all().slice(first).some(c=>c.type==='master-system'&&c.message.action==='off'),'OPLL rhythm Keyboard release');}
  await page.evaluate(()=>window.__nativeBackendTest.runtime.chipInspector.invoke('ym2413','setRhythm',[{enabled:false}]));
  await page.click('#ym2413Tab');await page.selectOption('#ym2413Panel [data-chip-control="opll-instrument"]','0');
  await page.locator('#ym2413Panel [data-chip-control="opll-user-feedback"]').evaluate(node=>{node.value='6';node.dispatchEvent(new Event('change',{bubbles:true}));});
  await until(()=>(native.masterSystem.ym2413.registers[3]&7)===6,'OPLL live User patch edit');
  await page.click('#ym2413Panel [data-chip-action="opll-keyboard"]');await page.locator('#ym2413Tab').focus();let first=all().length;
  await page.keyboard.down('z');await until(()=>all().slice(first).some(c=>c.type==='master-system'&&c.message.chip==='ym2413'&&c.message.action==='on'),'OPLL Operators Keyboard');await page.keyboard.up('z');await until(()=>all().slice(first).some(c=>c.type==='master-system'&&c.message.action==='off'),'OPLL Operators release');
  await page.locator('#bottomDock .dock-close').click();
  await page.click('#segapsgTab');await page.locator('#segapsgPanel [data-chip-keyboard-channel="2"]').click();
  await page.locator('#segapsgPanel [data-chip-control="tone-2-volume"]').evaluate(node=>{node.value='8';node.dispatchEvent(new Event('input',{bubbles:true}));});await until(()=>native.masterSystem.segapsg.attenuations[2]===7,'PSG live volume edit');
  await page.locator('#segapsgTab').focus();first=all().length;await page.keyboard.down('z');await until(()=>all().slice(first).some(c=>c.type==='master-system'&&c.message.chip==='segapsg'&&c.message.action==='on'),'PSG Operators Keyboard');await page.keyboard.up('z');await until(()=>all().slice(first).some(c=>c.type==='master-system'&&c.message.action==='off'),'PSG Operators release');
  await page.locator('.dock-toggle').click();await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:segapsg');await page.selectOption('#playgroundKeyboardTargetChannel','0');const key=page.locator('#operatorKeyboardRoot .key').first();await key.scrollIntoViewIfNeeded();const rect=await key.boundingBox();first=all().length;
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await until(()=>all().slice(first).some(c=>c.type==='master-system'&&c.message.action==='on'),'SMS Guitar pointer');await page.mouse.up();await until(()=>all().slice(first).some(c=>c.type==='master-system'&&c.message.action==='off'),'SMS Guitar pointer release');
  await page.screenshot({path:path.join(artifacts,name+'-native-master-system.png')});await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  await changeNativeMode(page,native,'genesis','keep');await page.evaluate(source=>window.__nativeBackendTest.editor.setValue(source),source);await nativeRun(page,native);
}
async function nativeX68000(page,native,artifacts,name) {
  const {encodeWav}=await import('../web/wav.js');
  const wav=Array.from(encodeWav({sampleRate:16000,channels:[Float32Array.from({length:1024},(_,i)=>Math.sin(i/9)*.3)]}));
  await changeNativeMode(page,native,'x68000');
  const starter=await fs.readFile(path.resolve(__dirname,'../docs/playground/defaults/x68000/index.js'),'utf8');
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.editor.getValue()),starter);
  const allCommands=()=>native.calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]);
  const flatten=messages=>messages.flatMap(message=>message.method==='batch'?flatten(message.commands).map(op=>({...op,chip:message.chip})):[message]);
  for(const execution of ['main','worker']) {
    let first=allCommands().length;const commands=()=>allCommands().slice(first).filter(c=>c.type==='x68000'),writes=()=>flatten(commands().map(c=>c.message));
    await page.evaluate(({starter,execution})=>window.__nativeBackendTest.runtime.playSource(starter,{execution}),{starter,execution});
    await until(()=>writes().some(m=>m.chip==='ym2151'&&m.method==='write'&&m.register===8&&(m.value&0x78)),execution+' X68000 FM starter');
    const state=await page.evaluate(async()=>{const s=window.__nativeBackendTest.runtime.megaDrive;return {chip:s.chip,psg:s.psg,fm:s.fm,capabilities:s.capabilities,mixer:s.mixer.list().filter(c=>c.connected).map(c=>c.id),inspected:s.chipInspector.list().map(c=>c.id),opm:await s.chipInspector.read('ym2151'),oki:await s.chipInspector.read('okim6258')};});
    assert.equal(state.chip,'x68000');assert.equal(state.fm,null);assert.equal(state.psg,null);assert.equal(state.capabilities.fmChannels,0);assert.deepEqual(state.mixer,['ym2151','okim6258']);assert.deepEqual(state.inspected,['ym2151','okim6258']);assert.equal(state.opm.clock,4000000);assert.equal(state.oki.clock,8000000);
    if(execution==='worker')assert(commands().some(c=>c.frame>0&&c.performance&&c.owner),'X68000 Worker timing');
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());first=allCommands().length;
    await page.evaluate(execution=>window.__nativeBackendTest.runtime.playSource(`
      if(await useSoundChip('ym2151')!==opm||await useSoundChip('okim6258')!==adpcm)throw Error('X68000 primary was not reused');
      opm.setAlgo(7,7,3);opm.setPan(7,true,false);opm.setOperator(7,1,{mul:3,tl:23,ar:31});opm.setNoise(true,9);
      await opm.setClock(4000001);await adpcm.setClock(8000001);
      await adpcm.loadSample({sampleRate:16000,channels:[Float32Array.from({length:2048},(_,i)=>Math.sin(i/8)*.4)]});
      adpcm.setDivider(768);adpcm.setPan(true,false);adpcm.play({repeat:true});
      await mixer.set(opm.id,{volume:.6,pan:.2});await mixer.set(adpcm.id,{volume:.4,pan:-.1});
      liveLoop('native-x68000-last',async()=>{opm.noteOn(7,'E4');await beat(.04);opm.keyOff(7);await beat(.04);});
    `,{execution}),execution);
    await until(()=>writes().some(m=>m.method==='memory-commit')&&writes().some(m=>m.chip==='okim6258'&&m.method==='play'),execution+' OKI sample preparation');
    const applied=await page.evaluate(async()=>({fm:await window.__nativeBackendTest.runtime.chipInspector.read('ym2151'),oki:await window.__nativeBackendTest.runtime.chipInspector.read('okim6258')}));
    assert.equal(applied.fm.registers[0x4f]&15,3);assert.equal(applied.fm.registers[0x6f],23);assert.equal(applied.fm.clock,4000001);assert.equal(applied.oki.clock,8000001);assert.equal(applied.oki.divider,768);assert.deepEqual(applied.oki.pan,{left:true,right:false});assert(applied.oki.sample.bytes>0);assert(applied.oki.sample.waveform.length>0);
    assert.equal(writes().filter(m=>m.method==='clock'&&m.chip==='ym2151').length,1);assert.equal(writes().filter(m=>m.method==='clock'&&m.chip==='okim6258').length,1);assert(writes().some(m=>m.chip==='ym2151'&&m.method==='mix'));assert(writes().some(m=>m.chip==='okim6258'&&m.method==='mix'));
    if(execution==='worker')assert(commands().filter(c=>c.message.method.startsWith('memory-')).every(c=>c.frame===0&&c.performance&&c.owner),'OKI upload keeps owner while preparing immediately');
    assert.doesNotMatch(await page.locator('#consoleOutput').textContent(),/Observer:.*(?:_adoptClock|setClock)/);
    const memory=Array.from(native.x68000.memory);await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    const stopped=await page.evaluate(async()=>({fm:await window.__nativeBackendTest.runtime.chipInspector.read('ym2151'),oki:await window.__nativeBackendTest.runtime.chipInspector.read('okim6258')}));
    assert.equal(stopped.fm.registers[0x6f],23);assert.equal(stopped.fm.clock,4000001);assert.equal(stopped.oki.divider,768);assert.equal(stopped.oki.playing,false);assert.deepEqual(Array.from(native.x68000.memory),memory);assert.deepEqual(stopped.fm.held,[]);assert.deepEqual(stopped.oki.held,[]);await assertNoLiveAudio(page);
    // Restore clocks before checking the next starter pass.
    await page.evaluate(async()=>{await window.__nativeBackendTest.runtime.megaDrive.opm.setClock(4000000);await window.__nativeBackendTest.runtime.megaDrive.adpcm.setClock(8000000);});
  }
  await page.click('#keyboardTab');await page.selectOption('#playgroundKeyboardChip','chip:ym2151');
  for(let ch=0;ch<8;ch++){
    await page.selectOption('#playgroundKeyboardTargetChannel',String(ch));await page.locator('#keyboardTab').focus();const first=allCommands().length;
    const added=()=>allCommands().slice(first).filter(c=>c.type==='x68000'&&c.message.chip==='ym2151');
    await page.keyboard.down('z');await until(()=>added().some(c=>c.message.action==='on'&&c.message.channel===ch),'OPM Keyboard '+ch);
    await page.keyboard.up('z');await until(()=>added().some(c=>c.message.action==='off'&&c.message.channel===ch),'OPM Keyboard release '+ch);
  }
  await page.selectOption('#playgroundKeyboardChip','chip:okim6258');await page.locator('#keyboardTab').focus();let first=allCommands().length;
  await page.keyboard.down('z');await until(()=>allCommands().slice(first).some(c=>c.type==='x68000'&&c.message.chip==='okim6258'&&c.message.action==='on'),'OKI Keyboard');
  await page.keyboard.up('z');await until(()=>allCommands().slice(first).some(c=>c.type==='x68000'&&c.message.chip==='okim6258'&&c.message.action==='off'),'OKI Keyboard release');
  await page.selectOption('#playgroundKeyboardChip','chip:ym2151');await page.selectOption('#playgroundKeyboardTargetChannel','0');
  const key=page.locator('#operatorKeyboardRoot .key').first();await key.scrollIntoViewIfNeeded();const rect=await key.boundingBox();first=allCommands().length;
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await until(()=>allCommands().slice(first).some(c=>c.type==='x68000'&&c.message.action==='on'),'X68000 Guitar pointer');
  await page.mouse.up();await until(()=>allCommands().slice(first).some(c=>c.type==='x68000'&&c.message.action==='off'),'X68000 Guitar release');
  for(const [chip,prefix]of [['ym2151','ym2151'],['okim6258','oki6258']]){
    const tab='#'+chip+'Tab',root='#'+chip+'Panel';
    await page.click(tab);
    if(chip==='ym2151'){
      await page.selectOption(root+' [data-chip-control="ym2151-algorithm"]','6');
      await page.locator(root+' [data-chip-control="ym2151-op-1-tl"]').evaluate(node=>{node.value='29';node.dispatchEvent(new Event('change',{bubbles:true}));});
      await until(()=>native.x68000.ym2151.registers[0x70]===29&&((native.x68000.ym2151.registers[0x20]&7)===6),'OPM live operator edit follows logical panel order');
    }else{
      await page.evaluate(bytes=>window.__nativeBackendTest.virtualFiles.writeBinary('/samples/native-oki.wav',Uint8Array.from(bytes)),wav);
      await page.selectOption(root+' [data-chip-control="oki6258-file"]','/samples/native-oki.wav');
      const beforeLoad=allCommands().length;await page.click(root+' [data-chip-action="oki6258-load"]');
      await until(()=>native.x68000.okim6258.sample?.name==='/samples/native-oki.wav','OKI panel audio-file load');
      assert(allCommands().slice(beforeLoad).some(c=>c.type==='x68000'&&c.message.method==='memory-commit'&&c.message.audition===true),'explicit UI load commits with audition authority');
      await page.selectOption(root+' [data-chip-control="oki6258-divider"]','1024');
      await until(()=>native.x68000.okim6258.divider===1024,'OKI live divider edit');
    }
    await page.click(root+' [data-chip-action="'+prefix+'-keyboard"]');await page.locator(tab).focus();first=allCommands().length;
    await page.keyboard.down('z');await until(()=>allCommands().slice(first).some(c=>c.type==='x68000'&&c.message.chip===chip&&c.message.action==='on'),chip+' Operators Keyboard');
    await page.keyboard.up('z');await until(()=>allCommands().slice(first).some(c=>c.type==='x68000'&&c.message.chip===chip&&c.message.action==='off'),chip+' Operators Keyboard release');
  }
  await page.screenshot({path:path.join(artifacts,name+'-native-x68000.png')});await assertNoLiveAudio(page);await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  await changeNativeMode(page,native,'genesis','keep');await page.evaluate(source=>window.__nativeBackendTest.editor.setValue(source),source);await nativeRun(page,native);
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
    // Chip and FX use independent Worker ports. A delivered note does not
    // acknowledge the FX installation on its separate preparation queue.
    await until(()=>native.calls.slice(first).some(call=>call.command==='native_genesis_fx'&&call.args.message.op==='chain'),execution+' Native DX7 FX chain installation');
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
  await nativeRecording(page,native,artifacts,name);
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
  native.monitor.reads.length=0;await nativeAudioMonitor(page,native,artifacts,name+'-nes');await nativeRecording(page,native,artifacts,name);
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
    const mixerStateOnly=process.argv.includes('--mixer-state-only');
    if(fftFixture&&!mixerStateOnly)await compareNativeFft(browser,name,fftFixture);
    if(!mixerStateOnly) {
    const plain = await browser.newContext({serviceWorkers:'block'});
    const normal = await plain.newPage();
    // Exercise the real textarea fallback; external Monaco CDN availability is
    // unrelated to native transport/settings and is not required by this check.
    await normal.route('**/vs/loader*.js', route => route.abort());
    await normal.goto(url);
    await ready(normal);
    assert.equal(await normal.locator('#audioEngineButton').count(), 0);
    await plain.close();
    }
    const context = await browser.newContext({serviceWorkers:'block'}), page = await context.newPage();
    const native = new FakeNative(), errors = [];
    const lifecycle=process.argv.includes('--lifecycle-only')?trackNativeLifecycle(native,page):null;
    native.dx7WasmRequests=[];
    page.on('request',request=>{if(request.url().includes('/msfa_dx7/wasm/msfa.wasm'))native.dx7WasmRequests.push(request.url());});
    await page.exposeBinding('__nativeInvoke', (_event, command, args) => native.invoke(command, args));
    await page.addInitScript(observeAudioCreation);
    await page.addInitScript(observeMonitorDrawing);
    if(lifecycle)await page.addInitScript(observeNativeLifecycle);
    await page.addInitScript(() => {window.__TAURI_INTERNALS__ = {invoke:(command,args) => window.__nativeInvoke(command,args)};});
    await page.route('**/vs/loader*.js', route => route.abort());
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(20000);
    if(mixerStateOnly) {
      const nativeUrl=new URL(url);nativeUrl.searchParams.set('audioEngine','native');
      await page.goto(nativeUrl.href);await ready(page);
      assert.equal(native.count('native_genesis_start'),0,'Mixer restoration must not start the Native backend');
      await runMixerState({page,native,artifacts,name,ready,nativeRun,source,assertNoLiveAudio});
      assert.deepEqual(errors,[]);await context.close();
      console.log(name+': PASS Mixer common defaults, project controls, IndexedDB reload, New Cassette, actual ZIP export/import, malformed JSON preservation and recovery; zero AudioContexts/Worklets, Native IPC mocked');return;
    }
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
    if(process.argv.includes('--primary-lookup-only')) {
      await nativePrimaryLookupRuns(page,native,artifacts,name);
      await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
      assert.deepEqual(errors,[]);await context.close();
      console.log(name+': PASS Native Genesis/Mega CD/32X/32X Nuked borrowed FM/PSG identity, mixer ids, stereo, Main/Worker reuse and Stop/Run; Native IPC mocked');return;
    }
    if(process.argv.includes('--diagnostics-only')) {
      await nativeRecording(page,native,artifacts,name+'-main');
      await page.evaluate(source=>window.__nativeBackendTest.runtime.playSource(source,{execution:'worker'}),source);
      await nativeRecording(page,native,artifacts,name+'-worker');
      await changeNativeMode(page,native,'genesis-full-nuked');
      await page.evaluate(source=>window.__nativeBackendTest.runtime.playSource(source),source);
      await nativeRecording(page,native,artifacts,name+'-nuked');
      await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
      assert.deepEqual(errors,[]);await context.close();console.log(name+': PASS Native Genesis Main/Worker and Nuked recording WAV/JSON with start/end queue, late, overflow, liveFx and transport diagnostic counters; Native IPC mocked');return;
    }
    if(lifecycle) {
      await runNativeLifecycle({page,native,tracker:lifecycle,name,artifacts,modeIds:nativeModeIds,
        changeMode:changeNativeMode,selectEngine,assertNoLiveAudio,until,source,errors});
      await context.close();return;
    }
    if(process.argv.includes('--nuked-only')) {
      await assertNativeModeRestriction(page,native);await nativeNuked(page,native,artifacts,name);assert.deepEqual(errors,[]);
      await fs.writeFile(path.join(artifacts,name+'-native-nuked.json'),JSON.stringify({mockedNative:true,calls:native.calls},null,2));
      await context.close();console.log(name+': PASS Native 32X Nuked and legacy Genesis Nuked Main/Worker starters, FM/PSG/RF/PWM, Keyboard/Operators, scheduling, Stop and mode handoff; Native IPC mocked');return;
    }
    if(process.argv.includes('--ym2203-only')) {
      await nativeYm2203(page,native,artifacts,name);assert.deepEqual(errors,[]);
      await fs.writeFile(path.join(artifacts,name+'-native-ym2203.json'),JSON.stringify({mockedNative:true,calls:native.calls},null,2));
      await context.close();console.log(name+': PASS Native YM2203 Main/Worker, FM3/SSG3 mono, special mode, retained zero levels, Keyboard/Operators, clock/mixer, Stop and mode handoff; Native IPC mocked');return;
    }
    if(process.argv.includes('--game-gear-only')) {
      await nativeGameGear(page,native,artifacts,name);assert.deepEqual(errors,[]);
      await fs.writeFile(path.join(artifacts,name+'-native-game-gear.json'),JSON.stringify({mockedNative:true,calls:native.calls},null,2));
      await context.close();console.log(name+': PASS Native Game Gear Main/Worker, stereo routing, tone/noise, Keyboard/Operators, clock/mixer, Stop/reset and mode handoff; Native IPC mocked');return;
    }
    if(process.argv.includes('--opl-only')) {
      await nativeOpl(page,native,artifacts,name);assert.deepEqual(errors,[]);
      await fs.writeFile(path.join(artifacts,name+'-native-opl.json'),JSON.stringify({mockedNative:true,calls:native.calls},null,2));
      await context.close();console.log(name+': PASS Native DOS PC YM3526/YM3812/YMF262 Main/Worker, banked registers, 2op/4op/rhythm, Keyboard/Operators, clock/mixer, Stop retention and mode handoff; Native IPC mocked');return;
    }
    if(process.argv.includes('--msx-audio-only')) {
      await nativeMsx(page,native,artifacts,name,{audio:true});assert.deepEqual(errors,[]);
      await fs.writeFile(path.join(artifacts,name+'-native-msx-audio.json'),JSON.stringify({mockedNative:true,calls:native.calls},null,2));
      await context.close();console.log(name+': PASS Native MSX Audio Main/Worker, Y8950/OPLL/AY, tone-noise-rhythm-envelope, independent mixers/clocks, Keyboard/Operators, Stop retention and mode handoff; Native IPC mocked');return;
    }
    if(process.argv.includes('--msx-only')) {
      await nativeMsx(page,native,artifacts,name);assert.deepEqual(errors,[]);
      await fs.writeFile(path.join(artifacts,name+'-native-msx.json'),JSON.stringify({mockedNative:true,calls:native.calls},null,2));
      await context.close();console.log(name+': PASS Native MSX Main/Worker, OPLL/AY tone-noise-envelope, retained levels, Keyboard/Operators, independent mixers, Stop retention and mode handoff; Native IPC mocked');return;
    }
    if(process.argv.includes('--master-system-only')) {
      await nativeMasterSystem(page,native,artifacts,name);assert.deepEqual(errors,[]);
      await fs.writeFile(path.join(artifacts,name+'-native-master-system.json'),JSON.stringify({mockedNative:true,calls:native.calls},null,2));
      await context.close();console.log(name+': PASS Native Master System Main/Worker, PSG/OPLL, ROM/User/rhythm, Keyboard/Operators, independent mixers, Stop retention and mode handoff; Native IPC mocked');return;
    }
    if(process.argv.includes('--x68000-only')) {
      await nativeX68000(page,native,artifacts,name);assert.deepEqual(errors,[]);
      await fs.writeFile(path.join(artifacts,name+'-native-x68000.json'),JSON.stringify({mockedNative:true,calls:native.calls},null,2));
      await context.close();console.log(name+': PASS Native X68000 Main/Worker, OPM eight voices, OKI sample preparation, Keyboard/Operators, independent mixers, Stop retention and mode handoff; Native IPC mocked');return;
    }
    if(process.argv.includes('--neogeo-only')) {
      await nativeNeoGeo(page,native,artifacts,name);assert.deepEqual(errors,[]);
      await fs.writeFile(path.join(artifacts,name+'-native-neogeo.json'),JSON.stringify({mockedNative:true,calls:native.calls},null,2));
      await context.close();console.log(name+': PASS Native Neo Geo/YM2610B Main/Worker, A/B ROM isolation, sampler, Keyboard, Operators, Stop retention and mode handoff; Native IPC mocked');return;
    }
    if(process.argv.includes('--pc98-only')) {
      await nativePc98(page,native,artifacts,name);assert.deepEqual(errors,[]);
      await fs.writeFile(path.join(artifacts,name+'-native-pc98.json'),JSON.stringify({mockedNative:true,calls:native.calls},null,2));
      await context.close();console.log(name+': PASS focused Native PC-98 Main/Worker, FM/SSG/rhythm/ADPCM-B sample preparation, Keyboard physical voices, Operators audition, Stop retention and mode handoff; Native IPC mocked');return;
    }
    if(process.argv.includes('--pwm-only')) {
      await native32x(page,native,artifacts,name);
      assert.deepEqual(errors,[]);
      await fs.writeFile(path.join(artifacts,name+'-native-32x.json'),JSON.stringify({mockedNative:true,calls:native.calls},null,2));
      await context.close();console.log(name+': PASS focused Native 32X FM/PSG/RF/PWM Main/Worker, scheduled FIFO writes, register/applied state, mixer, loop removal and ownership, Stop/Run, Keyboard and mode handoff; Native IPC mocked');return;
    }
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
    await nativeRecording(page,native,artifacts,name);
    assert.equal(native.current.session, firstSession, 'Stop/Run should reuse the stream clock');
    await nativeMegaCd(page,native,artifacts,name);
    await native32x(page,native,artifacts,name);
    await nativeNuked(page,native,artifacts,name);
    await nativeDx7(page,native,artifacts,name);
    await nativeNes(page,native,artifacts,name);
    await nativeConsoles(page,native,artifacts,name);
    await nativeYm2203(page,native,artifacts,name);
    await nativePc98(page,native,artifacts,name);
    await nativeNeoGeo(page,native,artifacts,name);
    await nativeX68000(page,native,artifacts,name);
    await nativeGameGear(page,native,artifacts,name);
    await nativeMasterSystem(page,native,artifacts,name);
    await nativeMsx(page,native,artifacts,name);
    await nativeMsx(page,native,artifacts,name,{audio:true});
    await nativeOpl(page,native,artifacts,name);
    await nativePrimaryLookupRuns(page,native,artifacts,name);
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
    // Every listed mode, including Nuked, can now select the Native backend.
    assert.deepEqual(await modeIds(page),allModeIds);
    await page.locator('#mainMenu > summary').click();
    await page.selectOption('#playgroundMode','genesis-full-nuked');
    await page.locator('#changeModeDialog').waitFor({state:'visible'});
    await Promise.all([page.waitForURL(url=>url.searchParams.get('mode')==='genesis-full-nuked'),page.locator('#changeModeDialog').evaluate(dialog=>dialog.close('keep'))]);
    await ready(page);await openSettings(page);
    assert.equal(await page.locator('#audioEngineSelect option[value="native"]').isDisabled(),false);
    await page.locator('#audioEngineDialog').evaluate(dialog=>dialog.close());
    await selectEngine(page,'native');await nativeRun(page,native);
    assert.equal(native.current.mode,'genesis-full-nuked');assert.equal(native.status().engine,'nuked');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(artifacts, name + '-native-settings.json'), JSON.stringify({mockedNative:true, calls:native.calls}, null, 2));
    await context.close();
    console.log(`${name}: PASS Web Audio default, project handoff, Native Genesis/Mega CD/32X/32X Nuked/legacy Genesis Nuked/NES + FDS/DX7 Main/Worker and shipped starters, 32X FM/PSG/RF/PWM scheduled writes/read/state/mixer/loop ownership, actual RF High/Write and NES Raw/Readable/High VGM imports with shared cleanup/RAM retention and PAL guard, RF RAM/loadSample and polyphonic sample Keyboard, NES six-channel Keyboard/Operators/DMC RAM/FDS wave/modulation and Stop retention, DX7 SysEx/live operators/PC and Guitar Keyboard/Operators audition and bank retention, real FLAC decoding, DAC/sample/FX/noise/liveFx, Envelope/Wave/Spectrum and observation lifecycle, loop cancellation, recording, Stop/Run, failure/recovery, unknown-mode rejection and Web Audio/Nuked handoff; no native live AudioContext/Worklet (native IPC mocked)`);
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
