import type {SysexBytes} from './sysex.js';

/** Public operator labels. OP1 is the last operator block in DX7 wire data. */
export type DX7Operator = 1 | 2 | 3 | 4 | 5 | 6;
/** Four DX7 values, each an integer from 0 through 99. These are not seconds. */
export type DX7EnvelopeValues = readonly [number, number, number, number];
export interface DX7EnvelopeParams {
  rates?: DX7EnvelopeValues;
  levels?: DX7EnvelopeValues;
}
export interface DX7KeyboardScalingParams {
  /** DX7 breakpoint value 0..99, not a MIDI note number. */
  breakpoint?: number;
  leftDepth?: number;
  rightDepth?: number;
  /** DX7 curve encodings 0..3. */
  leftCurve?: number;
  rightCurve?: number;
}
export interface DX7OperatorParams {
  envelope?: DX7EnvelopeParams;
  keyboardScaling?: DX7KeyboardScalingParams;
  /** 0..7. */
  rateScaling?: number;
  /** 0..3; retained, but upstream MSFA does not implement operator AM. */
  ampModSensitivity?: number;
  /** 0..7. */
  velocitySensitivity?: number;
  /** 0..99; larger is louder, unlike YM2612 TL. */
  outputLevel?: number;
  mode?: 'ratio' | 'fixed';
  /** DX7 coarse value 0..31. */
  coarse?: number;
  /** DX7 fine value 0..99. */
  fine?: number;
  /** Raw DX7 value 0..14; neutral is 7. */
  detune?: number;
}
export type DX7Operators = Partial<Record<DX7Operator, DX7OperatorParams>>;
/** Atomic operator-edit batch. Each OP1..OP6 label appears at most once. */
export type DX7OperatorEntries = readonly (readonly [DX7Operator, DX7OperatorParams])[];
export interface DX7LfoParams {
  /** Speed, delay and modulation depths are DX7 values 0..99. */
  speed?: number;
  delay?: number;
  pitchModDepth?: number;
  ampModDepth?: number;
  sync?: boolean;
  /** DX7 waveform encoding 0..5. */
  waveform?: number;
  /** 0..7. */
  pitchModSensitivity?: number;
}
/** Partial input. setPreset fills omitted fields from the original INIT SINE. */
export interface DX7Preset {
  /** At most ten printable ASCII characters. */
  name?: string;
  /** Zero-based DX7 algorithm 0..31 (displayed as 1..32 on the instrument). */
  algorithm?: number;
  feedback?: number;
  /** Retained; upstream MSFA does not implement oscillator key sync. */
  oscillatorSync?: boolean;
  pitchEnvelope?: DX7EnvelopeParams;
  lfo?: DX7LfoParams;
  /** Raw 0..48, neutral 24; retained but upstream MSFA does not apply it. */
  transpose?: number;
  /** Public OP1..OP6 labels, independent of the reversed SysEx wire order. */
  operators?: DX7Operators;
}
export interface DX7EnvelopeState {
  rates: [number, number, number, number];
  levels: [number, number, number, number];
}
export interface DX7OperatorState extends Required<DX7OperatorParams> {
  envelope: DX7EnvelopeState;
  keyboardScaling: Required<DX7KeyboardScalingParams>;
}
/** Complete independent output from getPreset(). */
export interface DX7PresetState extends Required<DX7Preset> {
  pitchEnvelope: DX7EnvelopeState;
  lfo: Required<DX7LfoParams>;
  operators: Record<DX7Operator, DX7OperatorState>;
}

/** Pure validation; omitted fields are allowed, unknown fields are rejected. */
export function validatePreset(preset: DX7Preset): void;
export function validateOperator(operator: DX7Operator, patch: DX7OperatorParams): void;
export function validateOperators(entries: DX7OperatorEntries): void;
/** Decode a validated 155-byte voice into a complete independent object. */
export function voiceToPreset(data: SysexBytes): DX7PresetState;
/** Validate and apply a partial object to a copied base (default INIT SINE). */
export function presetToVoice(preset: DX7Preset, baseBytes?: SysexBytes): Uint8Array;
