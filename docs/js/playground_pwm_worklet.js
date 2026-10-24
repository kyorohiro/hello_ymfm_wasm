import {receiveChipInspector, readPwmInspector} from './playground_chip_inspector_state.js?v=audio-numeric-bindings-1';
import {PWM32XPlayback, PWM_METHODS} from './pwm32x_playback.js?v=y8950-adpcm-1';
import {createProcessorPerformance} from './playground_performance_processor.js?v=y8950-adpcm-1';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import pwmFactory from '../generated/pwm32x_wasm.js?v=pwm-wasm-1';

class PWMProcessor extends AudioWorkletProcessor {
  constructor({processorOptions = {}}) {
    super(); this.dead = false; this.pwm = null;
    this.performance=createProcessorPerformance({chip:'pwm',apply:(data,port)=>this.apply(data,port),validate:({method,args=[]})=>{
      if(method==='clock'||method==='setClock'){validateChipClock(args[0]);return;}
      if(method==='dispose')return;
      if(!PWM_METHODS.has(method))throw new Error('Invalid PWM command');
      if(['write','writeRegister'].includes(method)&&(!Number.isInteger(args[0])||args[0]<0||args[0]>4||!Number.isInteger(args[1])))throw new RangeError('Invalid PWM register write');
      if(method==='scheduleWrites'){
        if(!Array.isArray(args[0])||args[0].length>1000000)throw new RangeError('Invalid PWM write queue');
        for(const {frame,register,value}of args[0])if(!Number.isSafeInteger(frame)||frame<0||!Number.isInteger(register)||register<0||register>4||!Number.isInteger(value)||value<0||value>65535)throw new RangeError('Invalid PWM scheduled write');
      }
    },prepare:(data,port,metadata)=>{
      if(['read','getState'].includes(data.method)){this.apply(data,port);return null;}
      if(data.id===undefined)return data;
      const value=data.method==='scheduleWrites'?this.pwm.frame+Math.max(0,Math.round(metadata.time*sampleRate-currentFrame)):undefined;
      const {id,...command}=data;port.postMessage({id,value});return command;
    }});
    this.renderSegment=this.renderSegment.bind(this);
    this.port.onmessage = ({data}) => {
      if (data.port) {
        if(this.dead){data.port.close();return;}
        this.clientPort = data.port;
        data.port.onmessage = ({data: command}) => this.receive(command, this.clientPort);
        data.port.start();
      } else this.receive(data, this.port);
    };
    PWM32XPlayback.create({...processorOptions, sampleRate,moduleFactory:pwmFactory,moduleOptions:{wasmBinary:processorOptions.wasmBinary}})
      .then(pwm=>{
        if(this.dead){pwm.dispose();return;}
        this.pwm=pwm;this.port.postMessage({ready:true,backend:pwm.backend});
      }).catch(error=>{this.dead=true;this.port.postMessage({error:error.message});});
  }
  receive(data,port) {
    if(data?.type==='chip-inspector'&&receiveChipInspector(data,port,this.pwm ? (action,method,args)=>{if(action==='read')return readPwmInspector(this.pwm);if(!['write','writeRegister','reset'].includes(method))throw new Error('Unsupported PWM inspector operation');return this.pwm[method](...args);} : null))return;
    if(this.performance.receive(data,port))return;
    this.apply(data,port);
  }
  apply({method, args = [], id}, port) {
    try {
      if (method === 'clock') method = 'setClock';
      if (method === 'dispose') {this.performance.clear();this.dead = true; this.pwm?.dispose(); this.clientPort?.close(); return;}
      if (this.dead || !this.pwm || !PWM_METHODS.has(method)) throw new Error('Invalid PWM command');
      const value = this.pwm[method](...args);
      if (id !== undefined) port.postMessage({id, value});
    } catch (error) {port.postMessage({id, error: error.message});}
  }
  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    if (this.dead) {left.fill(0); right.fill(0); return false;}
    this.performance.render(left,right,this.renderSegment);return true;
  }
  renderSegment(left,right) {
    if(this.dead||!this.pwm){left.fill(0);right.fill(0);return;}
    this.pwm.renderInto(left,right);
  }
}
registerProcessor('tetorica-pwm32x', PWMProcessor);
