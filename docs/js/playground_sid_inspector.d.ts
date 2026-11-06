import type {SidChannel,SidState,SidSynth,SidVoiceState} from './sidsynth.js';

export type SidInspectorState = Omit<SidState,'channels'> & {
  kind:'sid';
  sampleRate?:number;
  readOnly:true;
  activeSource:'applied-register-gates';
  channels:Array<SidVoiceState & {channel:SidChannel;active:boolean}>;
};
/** Read-only applied state; this adapter never clocks or writes to the chip. */
export class SidVoiceInspector {
  constructor(options:{synth:Pick<SidSynth,'_getState'>;sampleRate?:number});
  readonly synth:Pick<SidSynth,'_getState'>;
  readonly sampleRate?:number;
  read():SidInspectorState;
  /** Manual editing and audition RPCs are deliberately unsupported. */
  invoke():never;
}
export function receiveSidInspector(data:unknown,port:Pick<MessagePort,'postMessage'>,inspector?:SidVoiceInspector|null):boolean;
