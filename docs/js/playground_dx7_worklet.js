import {createDX7, createInitVoice, createVoiceSysex,parseSysex} from './msfa_dx7/src/index.js';
import {presetToVoice,voiceToPreset,validatePreset,validateOperator,validateOperators} from './msfa_dx7/src/preset.js';
import {createProcessorPerformance} from './playground_performance_processor.js?v=pokey-mode-1';
import {Dx7VoiceInspector} from './playground_dx7_inspector.js?v=pokey-mode-1';
import {receiveChipInspector} from './playground_chip_inspector_state.js?v=pokey-prepare-1';

const errorMessage = error => String(error?.message ?? error);

class Dx7Processor extends AudioWorkletProcessor {
  constructor({processorOptions = {}} = {}) {
    super();
    this.dead = false;
    this.synth = null;
    this.remote = null;
    this.workerRemote = null;
    this.commandGeneration = 0;
    this.stateRevision = 0;
    this.commands = Promise.resolve();
    this.pendingPatches=new Map();this.patchSequence=0;
    this.performance=createProcessorPerformance({chip:'dx7',trackImmediateNotes:false,apply:data=>this.applySound(data),
      validate:data=>this.validatePerformance(data),prepare:(data,port,metadata)=>this.preparePerformance(data,port,metadata),
      onBlocked:(data,port)=>{
        if(this.pendingPatches.delete(data._dx7Pending)){this.rebuildLogical();this.notifyState();}
        if(data.id!==undefined)port.postMessage(data.method==='loadSysex'?{id:data.id,error:'DX7 is held by a manual audition'}:
          {id:data.id,value:this.getLogicalState()});
      },
      onDiscard:data=>{this.pendingPatches.delete(data._dx7Pending);this.rebuildLogical();}});
    this.renderSegment=this.renderSegment.bind(this);
    this.port.onmessage = ({data}) => {
      if (data.primaryWorker) {
        this.retireWorker();
        if (data.port) this.attachRemote(data.port, true);
        return;
      }
      if (data.type === 'detach-chip-port') { this.retireRemote(); return; }
      if (data.port) {
        this.retireRemote();
        this.attachRemote(data.port, false);
      } else this.receive(data, this.port);
    };
    this.initializing = this.initialize(processorOptions.wasmBytes);
  }

  attachRemote(port, worker) {
    if (this.dead) { port.postMessage({fatal:true,error:this.failure});port.close();return; }
    const name=worker?'workerRemote':'remote';this[name]=port;
    port.onmessage=({data})=>{if(this[name]===port)this.receive(data,port);};
    port.onmessageerror=()=>this.fail(new Error('Could not read a DX7 command.'));
    port.start();
  }
  retireRemote() { this.remote?.close();this.remote=null; }
  retireWorker() {
    if (!this.workerRemote) return;
    this.workerRemote.close();this.workerRemote=null;
    const session=this.performance.getStats().activeSession;
    if(session)this.receive({type:'performance-stop',session},this.port);
  }

  stopVoices() {
    this.commandGeneration++;
    this.inspector?.resetAuditions();
    this.performance.clear();
    this.synth?.panic();
    this.inspector?.observe({method:'panic'});
    this.rebuildLogical();
    this.notifyState();
  }

  notifyState() {
    if(!this.synth)return;
    const message={type:'dx7-state',state:this.getLogicalState()};
    for(const port of [this.remote,this.workerRemote])port?.postMessage(message);
  }

  async initialize(wasmBytes) {
    let synth;
    try {
      synth = await createDX7({sampleRate, wasmBytes});
      if (this.dead) { synth.dispose(); return; }
      await synth.loadSysex(createVoiceSysex(createInitVoice()));
      if (this.dead) { synth.dispose(); return; }
      this.synth = synth;
      this.appliedVoices=[createInitVoice()];this.rebuildLogical();
      this.inspector=new Dx7VoiceInspector({sampleRate,internalSampleRate:synth.internalSampleRate,
        getApplied:()=>({selectedVoice:this.synth.selectedVoice,voices:this.appliedVoices}),
        getLogical:()=>({selectedVoice:this.logicalSelected,voices:this.logicalVoices,pendingCommands:this.performance.getStats().queuedCommands}),
        dispatch:(command,owner)=>this.performance.applyImmediate(command,this.port,{owner}),
        beginAudition:(midi,owner)=>this.performance.beginAudition(midi,owner),endAudition:(midi,owner)=>this.performance.endAudition(midi,owner)});
      this.port.postMessage({ready: true, ...this.getState()});
    } catch (error) {
      synth?.dispose();
      this.fail(error);
    }
  }

  getState() {
    return {
      voices: this.synth.voices,
      selectedVoice: this.synth.selectedVoice,
      sampleRate: this.synth.sampleRate,
      internalSampleRate: this.synth.internalSampleRate,
      stateRevision:this.stateRevision,
    };
  }

  rebuildLogical() {
    if(!this.synth||!this.appliedVoices)return;
    this.logicalVoices=this.appliedVoices.map(bytes=>bytes.slice());this.logicalSelected=this.synth.selectedVoice;
    const patches=[...this.pendingPatches.values()].sort((a,b)=>a.time-b.time||a.serial-b.serial);
    for(const patch of patches)this.applyLogical(patch.command);
    this.stateRevision++;
  }
  applyLogical({method,args=[]}) {
    if(method==='selectVoice'){this.logicalSelected=args[0];return;}
    const index=this.logicalSelected,base=this.logicalVoices[index];
    if(method==='setPreset')this.logicalVoices[index]=presetToVoice(args[0]);
    else if(method==='setOperator')this.logicalVoices[index]=presetToVoice({operators:{[args[0]]:args[1]}},base);
    else if(method==='setOperators')this.logicalVoices[index]=presetToVoice({operators:Object.fromEntries(args[0])},base);
    else if(method==='setFeedback')this.logicalVoices[index]=presetToVoice({feedback:args[0]},base);
  }
  getLogicalState() {
    return {...this.getState(),selectedVoice:this.logicalSelected,
      voices:this.logicalVoices.map((bytes,index)=>({index,name:voiceToPreset(bytes).name}))};
  }
  validatePerformance({method,args=[]}) {
    if(this.dead||!this.synth)throw new Error(this.failure??'DX7 processor is not ready.');
    const integer=(value,max,label)=>{if(!Number.isInteger(value)||value<0||value>max)throw new RangeError(`Invalid ${label}`);};
    switch(method){
      case 'setPreset':validatePreset(args[0]);break;
      case 'setOperator':validateOperator(args[0],args[1]);break;
      case 'setOperators':validateOperators(args[0]);break;
      case 'setFeedback':integer(args[0],7,'feedback');break;
      case 'selectVoice':integer(args[0],this.logicalVoices.length-1,'voice index');break;
      case 'noteOn':integer(args[0],127,'note');integer(args[1]??100,127,'velocity');break;
      case 'noteOff':integer(args[0],127,'note');break;
      case 'loadSysex':parseSysex(args[0]);break;
      case 'getState':case 'getPreset':case 'allNotesOff':case 'panic':case 'dispose':break;
      default:throw new Error(`Unknown DX7 command: ${method}`);
    }
  }
  preparePerformance(data,port,metadata) {
    if(this.inspector?.blocked(data)&&['setPreset','setOperator','setOperators','setFeedback','selectVoice','loadSysex'].includes(data.method)){
      if(data.method==='loadSysex')throw new Error('DX7 is held by a manual audition');
      if(data.id!==undefined)port.postMessage({id:data.id,value:this.getLogicalState()});return null;
    }
    if(data.method==='loadSysex'){this.receiveImmediate(data,port);return null;}
    if(data.method==='getState'||data.method==='getPreset'){
      if(data.id!==undefined)port.postMessage({id:data.id,value:data.method==='getState'?this.getLogicalState():voiceToPreset(this.logicalVoices[this.logicalSelected])});
      return null;
    }
    const {id,...command}=data;
    if(['setPreset','setOperator','setOperators','setFeedback','selectVoice'].includes(data.method)){
      command._dx7Pending=++this.patchSequence;
      this.pendingPatches.set(command._dx7Pending,{command,time:metadata.time,serial:this.patchSequence});this.rebuildLogical();
    }
    if(id!==undefined)port.postMessage({id,value:['setPreset','setOperator','setOperators','setFeedback','selectVoice'].includes(data.method)?this.getLogicalState():undefined});
    return command;
  }
  applySound(data) {
    if(this.dead||!this.synth)throw new Error(this.failure??'DX7 processor is not ready.');
    const args=data.args??[];
    switch(data.method){
      case 'setPreset':this.synth.setPreset(args[0]);break;
      case 'setOperator':this.synth.setOperator(args[0],args[1]);break;
      case 'setOperators':this.synth.setOperators(args[0]);break;
      case 'setFeedback':this.synth.setFeedback(args[0]);break;
      case 'selectVoice':this.synth.selectVoice(args[0]);break;
      case 'noteOn':this.synth.noteOn(args[0],args[1]);break;
      case 'noteOff':this.synth.noteOff(args[0]);break;
      case 'allNotesOff':this.synth.allNotesOff();break;
      case 'panic':this.synth.panic();break;
      case 'dispose':this.dispose();return;
      default:throw new Error(`Unknown DX7 command: ${data.method}`);
    }
    this.inspector?.observe(data);
    if(['setPreset','setOperator','setOperators','setFeedback'].includes(data.method)){
      this.appliedVoices[this.synth.selectedVoice]=presetToVoice(this.synth.getPreset());
    }
    this.pendingPatches.delete(data._dx7Pending);
    if(['setPreset','setOperator','setOperators','setFeedback','selectVoice'].includes(data.method)){this.rebuildLogical();this.notifyState();}
  }

  dispose(error = new Error('DX7 instance is disposed.')) {
    if (this.dead) return;
    this.dead = true;
    this.commandGeneration++;
    this.inspector?.resetAuditions();this.performance.clear();
    this.failure = errorMessage(error);
    this.synth?.dispose();
    this.synth = null;
    // Notify direct Worker clients as well as the Main-thread endpoint. This
    // also rejects requests queued behind a pending upload or initialization.
    const message = {fatal: true, error: this.failure};
    this.port.postMessage(message);
    for (const remote of [this.remote,this.workerRemote]) if (remote) {
      remote.postMessage(message);
      remote.onmessage = null;
      remote.onmessageerror = null;
      remote.close();
    }
  }

  fail(error) { this.dispose(error); }

  receive(data, port) {
    if(data?.type==='chip-inspector'&&receiveChipInspector(data,port,this.inspector&&!this.dead?
      (action,method,args)=>action==='read'?this.inspector.read():this.inspector.invoke(method,args):null))return;
    // STOP/disposal must win over initialization and queued asynchronous loads.
    if (data.method === 'dispose') { this.dispose(); return; }
    if (data.method === 'stopVoices' || data.type === 'clear-scheduled-writes') {
      this.stopVoices();if(data.id!==undefined)port.postMessage({id:data.id,value:this.getLogicalState()});return;
    }
    const stop=data.type==='performance-stop'&&Number.isSafeInteger(data.session)&&data.session>0&&data.session>=this.performance.getStats().latestSession;
    if(!data.performance&&this.inspector?.auditions.size&&['allNotesOff','panic'].includes(data.method)){
      this.receiveImmediate(data,port);return;
    }
    if(this.performance.receive(data,port)){
      if(stop)this.stopVoices();
      else if(data.type==='performance-cancel-owner')this.notifyState();
      return;
    }
    this.receiveImmediate(data,port);
  }

  receiveImmediate(data,port) {
    const generation=this.commandGeneration;
    this.commands = this.commands.then(async () => {
      await this.initializing;
      if (this.dead || !this.synth) throw new Error(this.failure ?? 'DX7 processor is not ready.');
      if(generation!==this.commandGeneration)throw new Error('DX7 performance stopped.');
      if(this.inspector?.blocked(data)&&!['allNotesOff','panic'].includes(data.method)){
        if(data.id!==undefined)port.postMessage(data.method==='loadSysex'?{id:data.id,error:'DX7 is held by a manual audition'}:
          {id:data.id,value:this.getLogicalState()});return;
      }
      const args = data.args ?? [];
      let value;
      switch (data.method) {
        case 'loadSysex':
          await this.synth.loadSysex(args[0]);this.appliedVoices=parseSysex(args[0]).voices.map(voice=>voice.data.slice());this.rebuildLogical();this.notifyState();
          value=this.getLogicalState();break;
        case 'getPreset':value=voiceToPreset(this.logicalVoices[this.logicalSelected]);break;
        case 'getState':value=this.getLogicalState();break;
        case 'setPreset':case 'setOperator':case 'setOperators':case 'setFeedback':
          this.performance.applyImmediate({...data,id:undefined},port);value=this.getLogicalState();break;
        case 'selectVoice':this.performance.applyImmediate({...data,id:undefined},port);value=this.getLogicalState();break;
        case 'noteOn':case 'noteOff':case 'allNotesOff':case 'panic':this.performance.applyImmediate({...data,id:undefined},port);break;
        default: throw new Error(`Unknown DX7 command: ${data.method}`);
      }
      if(generation!==this.commandGeneration)throw new Error('DX7 performance stopped.');
      if (data.id !== undefined && !this.dead) port.postMessage({id: data.id, value});
    }).catch(error => {
      if (this.dead) return;
      // A rejected SysEx file preserves the previous usable bank. Synchronous
      // commands have no request promise, so report their failures as fatal.
      if (data.id !== undefined) port.postMessage({id: data.id, error: errorMessage(error)});
      else if(generation===this.commandGeneration)this.fail(error);
    });
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    if (this.dead) {
      if (channels) for (let i = 0; i < channels.length; i++) channels[i].fill(0);
      return false;
    }
    if (!channels?.[0]) return true;
    if (!this.synth) {
      for (let i = 0; i < channels.length; i++) channels[i].fill(0);
      return true;
    }
    try {
      // Write directly into the render quantum. The existing mixer and native
      // final bus expect stereo, so send identical mono PCM to both channels.
      this.performance.render(channels[0],channels[1]??channels[0],this.renderSegment);
      for (let i = 1; i < channels.length; i++) channels[i].set(channels[0]);
      return true;
    } catch (error) {
      for (let i = 0; i < channels.length; i++) channels[i].fill(0);
      this.fail(error);
      return false;
    }
  }

  renderSegment(left,right) {if(!this.synth){left.fill(0);right.fill(0);return;}this.synth.renderInto(left);if(right!==left)right.set(left);}
}

registerProcessor('tetorica-playground-dx7', Dx7Processor);
