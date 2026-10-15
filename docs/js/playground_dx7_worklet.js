import {createDX7, createInitVoice, createVoiceSysex} from './msfa_dx7/src/index.js';

const errorMessage = error => String(error?.message ?? error);

class Dx7Processor extends AudioWorkletProcessor {
  constructor({processorOptions = {}} = {}) {
    super();
    this.dead = false;
    this.synth = null;
    this.remote = null;
    this.commands = Promise.resolve();
    this.port.onmessage = ({data}) => {
      if (data.port) {
        if (this.dead) {
          data.port.postMessage({fatal: true, error: this.failure ?? 'DX7 instance is disposed.'});
          data.port.close();
          return;
        }
        this.remote = data.port;
        this.remote.onmessage = ({data: command}) => this.receive(command, this.remote);
        this.remote.onmessageerror = () => this.fail(new Error('Could not read a DX7 command.'));
        this.remote.start();
      } else this.receive(data, this.port);
    };
    this.initializing = this.initialize(processorOptions.wasmBytes);
  }

  async initialize(wasmBytes) {
    let synth;
    try {
      synth = await createDX7({sampleRate, wasmBytes});
      if (this.dead) { synth.dispose(); return; }
      await synth.loadSysex(createVoiceSysex(createInitVoice()));
      if (this.dead) { synth.dispose(); return; }
      this.synth = synth;
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
    };
  }

  dispose(error = new Error('DX7 instance is disposed.')) {
    if (this.dead) return;
    this.dead = true;
    this.failure = errorMessage(error);
    this.synth?.dispose();
    this.synth = null;
    // Notify direct Worker clients as well as the Main-thread endpoint. This
    // also rejects requests queued behind a pending upload or initialization.
    const message = {fatal: true, error: this.failure};
    this.port.postMessage(message);
    if (this.remote) {
      this.remote.postMessage(message);
      this.remote.onmessage = null;
      this.remote.onmessageerror = null;
      this.remote.close();
    }
  }

  fail(error) { this.dispose(error); }

  receive(data, port) {
    // STOP/disposal must win over initialization and queued asynchronous loads.
    if (data.method === 'dispose') { this.dispose(); return; }
    this.commands = this.commands.then(async () => {
      await this.initializing;
      if (this.dead || !this.synth) throw new Error(this.failure ?? 'DX7 processor is not ready.');
      const args = data.args ?? [];
      let value;
      switch (data.method) {
        case 'loadSysex': await this.synth.loadSysex(args[0]); value = this.getState(); break;
        case 'getState': value = this.getState(); break;
        case 'selectVoice': this.synth.selectVoice(args[0]); break;
        case 'noteOn': this.synth.noteOn(args[0], args[1]); break;
        case 'noteOff': this.synth.noteOff(args[0]); break;
        case 'allNotesOff': this.synth.allNotesOff(); break;
        case 'panic': this.synth.panic(); break;
        default: throw new Error(`Unknown DX7 command: ${data.method}`);
      }
      if (data.id !== undefined && !this.dead) port.postMessage({id: data.id, value});
    }).catch(error => {
      if (this.dead) return;
      // A rejected SysEx file preserves the previous usable bank. Synchronous
      // commands have no request promise, so report their failures as fatal.
      if (data.id !== undefined) port.postMessage({id: data.id, error: errorMessage(error)});
      else this.fail(error);
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
      this.synth.renderInto(channels[0]);
      for (let i = 1; i < channels.length; i++) channels[i].set(channels[0]);
      return true;
    } catch (error) {
      for (let i = 0; i < channels.length; i++) channels[i].fill(0);
      this.fail(error);
      return false;
    }
  }
}

registerProcessor('tetorica-playground-dx7', Dx7Processor);
