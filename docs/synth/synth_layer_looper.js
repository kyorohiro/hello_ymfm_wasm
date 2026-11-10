export const LAYER_LOOP_MIN_SECONDS=.05;
export const LAYER_LOOP_MAX_SECONDS=120;
export const LAYER_LOOP_MAX_UNITS=16;
export const LAYER_LOOP_MAX_PCM_BYTES=128*1024*1024;
const clone=value=>structuredClone(value);
const cancelled=label=>new DOMException(`${label} loop capture cancelled`,'AbortError');

/**
 * Capture semantic chip events, then render each layer independently. The loop
 * period is the performed interval; the PCM can extend past it with its own
 * release. Playback owns repeating/mixing those tails, never this editor voice.
 */
export class SynthLayerLooper {
  constructor({now=()=>performance.now()/1000,setTimer=(fn,delay)=>setTimeout(fn,delay),clearTimer=id=>clearTimeout(id),
    label='Sound',idPrefix='layer',createRecorder,releaseLiveNotes=()=>{},renderRecording,preparePlaybackUnit=()=>{},
    startPlayback=()=>{},addPlaybackUnit=()=>{},removePlaybackUnit=()=>{},stopPlayback=()=>{},onStateChange=()=>{},
    playbackPaddingSeconds=.05,maxUnits=LAYER_LOOP_MAX_UNITS,maxPCMBytes=LAYER_LOOP_MAX_PCM_BYTES,maxTailSeconds=5.01}={}) {
    for(const [name,value] of Object.entries({now,setTimer,clearTimer,createRecorder,releaseLiveNotes,renderRecording,preparePlaybackUnit,
      startPlayback,addPlaybackUnit,removePlaybackUnit,stopPlayback,onStateChange})) {
      if(typeof value!=='function')throw new TypeError(`${label} looper ${name} must be a function`);
    }
    if(!Number.isFinite(playbackPaddingSeconds)||playbackPaddingSeconds<0||playbackPaddingSeconds>1)throw new RangeError(`Invalid ${label} loop padding`);
    if(!Number.isInteger(maxUnits)||maxUnits<1||maxUnits>LAYER_LOOP_MAX_UNITS||!Number.isInteger(maxPCMBytes)||maxPCMBytes<8||maxPCMBytes>LAYER_LOOP_MAX_PCM_BYTES)throw new RangeError(`Invalid ${label} loop resource limit`);
    if(typeof label!=='string'||!label||typeof idPrefix!=='string'||!idPrefix||!Number.isFinite(maxTailSeconds)||maxTailSeconds<0||maxTailSeconds>5.01)throw new TypeError('Invalid layer looper identity or tail');
    Object.assign(this,{label,idPrefix,maxTailSeconds,now,setTimer,clearTimer,releaseLiveNotes,renderRecording,preparePlaybackUnit,startPlayback,
      addPlaybackUnit,removePlaybackUnit,stopPlayback,onStateChange,playbackPaddingSeconds,maxUnits,maxPCMBytes});
    this.running=false;this.recording=false;this.armed=false;
    this.loopLength=this.startedAt=this.loopStartedAt=null;this.currentUnit=null;this.units=[];
    this._epoch=0;this._nextId=1;this._pcmBytes=0;this._capture=null;this._autoTimer=null;
    this._finishing=null;this._renderAbort=null;this._starting=null;this._startAbort=null;this._undoing=null;
    this._recorder=createRecorder({now:()=>this._captureNow()});
  }

  _time() {const value=this.now();if(!Number.isFinite(value)||value<0)throw new RangeError(`Invalid ${this.label} looper clock`);return value;}
  _captureNow() {
    const capture=this._capture;
    return capture?.finishedAt??Math.min(this._time(),capture?.deadline??Infinity);
  }
  _notify(reason,extra={}) {this.onStateChange({reason,...this.getState(),...extra});}
  _clearAutoTimer() {if(this._autoTimer!==null)this.clearTimer(this._autoTimer);this._autoTimer=null;}
  _position(time) {
    if(this.loopLength===null||this.loopStartedAt===null)return 0;
    if(time<=this.loopStartedAt)return 0;
    const position=(time-this.loopStartedAt)%this.loopLength;
    const wrapped=(position+this.loopLength)%this.loopLength;
    return wrapped<1e-7||this.loopLength-wrapped<1e-7?0:wrapped;
  }
  _report(error) {this._notify('record-error',{error});return null;}

  async start() {
    if(this.running)return this;
    if(this._starting)return this._starting;
    const epoch=++this._epoch,abort=new AbortController();this._startAbort=abort;
    this.running=true;this.startedAt=this._time();
    const task=Promise.resolve().then(async()=>{
      try {
        if(this.units.length&&this.loopLength!==null) {
          const units=this.units.slice(),loopLength=this.loopLength;
          for(const unit of units) {
            await this.preparePlaybackUnit(unit,{loopLength,signal:abort.signal});
            if(epoch!==this._epoch||abort.signal.aborted||!this.running)return null;
          }
          this.loopStartedAt=this._time()+this.playbackPaddingSeconds;
          await this.startPlayback({loopLength,startTime:this.loopStartedAt,signal:abort.signal},units);
        }
        if(epoch!==this._epoch||abort.signal.aborted||!this.running)return null;
        this._notify('start');return this;
      } catch(error) {
        if(epoch!==this._epoch||abort.signal.aborted)return null;
        this.running=false;this.startedAt=this.loopStartedAt=null;
        this.stopPlayback();this._notify('error',{error});return null;
      }
    });
    this._starting=task;
    try{return await task;}
    finally {
      if(this._starting===task){this._starting=null;this._notify('ready');}
      if(this._startAbort===abort)this._startAbort=null;
    }
  }

  async startRecording() {
    if(this._finishing)return this._finishing;
    const epoch=this._epoch;
    if(this._starting)await this._starting;
    if(this._undoing)await this._undoing;
    if(epoch!==this._epoch)return null;
    if(!this.running)throw new Error(`Start the ${this.label} looper before recording`);
    if(this.recording)return this.currentUnit;
    if(this.units.length>=this.maxUnits)return this._report(new Error(`${this.label} loop layer limit reached. Undo or Clear a layer first.`));
    const time=this._time(),offsetSeconds=this._position(time);
    const remaining=this.loopLength===null?LAYER_LOOP_MAX_SECONDS:this.loopLength-offsetSeconds;
    const capture={id:`${this.idPrefix}-unit-${this._nextId++}`,startedAt:time,offsetSeconds,
      deadline:time+remaining,finishedAt:null,closing:false,epoch:this._epoch,events:[]};
    this._capture=this.currentUnit=capture;
    try {
      this._recorder.startRecord();this.recording=true;
      this._autoTimer=this.setTimer(()=>{this._autoTimer=null;void this.finishRecording({auto:true});},Math.max(0,remaining*1000));
      this._notify('record-start');return capture;
    } catch(error) {this._capture=this.currentUnit=null;this.recording=false;this._clearAutoTimer();return this._report(error);}
  }

  captureCommand(command) {
    const capture=this._capture;
    if(!this.recording||!capture)return false;
    if(!capture.closing&&this._time()>=capture.deadline) {void this.finishRecording({auto:true});return false;}
    try {
      const applied=this._recorder.recordCommand(command);
      if(applied&&(command.type==='noteOn'||command.type==='noteOff'))capture.events.push({...command});
      return applied;
    } catch(error) {
      this._cancelCapture();this._report(error);return false;
    }
  }

  toggleRecord() {return this._finishing??this._undoing??(this.recording?this.finishRecording():this.startRecording());}

  finishRecording({auto=false}={}) {
    if(this._finishing)return this._finishing;
    const capture=this._capture;
    if(!this.recording||!capture)return Promise.resolve(null);
    capture.closing=true;capture.finishedAt=Math.min(this._time(),capture.deadline);this._clearAutoTimer();
    let recording;
    try {this.releaseLiveNotes();recording=this._recorder.stopRecord();}
    catch(error) {this._capture=this.currentUnit=null;this.recording=false;return Promise.resolve(this._report(error));}
    this._capture=this.currentUnit=null;this.recording=false;
    if(!recording.commands.some(command=>command.type==='noteOn')) {
      this._notify('record-empty',{auto});return Promise.resolve(null);
    }
    const epoch=this._epoch,abort=new AbortController();this._renderAbort=abort;
    const task=Promise.resolve().then(async()=>{
      let attemptedUnit=null,startingNewLoop=false;
      try {
        abort.signal.throwIfAborted();
        const pcm=await this.renderRecording(recording,{signal:abort.signal});
        if(epoch!==this._epoch||abort.signal.aborted||!this.running)return null;
        if(!(pcm?.left instanceof Float32Array)||!(pcm.right instanceof Float32Array)||pcm.left.length!==pcm.right.length||!pcm.left.length||
          !Number.isInteger(pcm.sampleRate)||pcm.sampleRate<8000||pcm.sampleRate>192000||
          pcm.left.length>Math.ceil((LAYER_LOOP_MAX_SECONDS+this.maxTailSeconds)*pcm.sampleRate)||!pcm.left.every(Number.isFinite)||!pcm.right.every(Number.isFinite)) {
          throw new Error(`Invalid rendered ${this.label} loop audio`);
        }
        const byteLength=pcm.left.byteLength+pcm.right.byteLength;
        if(this._pcmBytes+byteLength>this.maxPCMBytes)throw new Error(`${this.label} loop audio memory limit reached. Undo or Clear a layer first.`);
        const unit=Object.freeze({id:capture.id,left:pcm.left,right:pcm.right,sampleRate:pcm.sampleRate,
          offsetSeconds:capture.offsetSeconds,recording:clone(recording),audioDuration:pcm.left.length/pcm.sampleRate,byteLength,muted:false});
        startingNewLoop=this.loopLength===null;
        const loopLength=startingNewLoop
          ?Math.max(LAYER_LOOP_MIN_SECONDS,Math.min(LAYER_LOOP_MAX_SECONDS,capture.finishedAt-capture.startedAt)):this.loopLength;
        await this.preparePlaybackUnit(unit,{loopLength,signal:abort.signal});
        if(epoch!==this._epoch||abort.signal.aborted||!this.running)return null;
        attemptedUnit=unit;
        if(startingNewLoop) {
          const startTime=this._time()+this.playbackPaddingSeconds;
          await this.startPlayback({loopLength,startTime,signal:abort.signal},[unit]);
          if(epoch!==this._epoch||abort.signal.aborted||!this.running)return null;
          this.loopLength=loopLength;this.loopStartedAt=startTime;
        } else {
          await this.addPlaybackUnit(unit,{signal:abort.signal});
          if(epoch!==this._epoch||abort.signal.aborted||!this.running)return null;
        }
        this.units.push(unit);this._pcmBytes+=byteLength;
        this._notify('record-finish',{unit,auto});return unit;
      } catch(error) {
        if(epoch!==this._epoch||abort.signal.aborted||error?.name==='AbortError')return null;
        if(attemptedUnit) {
          try {if(startingNewLoop)this.stopPlayback();else await this.removePlaybackUnit(attemptedUnit);}catch {}
        }
        return this._report(error);
      }
    });
    this._finishing=task;this._notify('record-finalize',{auto});
    task.finally(()=>{
      if(this._finishing===task){this._finishing=null;this._renderAbort=null;this._notify('record-ready');}
    });
    return task;
  }

  _cancelCapture() {
    this._clearAutoTimer();this._capture=this.currentUnit=null;this.recording=false;
    if(this._recorder.isRecording())this._recorder.stopRecord();
    this.releaseLiveNotes();
  }

  stop() {
    ++this._epoch;this.running=false;
    this._startAbort?.abort(cancelled(this.label));this._startAbort=null;this._starting=null;
    this._renderAbort?.abort(cancelled(this.label));this._renderAbort=null;this._finishing=null;
    this._undoing=null;
    this.stopPlayback();this._cancelCapture();this.startedAt=this.loopStartedAt=null;
    this._notify('stop');return Promise.resolve(this);
  }

  undo() {
    if(this._undoing)return this._undoing;
    if(this._starting) {
      ++this._epoch;this._startAbort?.abort(cancelled(this.label));this._startAbort=null;this._starting=null;
      this.running=false;this.startedAt=this.loopStartedAt=null;this.stopPlayback();this._notify('stop');
    }
    if(this.recording||this._finishing) {
      const id=this.currentUnit?.id??null;++this._epoch;
      this._renderAbort?.abort(cancelled(this.label));this._renderAbort=null;this._finishing=null;
      this._cancelCapture();this._notify('record-cancel',{unit:id?{id}:null});return Promise.resolve({type:'record-cancel',id});
    }
    const unit=this.units.at(-1),epoch=this._epoch;if(!unit)return Promise.resolve(null);
    const task=Promise.resolve().then(async()=>{
      try {await this.removePlaybackUnit(unit);}
      catch(error) {return this._report(error);}
      if(epoch!==this._epoch||this.units.at(-1)!==unit)return null;
      this.units.pop();this._pcmBytes-=unit.byteLength;
      if(!this.units.length) {this.stopPlayback();this.loopLength=this.loopStartedAt=null;}
      this._notify('undo',{unit});return unit;
    });
    this._undoing=task;
    task.finally(()=>{if(this._undoing===task){this._undoing=null;this._notify('ready');}});
    return task;
  }

  async clear() {
    this.stop();this.units=[];this._pcmBytes=0;this.loopLength=this.loopStartedAt=null;
    this._notify('clear');return this;
  }

  getState() {
    const rendering=Boolean(this._finishing);
    return {running:this.running,recording:this.recording,armed:false,rendering,busy:rendering||Boolean(this._starting)||Boolean(this._undoing),
      loopLength:this.loopLength,startedAt:this.startedAt,loopStartedAt:this.loopStartedAt,currentUnitId:this.currentUnit?.id??null,
      unitCount:this.units.length,canUndo:this.recording||rendering||this.units.length>0,pcmBytes:this._pcmBytes,
      units:this.units.map(unit=>({id:unit.id,muted:false,hasAudio:true,hasPatch:true,eventCount:unit.recording.commands.length,
        offsetSeconds:unit.offsetSeconds,audioDuration:unit.audioDuration}))};
  }

  /** PCM stays owned by this controller; transports must clone before transfer. */
  getUnits() {return this.units.map(unit=>({...unit,recording:clone(unit.recording)}));}
}
