import {SidCore} from './sid.js';
import {SidSynth, validateSidClock, SID_PAL_CLOCK} from './sidsynth.js';
import {createProcessorPerformance, performanceNoteRelease} from './playground_performance_processor.js';
import {SidVoiceInspector, receiveSidInspector} from './playground_sid_inspector.js';

class SidProcessor extends AudioWorkletProcessor {
  constructor({processorOptions: {clock = SID_PAL_CLOCK, model = '6581', wasmBinary}}) {
    super(); this.clock = validateSidClock(clock); this.core = null; this.synth = null; this.dead = false;
    this.performance = createProcessorPerformance({chip: 'sid', validate: data => this.validateCommand(data),
      immediate: ['stopVoices', 'readRegister', 'getState'],
      prepare: (data, port) => {
        if (['stopVoices', 'readRegister', 'getState'].includes(data.method)) { this.apply(data, port); return null; }
        if (data.id === undefined) return data;
        const {id, ...command} = data; port.postMessage({id, value: true}); return command;
      },
      releaseNote: key => performanceNoteRelease('sid', key), apply: (data, port) => this.apply(data, port)});
    this.renderSegment = this.renderSegment.bind(this);
    this.port.onmessage = ({data}) => {
      if (data.primaryWorker) {
        if (this.workerRemote) this.retirePort('workerRemote');
        if (data.port) this.attachPort('workerRemote', data.port);
      } else if (data.type === 'detach-chip-port') this.retirePort('remote');
      else if (data.port) { if (this.remote) this.retirePort('remote'); this.attachPort('remote', data.port); }
      else this.receive(data, this.port);
    };
    Promise.resolve().then(() => {
      if (model !== '6581') throw new RangeError('Only SID model 6581 is supported');
      return SidCore.create({sampleRate, clockHz: this.clock, wasmBinary});
    }).then(core => {
      if (this.dead) { core.dispose(); return; }
      this.core = core; this.synth = new SidSynth({core});
      this.inspector = new SidVoiceInspector({synth: this.synth, sampleRate});
      this.port.postMessage({ready: true, clock: this.clock, model: '6581'});
    }).catch(error => { this.dispose(); this.port.postMessage({error: error.message}); });
  }
  attachPort(name, port) {
    if (this.dead) { port.close(); return; }
    this[name] = port;
    port.onmessage = event => { if (this[name] === port) this.receive(event.data, port); };
    port.start();
  }
  retirePort(name) {
    this[name]?.close(); this[name] = null;
    this.performance.clear(); this.stopVoices();
  }
  dispose() {
    if (this.dead) return;
    this.dead = true; this.performance.clear(); this.synth?.dispose(); this.core?.dispose();
    this.synth = null; this.core = null; this.remote?.close(); this.workerRemote?.close();
    this.remote = null; this.workerRemote = null;
  }
  validateCommand(data) {
    if (data.method === 'clock' || data.type === 'chip-clock') {
      const clock = validateSidClock(data.clock ?? data.args?.[0]);
      if (clock !== this.clock) throw new RangeError('Create a new SID instance to change its clock');
    }
    if (data.method === 'writeRegister') {
      const [register, value] = data.args ?? [];
      if (!Number.isInteger(register) || register < 0 || register > 31 || !Number.isInteger(value) || value < 0 || value > 255) throw new RangeError('Invalid SID register write');
    }
    if (['forceKeyOff', 'keyOff'].includes(data.method)) {
      const channel = data.args?.[0];
      if (!Number.isInteger(channel) || channel < 0 || channel > 2) throw new RangeError('SID channel must be 0..2');
    }
  }
  receive(data, port = this.port) {
    if (Array.isArray(data)) { for (const command of data) this.receive(command, port); return; }
    if (receiveSidInspector(data, port, this.inspector)) return;
    const stopping = data?.type === 'performance-stop' && Number.isSafeInteger(data.session) && data.session > 0 && data.session >= this.performance.getStats().latestSession;
    const replacing = data?.type === 'performance-start' && Number.isSafeInteger(data.session) && data.session > this.performance.getStats().latestSession;
    if (this.performance.receive(data, port)) { if (stopping || replacing) { this.stopVoices(); this.performance.clear(); } return; }
    this.apply(data, port);
  }
  forceKeyOff(channel) { this.synth.keyOff(channel); }
  /** Transport Stop flushes queued PCM/envelopes/DC tail while retaining the
   * applied patch. Ordinary keyOff only releases the hardware Gate. */
  stopVoices() {
    if (!this.synth) return;
    const state = this.synth._getState();
    for (let ch = 0; ch < 3; ++ch) state.registers[ch * 7 + 4] &= 254;
    this.synth.reset();
    for (let register = 0; register < 32; ++register) this.synth.writeRegister(register, state.registers[register]);
    this.synth._adoptState(state);
  }
  apply(data, port = this.port) {
    try {
      if (data.method === 'dispose') { this.dispose(); return; }
      if (!this.synth) throw new Error('SID is not ready');
      this.validateCommand(data); let value = true;
      if (data.method === 'reset') this.synth.reset();
      else if (data.method === 'writeRegister') { this.synth.writeRegister(...data.args); this.synth.adoptRegisterState(); }
      else if (data.method === 'readRegister') value = this.core.readRegister(...data.args);
      else if (data.method === 'getState') value = this.synth._getState();
      else if (data.method === 'forceKeyOff' || data.method === 'keyOff') this.forceKeyOff(data.args[0]);
      else if (data.method === 'allNotesOff') this.synth.allNotesOff();
      else if (data.method === 'stopVoices') { this.performance.clear(); this.stopVoices(); }
      else if (data.type === 'clear-scheduled-writes') this.performance.clear();
      else if (data.method === 'barrier' || data.method === 'clock' || data.type === 'chip-clock') {}
      else throw new Error(`Unsupported SID command: ${data.method ?? data.type}`);
      if (data.id !== undefined) port.postMessage({type: data.type === 'chip-clock' ? 'chip-clock-result' : undefined, id: data.id, value});
    } catch (error) {
      if (data.id !== undefined) port.postMessage({type: data.type === 'chip-clock' ? 'chip-clock-result' : undefined, id: data.id, error: error.message, name: error.name});
    }
  }
  process(_inputs, outputs) {
    if (this.dead) return false;
    const [left, right] = outputs[0];
    try { this.performance.render(left, right, this.renderSegment); return true; }
    catch (error) { left.fill(0); right?.fill(0); this.dispose(); this.port.postMessage({fatal: true, error: error.message}); return false; }
  }
  renderSegment(left, right) {
    if (!this.core) { left.fill(0); right?.fill(0); return; }
    this.core.renderInto(left); right?.set(left);
  }
}
registerProcessor('tetorica-sid', SidProcessor);
