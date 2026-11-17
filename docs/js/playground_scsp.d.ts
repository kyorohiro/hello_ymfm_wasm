import type {
  ScspSynth, ScspPCMOptions, ScspSample, ScspState,
  ScspDspProgram, ScspDspApplyOptions, ScspDspCoefficients,
  ScspDspCoefficientPatch, ScspDspReturn, ScspDspDelayPatch,
  ScspDspRegisterProgram, ScspDspDelayProgram,
} from './scspsynth.js';

export type ScspControlMethod = 'setPreset' | 'setEnvelope' | 'setLfo' |
  'setModulation' | 'setFrequency' | 'setNote' | 'setMix' | 'keyOn' | 'keyOff' |
  'noteOn' | 'noteOff' | 'allNotesOff' | 'reset';
export type ScspDspMethod = 'applyDspProgram' | 'getDspProgram' |
  'getDspCoefficients' | 'setDspCoefficients' | 'setDspReturn' | 'setDspDelay';
type ScspOperationMethod = ScspControlMethod | ScspDspMethod | 'loadPCM' | 'getState';
type ScspOperationArgs<Method extends ScspOperationMethod> = Method extends 'setDspReturn'
  ? [patch: Partial<ScspDspReturn>] | [output: 0 | 1, patch: Partial<ScspDspReturn>]
  : Parameters<ScspSynth[Method]>;

export const SCSP_CONTROLS: readonly ScspControlMethod[];
export const SCSP_DSP_METHODS: readonly ScspDspMethod[];
export function assertNativeScspControl(method: string, args?: readonly unknown[]): void;
export function createScspValidation(): ScspSynth;
export function validateScspDspCommand<Method extends ScspDspMethod>(
  validation: ScspSynth, method: Method, args: ScspOperationArgs<Method>,
): ReturnType<ScspSynth[Method]>;
export function scspCommandArgs<Method extends ScspOperationMethod>(
  synth: ScspSynth, method: Method, args: ScspOperationArgs<Method>,
): ScspOperationArgs<Method>;

export interface ScspClientInitial {
  sampleRate?: number;
  state?: ScspState;
  /** Native DSP commands reject with NotSupportedError. */
  native?: boolean;
  [metadata: string]: unknown;
}
export interface ScspClientLifecycle<Context = unknown> {
  captureContext?: () => Context;
  restoreContext?: (context: Context) => void;
  isStopped?: (context: Context) => boolean;
}
/** Minimal MessagePort transport, also accepted by performance sender facades. */
export interface ScspClientPort {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  postMessage(message: unknown): void;
  onmessage: ((event: any) => void) | null;
  onmessageerror: ((event: any) => void) | null;
  start?(): void;
  close(): void;
}
interface ScspControlEvent {
  method: ScspControlMethod;
  args: unknown[];
}
interface ScspAuthorEdit {
  resources?: ScspState;
  editedSlot?: number;
  preset?: ScspControlEvent;
}

/** Ordered browser/Worker client. PCM uploads and DSP requests resolve after
 * the audio owner acknowledges the result. Controls retain their synchronous
 * authored-state validation and ordered dispatch. */
export interface ScspClient extends Pick<ScspSynth, ScspControlMethod> {
  readonly sampleRate: number;
  readonly nativeSampleRate: 44100;
  readonly channelCount: 32;
  loadPCM(pcm: Int8Array | Int16Array, options: ScspPCMOptions): Promise<ScspSample>;
  getState(): Promise<ScspState>;
  applyDspProgram(words: Uint16Array | readonly number[], options?: ScspDspApplyOptions): Promise<ScspDspRegisterProgram>;
  getDspProgram(): Promise<ScspDspProgram>;
  getDspCoefficients(): Promise<ScspDspCoefficients>;
  setDspCoefficients(patch: ScspDspCoefficientPatch): Promise<ScspDspCoefficients>;
  setDspReturn(patch: Partial<ScspDspReturn>): Promise<ScspDspReturn>;
  setDspReturn(output: 0 | 1, patch: Partial<ScspDspReturn>): Promise<ScspDspReturn>;
  /** Reserve a fixed Delay ring and apply the acknowledged time / feedback settings. */
  setDspDelay(patch: ScspDspDelayPatch): Promise<ScspDspDelayProgram>;
  dispose(): void;
  /** Internal transport hooks used by the Playground host. */
  _getState(): ScspState;
  _setLifecycle<Context>(lifecycle: ScspClientLifecycle<Context>): void;
  _applyAuthorEdit(edit: ScspAuthorEdit): void;
  _adoptState(state?: ScspState): void;
  _stopVoices(): Promise<unknown>;
  _before?: (event: ScspControlEvent) => false | void;
  _observe?: (event: ScspControlEvent) => void;
  _onStateChange?: () => void;
}

export function createScspClient<Context = unknown>(
  port: ScspClientPort,
  initial?: ScspClientInitial,
  lifecycle?: ScspClientLifecycle<Context>,
): ScspClient;
