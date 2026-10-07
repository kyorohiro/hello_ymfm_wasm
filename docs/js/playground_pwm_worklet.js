import {PWM32XPlayback, PWM_METHODS} from './pwm32x_playback.js';

class PWMProcessor extends AudioWorkletProcessor {
  constructor({processorOptions = {}}) {
    super(); this.dead = false;
    try {
      this.pwm = new PWM32XPlayback({...processorOptions, sampleRate});
      this.port.onmessage = ({data}) => {
        if (data.port) {
          this.clientPort = data.port;
          data.port.onmessage = ({data: command}) => this.receive(command, this.clientPort);
          data.port.start();
        } else this.receive(data, this.port);
      };
      this.port.postMessage({ready: true});
    } catch (error) {this.dead = true; this.port.postMessage({error: error.message});}
  }
  receive({method, args = [], id}, port) {
    try {
      if (method === 'dispose') {this.dead = true; this.pwm.dispose(); this.clientPort?.close(); return;}
      if (this.dead || !PWM_METHODS.has(method)) throw new Error('Invalid PWM command');
      const value = this.pwm[method](...args);
      if (id !== undefined) port.postMessage({id, value});
    } catch (error) {port.postMessage({id, error: error.message});}
  }
  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    if (this.dead) {left.fill(0); right.fill(0); return false;}
    const pcm = this.pwm.generateStereo(left.length);
    left.set(pcm.left); right.set(pcm.right); return true;
  }
}
registerProcessor('tetorica-pwm32x', PWMProcessor);
