// SPDX-License-Identifier: BSD-3-Clause
export const cps1Declarations = () => `
declare function liveLoop(name: string, play: () => Promise<void>): void;
declare function beat(beats?: number): Promise<void>;
declare function sleep(seconds: number): Promise<void>;
declare function setBpm(bpm: number): void;
declare function stopLoop(name: string): void;
interface TimedWrite {offsetSeconds:number; register:number; value:number}
interface TimedPlan {version:1; chip:string; referenceSampleRate:number; writes:TimedWrite[]}
interface RecorderTime {atSeconds(seconds:number):this; atSample(sample:number):this}
interface OpmRecorder extends RecorderTime {
  writeRegister(register:number,value:number):this; setPitch(channel:number,kc:number,kf?:number):this;
  setNote(channel:number,note:string|number):this; setFrequency(channel:number,hz:number):this;
  noteOn(channel:number,note:string|number):this; keyOn(channel:number,mask?:number):this;
  keyOff(channel:number):this; setNoise(enabled:boolean,frequency?:number):this;
}
interface OkiRecorder extends RecorderTime {
  write(byte:number):this; play(voice:number,sample:number,attenuation?:number):this; stop(voice:number):this;
}
interface ChipTiming<B> {
  build(record:(b:B)=>void, options?:{referenceSampleRate?:number}):TimedPlan;
  compile(plan:TimedPlan):Promise<TimedWrite[]>;
  schedule(plan:TimedPlan,options:{name:string; repeatSeconds?:number}):Promise<unknown>;
  clearSchedule(name:string):Promise<unknown>;
}
declare const opm: ChipTiming<OpmRecorder> & {
  loadVoice(channel: number, path: string, index?: number): void;
  writeRegister(address: number, value: number): void;
  setOperator(channel: number, operator: number, patch: {dt1?:number, dt2?:number, mul?:number, tl?:number, ks?:number, ar?:number, d1r?:number, d2r?:number, d1l?:number, rr?:number, am?:0 | 1}): void;
  setAlgo(channel: number, algorithm: number, feedback?: number): void;
  setPan(channel: number, left: boolean, right: boolean): void;
  setNote(channel: number, note: string | number): void;
  setPitch(channel: number, keyCode: number, keyFraction?: number): void;
  setFrequency(channel: number, hz: number): void;
  noteOn(channel: number, note: string | number): void;
  keyOn(channel: number, mask?: number): void;
  keyOff(channel: number): void;
  setNoise(enabled: boolean, frequency?: number): void;
};
declare const oki: ChipTiming<OkiRecorder> & {
  write(command: number): void;
  play(voice: number, sample: number, attenuation?: number): void;
  stop(voice: number): void;
  setVoiceMuted(voice: number, muted: boolean): void;
};
`;
