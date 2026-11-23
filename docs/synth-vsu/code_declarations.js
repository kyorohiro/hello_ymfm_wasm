// SPDX-License-Identifier: BSD-3-Clause
import { selectCodeHostDeclarations } from '../synth/synth_code_declarations.js';
import { VSU_CHANNEL_COUNT, VSU_REGISTERS, VSU_SOUND_STOP, VSU_WAVE_BANK_COUNT, vsuChannelRegister, vsuWaveOffset } from './vsu.js';

export const VSU_CODE_GLOBALS = Object.freeze([
	'context', 'fx', 'CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'CH6', 'console', 'log',
	'useSoundChip', 'file', 'setBpm', 'beat', 'nextBeat', 'sleep', 'sleepSamples', 'tween',
	'liveLoop', 'livePrepare', 'liveFx', 'stopLoop', 'stopAllLoops', 'liveCleanup', 'trackAsync',
	'parseNoteName', 'midiToNoteName', 'scale', 'chord', 'lerp', 'choose', 'cycle', 'rand', 'rrange', 'randInt', 'pg',
]);

const TYPES = `
type VsuChannel = 0 | 1 | 2 | 3 | 4 | 5;
type VsuWaveChannel = Exclude<VsuChannel, 5>;
type VsuWaveBank = 0 | 1 | 2 | 3 | 4;
type VsuWaveSamples = readonly number[] | (ArrayBufferView & ArrayLike<number>);

interface VsuEnvelopeSettings {
  /** Initial envelope level, 0–15. */
  level?: number;
  /** Hardware step time is 15.36 ms × (rate + 1), rate 0–7. */
  rate?: number;
  direction?: 'up' | 'down';
  enabled?: boolean;
  repeat?: boolean;
}

interface VsuRegisterControls<Result> {
  /** Write a byte to a four-byte-aligned VSU-relative offset from 0x000 to 0x580. */
  write(offset: number, value: number): Result;
  /** Upload 32 samples from 0 to 63. Wave RAM accepts writes while all channels are idle. */
  setWave(bank: VsuWaveBank, values: VsuWaveSamples): Result;
  /** Set one Wave RAM sample. Index 0–31, value 0–63. The shared RAM write lock applies. */
  setWaveSample(bank: VsuWaveBank, index: number, value: number): Result;
  /** Set left and right stereo levels independently from 0 to 15. */
  setVolume(channel: VsuChannel, left: number, right: number): Result;
  /** Select a bank for CH1–5. The Noise channel has no wave bank. */
  setWaveBank(channel: VsuWaveChannel, bank: VsuWaveBank): Result;
  /** Write the 11-bit VSU frequency register (0–2047). */
  setFrequencyRegister(channel: VsuChannel, value: number): Result;
  /** Open the hardware gate. Omit the interval for continuous output, or pass the register index 0–31. */
  keyOn(channel: VsuChannel, interval?: number | null): Result;
  /** Close the hardware gate immediately. */
  keyOff(channel: VsuChannel): Result;
  /** Update the supplied settings. Writing level, rate, or direction reloads the envelope. */
  setEnvelope(channel: VsuChannel, settings: VsuEnvelopeSettings): Result;
  /** Reload the currently programmed EV0 without changing the note gate. */
  resetEnvelope(channel: VsuChannel): Result;
  /** Set pitch and reload the envelope before opening the gate. On CH6 the note sets the Noise shift rate. */
  noteOn(channel: VsuChannel, note: string | number): Result;
  /** Release a PCM voice with an 8 ms software fade. Release CH6 immediately. */
  noteOff(channel: VsuChannel): Result;
  /** Write the chip's global stop register. */
  allNotesOff(): Result;
}

interface VsuOperationBuilder extends VsuRegisterControls<VsuOperationBuilder> {
  /** Advance to an absolute seconds offset from the start of playback. */
  atSeconds(offset: number): VsuOperationBuilder;
  /** Advance to an absolute sample offset at the build reference rate (default 44100 Hz). */
  atSample(offset: number): VsuOperationBuilder;
}
interface VsuTimedWrite {
  offsetSeconds: number;
  register: number;
  value: number;
  /** Merge the marked bits at playback time. Mask 0 reloads the current EV0 byte. */
  mask?: number;
  /** Start an 8 ms PCM release at this row's time. The gate closes when the fade ends. */
  fadeMs?: 8;
  operationIndex: number;
  writeIndex: number;
}
interface VsuOperations {
  version: 1;
  chip: 'vsu';
  referenceSampleRate: number;
  writes: VsuTimedWrite[];
}
interface VsuScheduleReceipt {
  name: string;
  entries: number;
  sampleRate: number;
  startFrame?: number;
  repeatSeconds?: number;
  staged?: true;
}
interface VsuCodeClient extends VsuRegisterControls<void> {
  readonly id: 'vsu';
  /** Record a synchronous callback at build time. Equal offsets keep the order of writes. */
  build<Result>(callback: (builder: VsuOperationBuilder) => Result & (Result extends PromiseLike<unknown> ? never : unknown), options?: { referenceSampleRate?: number }): VsuOperations;
  /** Inspect the planned writes without changing playback. The hardware write locks apply when played. */
  compile(operations: VsuOperations, options?: Record<string, never>): Promise<VsuTimedWrite[]>;
  /** Reserve a named Worklet pattern. Repeat time must exceed the final write offset. */
  schedule(operations: VsuOperations, options: { name: string; repeatSeconds?: number }): Promise<VsuScheduleReceipt>;
  /** Cancel the named pattern and release any notes it still owns. */
  clearSchedule(name: string): Promise<boolean>;
}
type PlaygroundLivePrepareAPI = VsuCodeAPI;
/** Borrow the VSU Synth's six hardware voices. */
declare function useSoundChip(name: 'vsu'): Promise<VsuCodeClient>;
declare function trackAsync(task: PromiseLike<unknown>): void;
declare function parseNoteName(note: string): number;
declare function midiToNoteName(midi: number): string;
declare const pg: VsuCodeAPI;
`;

export function selectVsuCodeDeclarations(source) {
	return selectCodeHostDeclarations(source, {
		globals: VSU_CODE_GLOBALS,
		customTypes: TYPES,
		apiName: 'VsuCodeAPI',
		banner: 'VSU Synth Code uses the editor’s six physical channels.',
	});
}

const PITCH_CLASSES = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];
const NOTE_VALUES = Array.from({ length: 128 }, (_, midi) => {
	return PITCH_CLASSES[midi % 12].split('/').map(name => [name + (Math.floor(midi / 12) - 1), `MIDI ${midi}`]);
}).flat();

function registerValues() {
	const format = offset => `0x${offset.toString(16).padStart(3, '0')}`;
	const values = Array.from({ length: VSU_WAVE_BANK_COUNT }, (_, bank) =>
		[format(vsuWaveOffset(bank, 0)), `Wave RAM bank ${bank} start`]);
	values.push(['0x280', 'CH5 Modulation RAM start']);
	for (let channel = 0; channel < VSU_CHANNEL_COUNT; channel++) {
		for (const [name, offset] of Object.entries(VSU_REGISTERS)) {
			if ((name === 'SWP' && channel !== 4) || (name === 'RAM' && channel === 5)) continue;
			values.push([format(vsuChannelRegister(channel, offset)), `CH${channel + 1} ${name}`]);
		}
	}
	values.push([format(VSU_SOUND_STOP), 'Global stop']);
	return values;
}
const REGISTER_VALUES = registerValues();

function isVsuReceiver(source, receiver) {
	const aliases = new Set(Array.from(source.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*await\s+(?:pg\.)?useSoundChip\s*\(\s*(["'])vsu\2\s*\)/g), match => match[1]));
	for (const [, chip, builder] of source.matchAll(/([\w$]+)\s*\.\s*build\s*\(\s*\(?\s*([\w$]+)\s*\)?\s*=>/g)) {
		if (aliases.has(chip)) aliases.add(builder);
	}
	for (const [, alias, builder] of source.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*([\w$]+)\s*\.\s*(?:atSeconds|atSample)\s*\(/g)) {
		if (aliases.has(builder)) aliases.add(alias);
	}
	return aliases.has(receiver);
}

function literalContext(prefix, getSource) {
	if (/^\s*(?:\/\/|\*)/.test(prefix)) return;
	const chip = /(?:^|[^\w$.])(?:pg\.)?useSoundChip\s*\(\s*(["'])([^"']*)$/.exec(prefix);
	if (chip) return { typed: chip[2], quote: chip[1], values: [['vsu', 'Virtual Boy Virtual Sound Unit']] };
	const note = /\.\s*noteOn\s*\(\s*[^,;]+,\s*(["'])([^"']*)$/.exec(prefix);
	const register = /\.\s*write\s*\(\s*(0x[\da-f]*|\d*)$/i.exec(prefix);
	const call = note ?? register;
	if (!call) return;
	const receiver = /([\w$]+)(?:\s*\.\s*[\w$]+\s*\([^()]*\))*\s*$/.exec(prefix.slice(0, call.index))?.[1];
	if (!receiver || !isVsuReceiver(getSource(), receiver)) return;
	return note ? { typed: note[2], quote: note[1], values: NOTE_VALUES }
		: { typed: register[1], values: REGISTER_VALUES };
}

export function registerVsuCodeCompletions({ monaco, monacoEditor }) {
	const provider = monaco.languages.registerCompletionItemProvider('javascript', {
		triggerCharacters: ['"', "'", '(', 'x'],
		provideCompletionItems(model, position) {
			if (model !== monacoEditor.getModel()) return;
			const { lineNumber, column } = position;
			const line = model.getLineContent(lineNumber);
			const context = literalContext(line.slice(0, column - 1), () =>
				model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: lineNumber, endColumn: column }));
			if (!context) return;
			const tail = line.slice(column - 1);
			const remaining = context.quote ? Math.max(0, tail.indexOf(context.quote)) : /^[\da-f]*/i.exec(tail)[0].length;
			const range = { startLineNumber: lineNumber, endLineNumber: lineNumber,
				startColumn: column - context.typed.length, endColumn: column + remaining };
			const kind = context.quote ? monaco.languages.CompletionItemKind.Value : monaco.languages.CompletionItemKind.Constant;
			return { suggestions: context.values.map(([value, detail]) => ({ label: value, insertText: value, kind, detail, range })) };
		},
	});
	monacoEditor.onDidDispose(() => provider.dispose());
}
