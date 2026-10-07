import {PWM32XDirectTransport} from '../web/pwm32x_transport.js';
import {YM2612DirectTransport} from '../web/ym2612synth.js';
import {YM2608DirectTransport} from '../web/ym2608synth.js';
import {GameboyDirectTransport} from '../web/gameboysynth.js';
import {SegaPSGDirectTransport} from '../web/segapsgsynth.js';
import {ChipPCMRenderer} from '../web/chip_pcm_renderer.js';
import {createThreadOutput} from './output_thread.mjs';

class Playback {
  constructor(transport, options, name) {
    this.transport = transport; this.options = options; this.name = name;
    this.running = false; this.closed = false; this.queuedBlocks = options.queueBlocks ?? 4;
    if (!Number.isInteger(this.queuedBlocks) || this.queuedBlocks < 2 || this.queuedBlocks > 16) throw new RangeError('Invalid queueBlocks');
    if (!Number.isInteger(options.bufferFrames ?? 512) || (options.bufferFrames ?? 512) < 128 || (options.bufferFrames ?? 512) > 8192) throw new RangeError('Invalid bufferFrames');
    if (!Number.isInteger(options.sampleRate ?? 48000) || (options.sampleRate ?? 48000) < 8000 || (options.sampleRate ?? 48000) > 192000) throw new RangeError('Invalid sampleRate');
    this.fadeFrames = Math.round((options.sampleRate ?? 48000) * .02);
  }
  start() {
    if (this.starting) return this.starting;
    this.starting = this.startPlayback().catch(async error => {
      this.closed = true; this.error = error; this.running = false;
      await this.output?.close().catch(() => {}); throw error;
    }).finally(() => {this.starting = null;});
    return this.starting;
  }
  async startPlayback() {
    if (this.closed) throw new Error('AudifyTransport is closed');
    if (this.running) return;
    if (!this.output) {
      this.output = await createThreadOutput({sampleRate: this.options.sampleRate ?? 48000,
        bufferFrames: this.options.bufferFrames ?? 512, outputModule: this.options.outputModule, outputOptions: this.options.outputOptions,
        onDrain: () => {if (this.resolveDrain && this.output.queuedFrames === 0) {this.resolveDrain(); this.resolveDrain = null;} void this.pump();},
        onError: error => {this.error = error; this.running = false; void this.close().catch(() => {});}});
      if (this.closed) {await this.output.close(); throw new Error('AudifyTransport is closed');}
      this.renderer = new ChipPCMRenderer(this.transport.chip, {sampleRate: this.options.sampleRate ?? 48000,
        gain: this.options.gain ?? .25, removeIdleOffset: this.name === 'ym2612',
        generate: typeof this.transport.generateStereo === 'function' ? this.transport.generateStereo.bind(this.transport) : undefined});
    }
    this.running = true; this.ramp = 0; this.pump(); await this.output.start();
    if (this.error) throw this.error;
  }
  pump() {
    if (!this.running || !this.output) return;
    try {
      while (this.running && this.output.queuedFrames < this.output.frames * this.queuedBlocks) {
        const pcm = this.renderer.render(this.output.frames);
        for (let i = 0; i < pcm.left.length; i++) {const gain = Math.min(1, ++this.ramp / this.fadeFrames); pcm.left[i] *= gain; pcm.right[i] *= gain;}
        this.output.write(pcm);
      }
    } catch (error) {this.error = error; this.running = false; void this.close().catch(() => {});}
  }
  async stop() {
    if (!this.running || !this.output) return;
    this.running = false;
    const blocks = Math.ceil(this.fadeFrames / this.output.frames);
    for (let block = 0; block < blocks; block++) {
      const pcm = this.renderer.render(this.output.frames);
      for (let i = 0; i < pcm.left.length; i++) {const gain = Math.max(0, 1 - (block * pcm.left.length + i + 1) / this.fadeFrames); pcm.left[i] *= gain; pcm.right[i] *= gain;}
      this.output.write(pcm);
    }
    await new Promise(resolve => {
      const timer = setTimeout(() => {this.resolveDrain = null; resolve();}, this.output.queuedFrames * 1000 / this.renderer.sampleRate + 250);
      this.resolveDrain = () => {clearTimeout(timer); resolve();};
    });
    await this.output.stop();
  }
  close() {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = (async () => {await this.starting?.catch(() => {}); try {await this.stop();} finally {await this.output?.close();}})();
    return this.closing;
  }
}
function audifyTransport(Direct, name) {
  return class extends Direct {
    constructor(chip, options = {}) {super(chip); this.playback = new Playback(this, options, name);}
    reset() {super.reset(); this.playback?.renderer?.resetHistory();}
    start() {return this.playback.start();}
    stop() {return this.playback.stop();}
    close() {return this.playback.close();}
    getState() {return {running: this.playback.running, error: this.playback.error?.message ?? null, output: this.playback.output?.getState() ?? null};}
  };
}
class RegisterDirectTransport {
  constructor(chip) {this.chip = chip;}
  reset() {this.chip.reset();}
  write(...args) {this.chip.write(...args);}
  writeRegister(register, value) {this.chip.write(0, register); this.chip.write(1, value);}
}
export const YM2612AudifyTransport = audifyTransport(YM2612DirectTransport, 'ym2612');
export const YM2608AudifyTransport = audifyTransport(YM2608DirectTransport, 'ym2608');
export const GameboyAudifyTransport = audifyTransport(GameboyDirectTransport, 'gameboy');
export const SegaPSGAudifyTransport = audifyTransport(SegaPSGDirectTransport, 'segapsg');
export const YM2151AudifyTransport = audifyTransport(RegisterDirectTransport, 'ym2151');

export const PWM32XAudifyTransport = audifyTransport(PWM32XDirectTransport, 'pwm');
