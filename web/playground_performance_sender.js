/** Worker command timestamps share the AudioContext clock captured by Main.
 * This is a transport lead, independent of beat/DAC scheduling and sample rate.
 */
/** Default script lead; UI audition bypasses this transport. In seconds. */
export const DEFAULT_WORKER_LOOKAHEAD_SECONDS = 0.5;
const timelineUploadMethods=new Set(['beginTimelineUpload','appendTimelineChunk','commitTimelineUpload','abortTimelineUpload']);

export function validateWorkerLookahead(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 2) {
    throw new RangeError('workerLookaheadSeconds must be between 0 and 2 seconds');
  }
  return seconds;
}

// These commands already contain an explicit audio/sample timeline, or prepare
// resources without starting playback. Never add the performance lead twice.
function immediate(command, kind) {
  if (kind === 'chip') {
    if (command.type === 'pcm-dac') return command.command.action === 'load' ||
      command.command.action === 'remove' || command.command.when !== undefined;
    return ['loadRhythmRom', 'loadAdpcmMemory', 'schedule-writes', 'clear-scheduled-writes', 'load-dac-bank', 'play-dac-bank',
      'clear-dac-playback', 'begin-sample-schedule', 'reset-sample-schedule',
      'sample-writes', 'sample-dac-bank'].includes(command.type);
  }
  if (kind === 'fx') return command.op === 'sample' && command.action === 'load';
  return timelineUploadMethods.has(command.method)||['stopTimeline', 'getTimelineState', 'loadBRR', 'readDsp', 'snapshot', 'loadSysex', 'memory', 'rom', 'loadMemory', 'prepareTimeline', 'getState',
    'getPreset', 'read', 'status', 'getIrq'].includes(command.method);
}

export function createPerformanceSender({getLoop = () => null, restoreLoop = () => {}, onCancelOwner = () => {},
  leaseUntimed = false,
  now = () => (performance.timeOrigin ?? 0) + performance.now()} = {}) {
  const ports = new Map();
  let configuration = null, stopped = false, bypass = 0;
  const canceled = new Set();
  const timestamp = () => configuration && !stopped ? {
    session: configuration.session,
    owner: getLoop()?.performanceOwner ?? 'script',
    time: Math.max(0, configuration.audioSeconds +
      (now() - configuration.performanceEpochMs) / 1000 + configuration.lookaheadSeconds),
  } : null;
  function configure(next) {
    if (next == null) { configuration = null; stopped = false; canceled.clear(); return; }
    if (!Number.isSafeInteger(next.session) || next.session <= 0 ||
        !Number.isFinite(next.audioSeconds) || next.audioSeconds < 0 ||
        !Number.isFinite(next.performanceEpochMs)) throw new TypeError('Invalid performance clock');
    validateWorkerLookahead(next.lookaheadSeconds);
    if (configuration?.session === next.session && !stopped) return;
    configuration = {...next}; stopped = false; canceled.clear();
  }
  function send(port, kind, data, transfer) {
    const untimed = () => {
      if (!leaseUntimed || !configuration) {port.postMessage(data,transfer);return;}
      const loop=getLoop();
      const owner=loop?.keyboard?'keyboard':loop?.performanceOwner??'script';
      port.postMessage({nativePerformance:{session:configuration.session,owner},commands:Array.isArray(data)?data:[data]},transfer);
    };
    // Return observation storage even after an owner is cancelled. This carries
    // no audio command; the SPC Worklet checks its epoch/sequence separately.
    if (kind === 'spc' && (data?.method === 'eventAck'||data?.method==='dispose'&&data.nativeSpcCleanup===true||data?.method==='observe'&&data.nativeSpcObservation===true)) {port.postMessage(data,transfer); return;}
    // SPC has its own song clock, including calls from a musical Keyboard
    // callback. Preserve the owner without adding a nativePerformance wrapper.
    if(kind==='spc'){
      if(Array.isArray(data))throw new TypeError('SPC controls must be individual commands');
      const loop=getLoop(),owner=loop?.keyboard?'keyboard':loop?.performanceOwner??'script';
      if(stopped||loop?.stopped||canceled.has(owner)){if(data.id!==undefined)throw new DOMException('Run stopped','AbortError');return;}
      port.postMessage(configuration?{...data,spcPerformance:{session:configuration.session,owner}}:data,transfer);return;
    }
    const interactive = getLoop();
    if (interactive?.keyboard) {
      if (interactive.stopped) throw new DOMException('Run stopped','AbortError');
      // This lease follows acknowledged instrument RPCs through awaits. Only
      // interactive input skips the script lead; sibling liveLoops keep theirs.
      untimed();return;
    }
    if (bypass || !configuration) { untimed(); return; }
    const loop = getLoop(), owner = loop?.performanceOwner ?? 'script';
    let commands = Array.isArray(data) ? data : [data];
    if (stopped || loop?.stopped || canceled.has(owner)) {
      // Worklet owner cancellation releases only that owner's audible voices.
      // A late finally must not release a newer performance's replacement note.
      if (commands.some(command => command.id !== undefined)) throw new DOMException('Run stopped', 'AbortError');
      return;
    }
    const {time} = timestamp();
    if (transfer?.length && commands.length > 1 && commands.some(command => immediate(command, kind))) {
      // A transfer list can be consumed only once. Mixed prep/performance
      // batches are rare; copy their moved payload before splitting messages.
      data = structuredClone(data, {transfer}); transfer = undefined;
      commands = Array.isArray(data) ? data : [data];
    }
    // Preserve contiguous register batches and ordering across timed/prep groups.
    let pending = [];
    const flush = () => {
      if (!pending.length) return;
      port.postMessage({performance: {session: configuration.session, owner, time}, commands: pending}, transfer);
      pending = [];
    };
    for (const command of commands) {
      if (immediate(command, kind)) {
        flush();
        if(leaseUntimed)port.postMessage({nativePerformance:{session:configuration.session,owner},commands:[command]},transfer);
        else if(timelineUploadMethods.has(command.method))port.postMessage({performance:{session:configuration.session,owner,time},commands:[command]},transfer);
        else port.postMessage(Array.isArray(data) ? [command] : command, transfer);
      }
      else pending.push(command);
    }
    flush();
  }
  return {
    configure,
    timestamp,
    /** A MessagePort facade keeps client RPC and event ownership unchanged. */
    port(port, kind) {
      if (ports.has(port)) return ports.get(port);
      const requests = new Map(), listeners = new Map();
      let onmessage = null, closeTimer = null;
      const close = () => { ports.delete(port); port.close?.(); };
      const receive = fn => event => {
        if (requests.has(event.data?.id)) {
          const loop = requests.get(event.data.id); requests.delete(event.data.id);
          restoreLoop(loop);
        }
        fn?.(event);
      };
      const facade = {
        postMessage(data, transfer) {
          const commands = Array.isArray(data) ? data : [data];
          for (const command of commands) if (command.id !== undefined) requests.set(command.id, getLoop());
          try { send(port, kind, data, transfer); }
          catch (error) { for (const command of commands) requests.delete(command.id); throw error; }
        },
        get onmessage() { return onmessage; }, set onmessage(fn) { onmessage = fn; port.onmessage = receive(fn); },
        get onmessageerror() { return port.onmessageerror; }, set onmessageerror(fn) { port.onmessageerror = fn; },
        start: () => port.start?.(), close: () => {
          if (closeTimer !== null) return;
          if (!configuration || stopped || kind === 'spc') { close(); return; }
          // Clients dispose synchronously, but their final audio commands are
          // still reserved. Keep this control lease until those commands render
          // so a removed loop can cancel them without waiting for Main's UI.
          closeTimer = setTimeout(close, configuration.lookaheadSeconds * 1000 + 50);
        },
      };
      if (port.addEventListener) {
        facade.addEventListener = (type, fn, options) => {
          let wrapped = listeners.get(fn);
          if (!wrapped) { wrapped = receive(fn); listeners.set(fn, wrapped); }
          port.addEventListener(type, wrapped, options);
        };
        facade.removeEventListener = (type, fn, options) => {
          port.removeEventListener(type, listeners.get(fn) ?? fn, options); listeners.delete(fn);
        };
      }
      ports.set(port, facade);
      return facade;
    },
    cancelOwner(owner) {
      if (!configuration || !owner || canceled.has(owner)) return;
      canceled.add(owner);
      for (const port of ports.keys()) port.postMessage({type: 'performance-cancel-owner', session: configuration.session, owner});
      onCancelOwner({session: configuration.session, owner});
    },
    stop() {
      stopped = true;
      if (configuration) for (const port of ports.keys()) {
        port.postMessage({type: 'performance-stop', session: configuration.session});
      }
    },
    immediateCleanup(fn) { bypass++; try { return fn(); } finally { bypass--; } },
  };
}
