import { setChain, preset } from './graph.js';
class NativeGain extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.api = new WebAssembly.Instance(options.processorOptions.module, {env:{emscripten_notify_memory_growth(){}}}).exports;
    this.api._initialize?.();
    this.api.gain_reset();
    this.api.eq_reset(sampleRate);
    this.api.reverb_reset(sampleRate);
    this.api.compressor_reset(sampleRate);
    this.api.gate_reset(sampleRate);
    this.api.graph_reset(sampleRate);
    this.mode = 'serial';
    setChain(this.api, preset(this.mode));
    this.capacity = this.api.gain_capacity();
    this.input = new Float32Array(this.api.memory.buffer, this.api.gain_input(), this.capacity * 2);
    this.output = new Float32Array(this.api.memory.buffer, this.api.gain_output(), this.capacity * 2);
    this.gain = 1;
    this.bypass = false;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'extra') {
        const ok=this.api.extra_set(data.kind, data.slot ?? 0, data.parameter, data.value);
        if (!ok) this.port.postMessage({ type: 'error', message: 'Invalid FX parameter or allocation failed' });
        return;
      }
      if (data.type === 'clear') { this.api.graph_clear(); return; }
      if (data.type === 'routing') {
        try {
          setChain(this.api, preset(data.mode));
          this.mode = data.mode;
          this.api.graph_clear();
          this.port.postMessage({ type: 'routing', mode: this.mode });
        } catch (error) { this.port.postMessage({ type: 'error', message: error.message }); }
        return;
      }
      if (data.type === 'branches') {
        for (const [slot, value] of [[1, data.a], [2, data.b]]) {
          this.api.gain_select(slot); this.api.gain_set(value, Math.round(sampleRate * 0.01));
        }
        this.api.gain_select(0);
        this.api.compressor_select(1);
        this.api.compressor_set(-30, 10, 5, 250, 0, 0);
        this.api.compressor_select(0);
        return;
      }
      if (data.type === 'gate') {
        this.api.gate_set(data.gateThreshold, data.gateHysteresis, data.gateAttack, data.gateHold, data.gateRelease, data.bypass ? 1 : 0);
        return;
      }
      if (data.type === 'compressor') {
        this.api.compressor_set(data.threshold, data.ratio, data.attack, data.release, data.makeup, data.bypass ? 1 : 0);
        return;
      }
      if (data.type === 'reverb') {
        this.api.reverb_set(data.bypass ? 0 : data.mix, data.room, data.damping);
        return;
      }
      if (data.type === 'eq') {
        for (let band = 0; band < 3; band++) {
          const db = data.values?.[band];
          if (Number.isFinite(db)) this.api.eq_set(band, data.bypass ? 0 : Math.max(-12, Math.min(12, db)));
        }
        return;
      }
      if (data.type !== 'gain') return;
      if (Number.isFinite(data.value)) this.gain = Math.max(0, Math.min(2, data.value));
      this.bypass = Boolean(data.bypass);
      this.api.gain_set(this.bypass ? 1 : this.gain, Math.round(sampleRate * 0.005));
    };
  }
  process(inputs, outputs) {
    if (this.input.buffer !== this.api.memory.buffer) {
      this.input = new Float32Array(this.api.memory.buffer, this.api.gain_input(), this.capacity * 2);
      this.output = new Float32Array(this.api.memory.buffer, this.api.gain_output(), this.capacity * 2);
    }
    const target = outputs[0];
    const source = inputs[0];
    const n = target[0].length;
    if (n > this.capacity) return true;
    for (let c = 0; c < 2; c++) {
      const channel = source[c] ?? source[0];
      const offset = c * this.capacity;
      for (let i = 0; i < n; i++) this.input[offset+i] = channel ? channel[i] : 0;
    }
    this.api.graph_process(n);
    for (let c = 0; c < target.length; c++) {
      for (let i = 0; i < n; i++) target[c][i] = this.output[c*this.capacity+i];
    }
    return true;
  }
}
registerProcessor('native-gain', NativeGain);
