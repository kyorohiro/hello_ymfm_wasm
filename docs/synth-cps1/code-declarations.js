// SPDX-License-Identifier: BSD-3-Clause
export const cps1Declarations = () => `
declare function liveLoop(name: string, play: () => Promise<void>): void;
declare function beat(beats?: number): Promise<void>;
declare function sleep(seconds: number): Promise<void>;
declare function setBpm(bpm: number): void;
declare function stopLoop(name: string): void;
declare const opm: {
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
declare const oki: {
  write(command: number): void;
  play(voice: number, sample: number, attenuation?: number): void;
  stop(voice: number): void;
  setVoiceMuted(voice: number, muted: boolean): void;
};
`;
