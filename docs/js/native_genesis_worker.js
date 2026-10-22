/** Real MessagePorts connect the existing logic Worker to the native transport.
 * Only commands and one-off sample preparation cross this bridge, never audio
 * blocks. Chip and FX share one performance clock and bounded owner registry. */
let fallbackNoiseNamespace = 0;
export function createNativeGenesisWorkerBridge({synth, MessageChannelClass = MessageChannel, onError = () => {}, maxPending = 65536}) {
  if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 65536) throw new RangeError('Invalid Native Worker queue limit');
  // A new Worker can reuse logical slot/token IDs. Give its noise controller a
  // trusted identity independent of Main and previous Worker instances.
  const noiseNamespace = synth.allocateNoiseNamespace?.() ?? ++fallbackNoiseNamespace;
  if (!Number.isSafeInteger(noiseNamespace) || noiseNamespace < 1) throw new RangeError('Invalid Native Worker noise namespace');
  const admin = new MessageChannelClass(), chip = new MessageChannelClass(), fx = new MessageChannelClass();
  const pwm=synth.pwm?new MessageChannelClass():null;
  const pcm=synth.pcm?new MessageChannelClass():null;
  const dx7=synth.dx7?new MessageChannelClass():null;
  const nes=synth.nes?new MessageChannelClass():null;
  const consoles = new Map(['gameboy','snes','huc6280','ym2151','okim6258','segapsg','ym2413','ay8910','ym3526','ym3812','ymf262'].filter(name => synth[name]).map(name => [name,new MessageChannelClass()]));
  const ports = [admin.port1, chip.port1, fx.port1,...(pwm?[pwm.port1]:[]),...(pcm?[pcm.port1]:[]),...(dx7?[dx7.port1]:[]),...(nes?[nes.port1]:[]),...Array.from(consoles.values(),channel=>channel.port1)];
  let serial = Promise.resolve(), active = null, epoch = 0, pending = 0, pendingMessages = 0, pendingBytes = 0, disposed = false;
  const owners = new Map(), cancelled = new Set();
  const abort = () => new DOMException('Native Worker performance was stopped', 'AbortError');
  const validSession = value => Number.isSafeInteger(value) && value > 0;
  function ownerId(owner) {
    if (typeof owner !== 'string' || !owner.length || owner.length > 256) throw new TypeError('Invalid Native Worker owner');
    if (!owners.has(owner)) {
      if (owners.size >= 512) throw new RangeError('Native Worker owner limit exceeded');
      owners.set(owner, owners.size + 1);
    }
    return owners.get(owner);
  }
  function replyError(port, message, error) {
    if (message?.id === undefined) return false;
    const detail = String(error.message ?? error);
    if (message.type === 'pcm-dac') port.postMessage({type:'pcm-dac-result',id:message.id,error:detail});
    else if (message.type === 'loadAdpcmMemory') port.postMessage({type:'adpcm-memory-loaded',id:message.id,error:detail});
    else if (message.type === 'loadRhythmRom') port.postMessage({type:'rhythm-rom-loaded',id:message.id,error:detail});
    else if (message.type === 'chip-clock') port.postMessage({type:'chip-clock-result',id:message.id,error:detail});
    else if (message.op === 'sample') port.postMessage({op:'sample-response',id:message.id,error:detail});
    else if (typeof message.method==='string') port.postMessage({id:message.id,error:detail});
    else return false;
    return true;
  }
  function enqueue(task, count, fail, bytes = 0) {
    if (count && (pending + count > maxPending || pendingMessages >= 2048 || pendingBytes + bytes > 64 * 1024 * 1024)) { fail(new RangeError('Native Worker command queue is full')); return; }
    pending += count; pendingMessages++; pendingBytes += bytes;
    const result = serial.then(task);
    serial = result.catch(error => { fail(error); }).finally(() => { pending -= count; pendingMessages--; pendingBytes -= bytes; });
  }
  function control(port, message) {
    if (!validSession(message.session)) throw new TypeError('Invalid Native Worker performance');
    const performance = message.session;
    if (message.type === 'performance-start') {
      const version = ++epoch; active = performance; owners.clear(); cancelled.clear();
      enqueue(async () => {
        if (disposed || version !== epoch) throw abort();
        await synth.setNativePerformance({op:'start',performance});
        if (disposed || version !== epoch) throw abort();
        port.postMessage({type:'performance-result',id:message.id});
      }, 1, error => port.postMessage({type:'performance-result',id:message.id,error:String(error.message ?? error)}));
    } else if (message.type === 'performance-stop') {
      if (active !== performance) return;
      active = null; ++epoch;
      enqueue(() => synth.setNativePerformance({op:'stop',performance}), 0, error => { if (!disposed && error.name !== 'AbortError') onError(error); });
    } else if (message.type === 'performance-cancel-owner') {
      if (active !== performance || cancelled.has(message.owner)) return;
      const owner = ownerId(message.owner); cancelled.add(message.owner);
      enqueue(() => synth.setNativePerformance({op:'cancel-owner',performance,owner}), 0, error => { if (!disposed && error.name !== 'AbortError') onError(error); });
    }
  }
  function receive(port, kind, message) {
    if (disposed || !message) return;
    try {
      if (message.type?.startsWith('performance-')) { control(port,message); return; }
      const cleanup = message.nativeNoiseCleanup;
      if ([message.performance,message.nativePerformance,cleanup].filter(Boolean).length > 1) throw new TypeError('Native Worker command has two performance leases');
      const envelope = message.performance ?? message.nativePerformance ?? cleanup;
      const messages = envelope ? message.commands : Array.isArray(message) ? message : [message];
      if (!Array.isArray(messages) || !messages.length) throw new TypeError('Native Worker commands must be a non-empty array');
      // Loop retirement is already scoped by the Worker's voice ownership
      // wrapper. It must survive cancel-owner arriving first on another port,
      // while keeping the session fence and the bridge's trusted namespace.
      if (cleanup && (kind !== 'fx' || messages.some(command => command.op !== 'noise' ||
          !['stop','retire'].includes(command.action) || !Number.isInteger(command.slot) || command.slot < 0 || command.slot >= 32 ||
          !Number.isSafeInteger(command.token) || command.token < 1))) throw new TypeError('Invalid Native Worker noise cleanup');
      const version = epoch;
      const timing = {};
      if (envelope) {
        if (envelope.session !== active || !validSession(envelope.session) ||
            message.performance && (!Number.isFinite(envelope.time) || envelope.time < 0)) throw abort();
        if(message.performance)timing.time=envelope.time;
        const owner = ownerId(envelope.owner);
        if (!cleanup) { timing.performance = envelope.session; timing.owner = owner; }
      }
      // A sample upload may await several native flushes inside one dispatch.
      // Cancellation fences its remaining chunks immediately, before the
      // queued native cancel command can run after that dispatch returns.
      Object.defineProperty(timing, 'checkCurrent', {value: () => {
        if (!active || disposed || version !== epoch ||
            (envelope && !cleanup && cancelled.has(envelope.owner))) throw abort();
      }});
      const failed = error => {
        let replied = false;
        for (const command of messages) replied = replyError(port,command,error) || replied;
        if (!replied && error.name !== 'AbortError' && !disposed) onError(error);
      };
      // Include nested register schedules and retained sample payloads in the
      // admission limit while an earlier native IPC is still in flight.
      const count = messages.reduce((sum,m) => sum + Math.max(1,m.entries?.length ?? 0),0);
      // Structured cloning a small typed-array view retains its whole backing
      // buffer. Account for retained storage, rather than only the view length.
      const bytesOf = data => Array.isArray(data) ? data.length * 8 :
        ArrayBuffer.isView(data) ? data.buffer.byteLength : data?.byteLength ?? 0;
      const bytes = messages.reduce((sum,m) => sum + bytesOf(m.data) + bytesOf(m.bytes) + bytesOf(m.command?.data) +
        (m.method==='scheduleWrites'?(m.args?.[0]?.length??0)*24:0) +
        (m.method==='loadMemory'?bytesOf(m.args?.[0]):0) +
        (m.method==='memory'?bytesOf(m.args?.[synth.nativeOpnb?1:0]):0) +
        (m.method==='rom'?bytesOf(m.args?.[0]):0) +
        (m.method==='loadBRR'?bytesOf(m.args?.[0]):0) +
        (m.method==='prepareTimeline'?bytesOf(m.args?.[0]?.events)+bytesOf(m.args?.[0]?.initialState?.ram)+bytesOf(m.args?.[0]?.initialState?.dsp):0) +
        (m.method==='loadSysex'?bytesOf(m.args?.[0]):0) +
        (m.pcm?.channels?.reduce((total,channel) => total + bytesOf(channel),0) ?? 0),0);
      enqueue(async () => {
        // Stop invalidates already queued work immediately, including the
        // Worker's ordinary untimed cleanup after performance-stop.
        if (!active || disposed || version !== epoch || (envelope && !cleanup && cancelled.has(envelope.owner))) throw abort();
        if (kind === 'chip' && messages.length > 1 && messages.every(m => ['write','psg-write','psg-stereo','reset'].includes(m.type))) {
          await synth.dispatchNativeCommand(messages,timing);
        } else for (const command of messages) {
          if (disposed || version !== epoch || (envelope && !cleanup && cancelled.has(envelope.owner))) throw abort();
          const result = kind === 'fx' ? await synth.dispatchNativeFxCommand(command,
            command.op === 'noise' ? {...timing,noiseNamespace} : timing) : kind==='pwm'?await synth.dispatchNativePwmCommand(command,timing):kind==='pcm'?await synth.dispatchNativePcmCommand(command,timing):kind==='dx7'?await synth.dispatchNativeDx7Command(command,timing):kind==='nes'?await synth.dispatchNativeNesCommand(command,timing):kind==='snes'?await synth.dispatchNativeSnesCommand(command,timing):consoles.has(kind)?await synth.dispatchNativeConsoleCommand(kind,command,timing):await synth.dispatchNativeCommand(command,timing);
          // Timeline playback acknowledges its audible end asynchronously.
          // Keep this FIFO free so stopTimeline and cancellation can arrive.
          if (result?.deferred) Promise.resolve(result.deferred).then(reply=>{
            if (!disposed && reply) port.postMessage(reply);
          }).catch(error=>{if(!disposed&&!replyError(port,command,error)&&error.name!=='AbortError')onError(error);});
          else if (result) port.postMessage(result);
        }
      }, count, failed, bytes);
    } catch (error) {
      const messages = message.commands ?? (Array.isArray(message) ? message : [message]);
      let replied = false;
      if (Array.isArray(messages)) for (const command of messages) replied = replyError(port,command,error) || replied;
      if (!replied && error.name !== 'AbortError') onError(error);
    }
  }
  for (const [port,kind] of [[admin.port1,'admin'],[chip.port1,'chip'],[fx.port1,'fx'],...(pwm?[[pwm.port1,'pwm']]:[]),...(pcm?[[pcm.port1,'pcm']]:[]),...(dx7?[[dx7.port1,'dx7']]:[]),...(nes?[[nes.port1,'nes']]:[]),...Array.from(consoles,([name,channel])=>[channel.port1,name])]) {
    port.onmessage = ({data}) => receive(port,kind,data); port.start?.();
  }
  return {
    port:admin.port2, chipPort:chip.port2, fxPort:fx.port2,pwmPort:pwm?.port2??null,pcmPort:pcm?.port2??null,dx7Port:dx7?.port2??null,nesPort:nes?.port2??null,
    gameboyPort:consoles.get('gameboy')?.port2??null,snesPort:consoles.get('snes')?.port2??null,huc6280Port:consoles.get('huc6280')?.port2??null,ym2151Port:consoles.get('ym2151')?.port2??null,okim6258Port:consoles.get('okim6258')?.port2??null,segapsgPort:consoles.get('segapsg')?.port2??null,ym2413Port:consoles.get('ym2413')?.port2??null,ay8910Port:consoles.get('ay8910')?.port2??null,ym3526Port:consoles.get('ym3526')?.port2??null,ym3812Port:consoles.get('ym3812')?.port2??null,ymf262Port:consoles.get('ymf262')?.port2??null,
    dispose() {
      if (disposed) return serial;
      disposed = true; const performance = active; active = null; ++epoch;
      for (const port of [...ports,admin.port2,chip.port2,fx.port2,...(pwm?[pwm.port2]:[]),...(pcm?[pcm.port2]:[]),...(dx7?[dx7.port2]:[]),...(nes?[nes.port2]:[]),...Array.from(consoles.values(),channel=>channel.port2)]) port.close();
      const result = serial.then(() => performance === null ? undefined : synth.setNativePerformance({op:'stop',performance}));
      serial = result.catch(() => {});
      return result;
    },
  };
}
