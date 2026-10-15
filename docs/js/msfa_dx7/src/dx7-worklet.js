import { createDX7 } from './index.js';

class DX7Processor extends AudioWorkletProcessor {
  constructor({ processorOptions } = {}) {
    super();
    this.synth = null;
    this.disposed = false;
    this.failed = false;
    // Promise chaining is outside process(): load acknowledgements and subsequent
    // note events cannot overtake an asynchronous loadSysex() call.
    this.commands = Promise.resolve();
    this.port.onmessage = ({ data }) => {
      this.commands = this.commands.then(() => this.applyCommand(data)).catch(error => {
        if (data.id !== undefined) this.port.postMessage({ type: 'result', id: data.id, error: String(error.message ?? error) });
        else this.fail(error);
      });
    };
    this.initialize(processorOptions?.wasmBytes);
  }

  async initialize(wasmBytes) {
    try {
      const synth = await createDX7({ sampleRate, wasmBytes });
      if (this.disposed || this.failed) { synth.dispose(); return; }
      this.synth = synth;
      this.port.postMessage({ type: 'ready', voices: synth.voices, selectedVoice: synth.voices.length ? 0 : -1 });
    } catch (error) { this.fail(error); }
  }

  fail(error) {
    if (this.failed || this.disposed) return;
    this.failed = true;
    this.synth?.dispose();
    this.synth = null;
    this.port.postMessage({ type: 'error', error: String(error.message ?? error) });
    this.port.onmessage = null;
    this.port.close();
  }

  async applyCommand(data) {
    if (data.type === 'dispose') {
      this.disposed = true;
      this.synth?.dispose();
      this.synth = null;
      this.port.onmessage = null;
      this.port.close();
      return;
    }
    if (this.disposed) return;
    if (!this.synth || this.failed) throw new Error('DX7 processor is not ready.');
    switch (data.type) {
      case 'loadSysex':
        await this.synth.loadSysex(data.bytes);
        this.port.postMessage({ type: 'result', id: data.id, voices: this.synth.voices, selectedVoice: 0 });
        break;
      case 'selectVoice': this.synth.selectVoice(data.index); break;
      case 'noteOn': this.synth.noteOn(data.note, data.velocity); break;
      case 'noteOff': this.synth.noteOff(data.note); break;
      case 'allNotesOff': this.synth.allNotesOff(); break;
      case 'panic': this.synth.panic(); break;
      default: throw new Error(`Unknown DX7 command: ${data.type}`);
    }
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    if (this.disposed || this.failed) return false;
    if (!channels?.[0]) return true;
    if (!this.synth) {
      for (let channel = 0; channel < channels.length; channel++) channels[channel].fill(0);
      return true;
    }
    try {
      this.synth.renderInto(channels[0]);
      for (let channel = 1; channel < channels.length; channel++) channels[channel].set(channels[0]);
    } catch (error) {
      for (let channel = 0; channel < channels.length; channel++) channels[channel].fill(0);
      this.fail(error);
      return false;
    }
    return true;
  }
}

registerProcessor('tetorica-msfa-dx7', DX7Processor);
