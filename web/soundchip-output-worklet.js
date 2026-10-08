import {PWM32XPlayback, PWM_METHODS} from './pwm32x_playback.js';
import {Ym2612} from './ym2612.js';
import {Ym2608} from './ym2608.js';
import {Ym2151} from './ym2151.js';
import {GameboyApu} from './gameboyapu.js';
import {SegaPSG} from './segapsg.js';
import {NesApu} from './nesapu.js';
import ym2612Factory from './generated/ym2612_wasm.js';
import ym2608Factory from './generated/ym2608_wasm.js';
import ym2151Factory from './generated/ym2151_wasm.js';
import gameboyFactory from './generated/gameboy_apu_wasm.js';
import psgFactory from './generated/segapsg_wasm.js';
import {createSoundChipFactory} from './soundchip_factory.js';
import {ChipPCMRenderer} from './chip_pcm_renderer.js';
import {YM2612DirectTransport} from './ym2612synth.js';
import {YM2612DacPlayer} from './ym2612_dac.js';

const profiles = {ym2612: [Ym2612, ym2612Factory], ym2608: [Ym2608, ym2608Factory],
  ym2151: [Ym2151, ym2151Factory], gameboy: [GameboyApu, gameboyFactory], segapsg: [SegaPSG, psgFactory], nes: [NesApu, undefined]};
const createSoundChip = createSoundChipFactory(Object.fromEntries([...Object.entries(profiles).map(([name, [Type, moduleFactory]]) =>
  [name, options => Type.create({...options, moduleFactory})]), ['pwm', options => new PWM32XPlayback(options)]]));

class SoundChipProcessor extends AudioWorkletProcessor {
  constructor({processorOptions: {name, chipOptions, wasmBinary}}) {
    super(); this.dead = false; this.running = false; this.name = name; this.remotePorts = new Set();
    this.scheduled = []; this.banks = new Map();
    this.port.onmessage = ({data}) => this.receive(data);
    createSoundChip(name, {...chipOptions, ...(name === 'gameboy' || name === 'segapsg' || name === 'pwm' || name === 'nes' ? {sampleRate} : {}), moduleOptions: {wasmBinary}})
      .then(chip => {
        if (this.dead) {chip.dispose(); return;}
        this.chip = chip;
        this.direct = name === 'ym2612' ? new YM2612DirectTransport(chip) : null;
        if (this.direct) this.pcmDac = new YM2612DacPlayer(sampleRate, (port, register, value) => chip.writeRegister(register, value, port));
        this.renderer = new ChipPCMRenderer(chip, {sampleRate, gain: 1, removeIdleOffset: name === 'ym2612',
          generate: this.direct?.generateStereo.bind(this.direct)});
        this.port.postMessage({type: 'ready', sampleRate: chip.sampleRate()});
      }).catch(error => {this.dead = true; this.chip?.dispose(); this.port.postMessage({error: error.message});});
  }
  receive(data, replyPort = this.port) {
    try {
      if (data.method === 'dispose') {this.dead = true; this.chip?.dispose(); this.chip = null;
        this.renderer = this.direct = this.pcmDac = null; this.scheduled = []; this.banks.clear();
        for (const port of this.remotePorts) port.close(); this.remotePorts.clear(); return;}
      if (data.method === 'attachPort') {
        if (this.dead) {data.port.close(); return;}
        this.remotePorts.add(data.port);
        if (this.chip?.getIrq) data.port.postMessage({type: 'irq', asserted: this.chip.getIrq()});
        data.port.onmessage = ({data: command}) => this.receive(command, data.port); data.port.start(); return;
      }
      if (!this.chip) throw new Error('Chip not ready');
      const args = data.args ?? [];
      const method = data.method ?? data.type;
      let value;
      if (method === 'start') this.running = true;
      else if (method === 'stop') this.running = false;
      else if (this.name === 'pwm' && PWM_METHODS.has(method)) value = this.chip[method](...args);
      else if (method === 'reset') {this.pcmDac?.reset(); this.direct ? this.direct.reset() : this.chip.reset(); this.renderer.resetHistory();}
      else if (method === 'write') {
        if (data.type) {
          if (this.direct) {this.pcmDac.observeWrite(data.port, data.register, data.value); this.direct.write(data.port, data.register, data.value);}
          else {this.chip.write(data.port * 2, data.register); this.chip.write(data.port * 2 + 1, data.value);}
        }
        else this.chip.write(...args);
      } else if (method === 'writeRegister') {
        if (typeof this.chip.writeRegister === 'function') this.chip.writeRegister(...args);
        else {const [register, value, port = 0] = args; this.chip.write(port * 2, register); this.chip.write(port * 2 + 1, value);}
      }
      else if (this.name === 'nes' && method === 'loadMemory') value = this.chip.loadMemory(...args);
      else if (this.name === 'nes' && method === 'setChannelEnabled') value = this.chip.setChannelEnabled(...args);
      else if (this.name === 'nes' && method === 'setChannelMuted') value = this.chip.setChannelMuted(...args);
      else if (method === 'loadRhythmRom') this.chip.loadAdpcmARom(data.bytes);
      else if (method === 'loadAdpcmMemory') this.chip.loadAdpcmBMemory(data.bytes, data.address);
      else if (method === 'pcm-dac') this.pcmDac.command(data.command, currentFrame);
      else if (method === 'clear-dac-playback') {this.pcmDac?.stop(); this.scheduled = this.scheduled.filter(entry => !entry.bank);}
      else if (method === 'schedule-writes') {
        for (const entry of data.entries ?? []) {
          if (!Number.isFinite(entry.time) || entry.time < 0) throw new Error('Invalid scheduled write time');
          this.scheduled.push({...entry, frame: Math.round(entry.time * sampleRate)});
        }
        this.scheduled.sort((a, b) => a.frame - b.frame);
      } else if (method === 'clear-scheduled-writes') this.scheduled = this.scheduled.filter(entry => entry.bank);
      else if (method === 'load-dac-bank') this.banks.set(data.name, new Uint8Array(data.data));
      else if (method === 'play-dac-bank') {
        if (!Number.isFinite(data.time) || data.time < 0) throw new Error('Invalid DAC bank time');
        const bytes = this.banks.get(data.name);
        if (!bytes) throw new Error(`Unknown DAC bank: ${data.name}`);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let offset = 0; offset + 5 <= bytes.length; offset += 5) this.scheduled.push({bank: true,
          frame: Math.round((data.time + view.getUint32(offset, true) / 44100) * sampleRate), port: 0, register: 0x2a, value: bytes[offset + 4]});
        this.scheduled.sort((a, b) => a.frame - b.frame);
      }
      else if (method === 'barrier') {}
      else throw new Error(`Unsupported chip command: ${method}`);
      if (data.id !== undefined) {
        const type = method === 'loadAdpcmMemory' ? 'adpcm-memory-loaded' : method === 'pcm-dac' ? 'pcm-dac-result' : 'response';
        replyPort.postMessage({type, id: data.id, value});
      }
    } catch (error) {
      const type = data.type === 'loadAdpcmMemory' ? 'adpcm-memory-loaded' : data.type === 'pcm-dac' ? 'pcm-dac-result' : 'response';
      replyPort.postMessage({type, id: data.id, error: error.message});
    }
  }
  process(_inputs, outputs) {
    const [left, right] = outputs[0]; left.fill(0); right.fill(0);
    if (this.dead) return false;
    if (this.running && this.renderer) {
      let offset = 0;
      while (offset < left.length) {
        const frame = currentFrame + offset;
        while (this.scheduled[0]?.frame <= frame) {
          const entry = this.scheduled.shift();
          this.pcmDac?.observeWrite(entry.port, entry.register, entry.value);
          this.chip.writeRegister(entry.register, entry.value, entry.port);
        }
        this.pcmDac?.advance(frame);
        const next = Math.min(currentFrame + left.length, this.scheduled[0]?.frame ?? Infinity, this.pcmDac?.nextFrame() ?? Infinity);
        const count = Math.max(1, next - frame);
        const pcm = this.renderer.render(count); left.set(pcm.left, offset); right.set(pcm.right, offset); offset += count;
      }
    }
    if (this.chip?.getIrq && this.irq !== this.chip.getIrq()) {
      this.irq = this.chip.getIrq(); const message = {type: 'irq', asserted: this.irq};
      this.port.postMessage(message); for (const port of this.remotePorts) port.postMessage(message);
    }
    return true;
  }
}
registerProcessor('tetorica-soundchip', SoundChipProcessor);
