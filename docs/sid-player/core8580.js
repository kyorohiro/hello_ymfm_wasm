// SPDX-License-Identifier: BSD-3-Clause
// The existing research engine, adapted to the ordinary player's state shape.
import {Sid8580MachineCore} from '../sid8580-lab/core.js';
import {validateResearchSid} from '../sid8580-lab/parser.js';
import {resolvePlayerTarget,require8580Machine,SidPlayerTargetError} from './model_policy.js';

export class Sid8580PlayerCore {
  static async create({sampleRate=48000,endpointBinary,machineBinary,signal}={}) {
    const machine=await Sid8580MachineCore.create({sampleRate,endpointBinary,machineBinary,signal,
      profiles:{resonance:false,cutoff:false}});
    return new Sid8580PlayerCore(machine);
  }
  constructor(machine) {this.machine=machine;this.sampleRate=machine.sampleRate;this.parsed=null;}
  get exports() {return this.machine.exports;}
  get handle() {return this.machine.handle;}
  get positionFrames() {return this.machine.positionFrames;}
  /** A failed candidate leaves the accepted machine and future PCM unchanged. */
  load(input,options={}) {
    this.machine.assertOpen();
    // A direct caller of this fixed-model adapter may use the legacy explicit
    // model option. The ordinary player's factory supplies modelSelection.
    const modelSelection=options.modelSelection!==undefined?options.modelSelection:options.model!==undefined?options.model:'8580';
    const target=resolvePlayerTarget(input,{...options,modelSelection});
    if(target.selectedModel!=='8580')throw new SidPlayerTargetError('this engine is 8580; create the 6581 engine for that selected target.','SID_MODEL_MISMATCH');
    const vbiBackend=options.vbiBackend===undefined?'c64':options.vbiBackend;
    const load={subtune:options.subtune,environment:options.environment===undefined?'minimal':options.environment,...target.targetOptions};
    const parsed=validateResearchSid(input,load);require8580Machine(parsed,vbiBackend);
    this.machine.load(parsed.originalBytes,{...load,...(options.roms?{roms:options.roms}:{})});
    this.parsed={...parsed,playbackBackend:'c64'};
    return this.getState();
  }
  getState() {
    const state=this.machine.getState();
    return {...state,model:'8580',backend:'c64',frameCycles:19656,modelStatus:'preview',
      targetSelection:state.selection?{...state.selection}:null,
      relocation:this.parsed?{...this.parsed.relocation}:null};
  }
  renderInto(output) {return this.machine.renderInto(output);}
  render(frames) {return this.machine.render(frames);}
  stop() {this.machine.stop();return this.getState();}
  readRam(address) {return this.machine.readRam(address);}
  readTrace(options) {return this.machine.readTrace(options);}
  readSidReads(options) {return this.machine.readSidReads(options);}
  dispose() {this.machine.dispose();}
}
