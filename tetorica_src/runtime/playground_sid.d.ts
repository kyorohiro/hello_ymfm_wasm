import type {SidChannel,SidState,SidSynth} from './sidsynth.js';
import type {SidTimedApi} from './sid_timed_client.js';

export interface SidClientLifecycle {
  captureContext?():unknown;
  restoreContext?(context:unknown):void;
  isStopped?(context:unknown):boolean;
}
export interface SidClientOptions {
  clock?:number;
  /** Creation-fixed model. 8580 Preview requires PAL 985248 Hz. */
  model?:'6581'|'8580';
  /** Existing authoring shadow; applying it does not replay hardware writes. */
  state?:SidState;
}
export interface SidRegisterClientOptions {
  clock?:number;
  model?:'6581'|'8580';
  close?():void;
  request?(method:string,args:unknown[]):unknown|Promise<unknown>;
  lifecycle?:SidClientLifecycle;
}
/** Main/Worker authoring client; read-side operations are ordered and asynchronous. */
export type SidRegisterClient = Omit<SidSynth,'readRegister'> & {
  readRegister(register:number):Promise<number>;
  getState():Promise<SidState>;
  _forceKeyOff(channel:SidChannel):void;
  _stopVoices():Promise<boolean>;
  _setLifecycle(hooks:SidClientLifecycle):void;
  _requestControl(method:string,args?:unknown[],transfer?:Transferable[]):Promise<unknown>;
};
/** Additive sample-clock operations on the acknowledged Web Audio client. */
export type SidClient = SidRegisterClient & SidTimedApi;
export function createSidRegisterClient(
  send:(method:string,args:unknown[],channel?:SidChannel,metadata?:{preserveOwner?:boolean;sidMask?:number})=>void,
  options?:SidRegisterClientOptions,
):SidRegisterClient;
export function createSidClient(port:MessagePort,options?:SidClientOptions,lifecycle?:SidClientLifecycle):SidClient;
