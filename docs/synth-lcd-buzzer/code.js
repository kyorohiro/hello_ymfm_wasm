// SPDX-License-Identifier: BSD-3-Clause
import { createPlaygroundCodeRuntime } from '../js/playground_code_runtime.js';
import { setupSynthCodeControls } from '../synth/synth_code_controls.js';
import { selectCodeHostDeclarations } from '../synth/synth_code_declarations.js';
import { buzzerMidi } from './buzzer.js';
import { DIRECT_R, DK52_R, createSm510CodeChip, readSm510CycleSequence } from './sm510.js';
import { createSm511CodeChip, readSm511MelodySequence } from './sm511.js';

export const BUZZER_STARTER = `const buzzer = await useSoundChip("sm510-direct");
setBpm(120);

liveLoop("signal", async () => {
  for (const note of ["C4", "G4", "A4", null]) {
    if (note !== null) await buzzer.noteOn(CH1, note);
    await beat(0.3);
    buzzer.noteOff(CH1);
    await beat(0.2);
  }
});
`;

const globals = [
	'CH1', 'useSoundChip', 'file', 'log', 'console', 'context', 'pg',
	'setBpm', 'beat', 'nextBeat', 'sleep', 'sleepSamples', 'liveLoop', 'liveCleanup', 'stopLoop',
	'stopAllLoops', 'parseNoteName', 'midiToNoteName', 'scale', 'chord', 'choose', 'cycle', 'rand', 'rrange', 'randInt',
];
const sm510RegisterModes = {
	sm510: DK52_R,
	'sm510-direct': DIRECT_R,
	'sm510-dk52': DK52_R,
};
const sm510Ids = Object.keys(sm510RegisterModes);
const types = `
type BuzzerNote = string | number;
interface BuzzerPattern {
  notes: Array<number | null>; bpm: number; gate: number; volume: number; loop: boolean;
}
interface BuzzerPerformance {
  noteOn(channel: typeof CH1, note: BuzzerNote): Promise<boolean>;
  noteOff(channel: typeof CH1): void;
  allNotesOff(): void;
  getPattern(): BuzzerPattern;
  setPattern(notes: Array<BuzzerNote | null>): BuzzerPattern;
  setStep(index: number, note: BuzzerNote | null): BuzzerPattern;
  configure(settings: Partial<Omit<BuzzerPattern, 'notes'>>): BuzzerPattern;
  playPattern(options?: { loop?: boolean }): Promise<boolean>;
  stopPattern(): void;
}
interface BuzzerCodeChip extends BuzzerPerformance {
  readonly id: 'lcd-buzzer';
}
interface Sm510CycleBuilder {
  atCycle(machineCycle: number): Sm510CycleBuilder;
  write(register: Sm510CodeChip['REG_R'], value: number): Sm510CycleBuilder;
}
interface Sm510CycleSequence {
  readonly machineCycles: number;
}
interface Sm510CycleWrite {
  offsetSeconds: number; machineCycle: number; masterTick: number;
  register: 0; value: number; operationIndex: number; writeIndex: 0;
}
interface Sm510PulseTiming {
  highCycles: number; lowCycles: number; periodCycles: number; frequency: number; duty: number;
}
interface Sm510DirectCodeChip extends Sm510CodeChip<'sm510-direct'>, BuzzerPerformance {
  /** Find executable R1 phase timing. Duty 0 or 1 holds the latch with frequency 0. */
  pulseTiming(frequencyHz: number, duty?: number): Sm510PulseTiming;
}
interface Sm511MelodySequence {
  readonly commandCount: number;
}
interface Sm511MelodySlot {
  address: number; command: number; masterTick: number; durationTicks: number;
  offsetSeconds: number; durationSeconds: number;
}
interface BuzzerScheduleOptions {
  name: string; repeatSeconds?: number;
}
interface BuzzerScheduleReceipt extends BuzzerScheduleOptions {
  duration: number; startTime?: number; staged?: true;
}
interface BuzzerTimedPlayback<Sequence> {
  schedule(sequence: Sequence, options: BuzzerScheduleOptions): Promise<BuzzerScheduleReceipt | false>;
  clearSchedule(name: string): Promise<boolean>;
}
type Sm510CodeId = 'sm510' | 'sm510-direct' | 'sm510-dk52';
interface Sm510CodeChip<Id extends Sm510CodeId = Sm510CodeId> extends BuzzerTimedPlayback<Sm510CycleSequence> {
  readonly id: Id;
  readonly REG_R: 0;
  readonly clock: 32768;
  readonly machineCycleHz: 16384;
  write(register: Sm510CodeChip['REG_R'], value: number): void;
  build(record: (sequence: Sm510CycleBuilder) => void): Sm510CycleSequence;
  compile(sequence: Sm510CycleSequence): Sm510CycleWrite[];
  playCycles(sequence: Sm510CycleSequence): Promise<boolean>;
}
interface Sm511CodeChip extends BuzzerTimedPlayback<Sm511MelodySequence> {
  readonly id: 'sm511';
  readonly clock: 32768;
  setMelody(words: readonly number[] | Uint8Array): void;
  play(startAddress?: number): Promise<boolean>;
  stop(): void;
  build(startAddress?: number): Sm511MelodySequence;
  build(commands: readonly number[] | Uint8Array): Sm511MelodySequence;
  compile(sequence: Sm511MelodySequence): Sm511MelodySlot[];
  playMelody(commands: readonly number[] | Uint8Array): Promise<boolean>;
  stopMelody(): void;
}
type BuzzerCodeChipMap = {
  /** @deprecated Use sm510-direct or sm510-dk52 to choose an SM510 tone source in Code. */
  'lcd-buzzer': BuzzerCodeChip;
  /** Compatibility client. Notes use the Synth tone source; R writes use DK-52. */
  sm510: Sm510CodeChip<'sm510'> & BuzzerPerformance;
  'sm510-direct': Sm510DirectCodeChip;
  'sm510-dk52': Sm510CodeChip<'sm510-dk52'> & BuzzerPerformance;
  sm511: Sm511CodeChip;
};
declare function useSoundChip<Name extends keyof BuzzerCodeChipMap>(name: Name): Promise<BuzzerCodeChipMap[Name]>;
declare const pg: BuzzerCodeGlobals;
`;
export const buzzerCodeDeclarations = source => selectCodeHostDeclarations(source, {
	globals, customTypes: types, apiName: 'BuzzerCodeGlobals', banner: 'Tetorica SM510 Synth Code',
});

function checkChannel(channel) {
	if (channel !== 0) throw new RangeError('Tetorica SM510 Synth uses CH1.');
}

const patternNote = note => note === null ? null : buzzerMidi(note);

function withTimedPlayback(chip, capability) {
	Object.defineProperty(chip, '_timedOperations', { value: capability, configurable: true });
	return Object.assign(chip, { schedule: capability.schedule, clearSchedule: capability.clearSchedule });
}

export function setupBuzzerCode({
	workspace, performance, ensureAudio, now, sequence, r1, melody, scheduler, setStatus, onExpandedChange, onViewChange,
	onRunRequest, onStopRequest, onPlaybackChange,
}) {
	const { project, files } = workspace;
	const performanceOwners = Object.fromEntries(['lcd-buzzer', ...sm510Ids].map(id => [id, Symbol(`${id} performance Code`)]));
	function performanceMethods(owner, chip, toneMode) {
		return {
			noteOn(channel, note) { checkChannel(channel); return performance.noteOn(note, owner, { chip, toneMode }); },
			noteOff(channel) { checkChannel(channel); performance.noteOff(owner); },
			allNotesOff() { performance.noteOff(owner); },
			getPattern: sequence.getPattern,
			setPattern(notes) {
				if (!Array.isArray(notes)) throw new TypeError('Expected eight notes or rests.');
				return sequence.update({ notes: notes.map(patternNote) });
			},
			setStep(index, note) {
				const notes = sequence.getPattern().notes;
				if (!Number.isInteger(index) || index < 0 || index >= notes.length)
					throw new RangeError('Choose a step from 0 to 7.');
				notes[index] = patternNote(note);
				return sequence.update({ notes });
			},
			configure(settings) {
				if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
					Object.keys(settings).some(key => !['bpm', 'gate', 'volume', 'loop'].includes(key)))
					throw new TypeError('Configure accepts bpm, gate, volume, and loop.');
				return sequence.update(settings);
			},
			playPattern({ loop } = {}) {
				if (loop !== undefined && typeof loop !== 'boolean') throw new TypeError('Loop must be on or off.');
				return sequence.play(owner, loop, chip, toneMode);
			},
			stopPattern() { sequence.stop(owner); },
		};
	}
	const legacy = { id: 'lcd-buzzer', ...performanceMethods(performanceOwners['lcd-buzzer']) };
	const sm510Timed = scheduler.createClient({
		channel: 'sm510',
		prepare(plan, repeatSeconds) {
			const timeline = readSm510CycleSequence(plan);
			return r1.prepareScheduled(timeline, sm510RegisterModes[timeline.id], repeatSeconds);
		},
	});
	const sm511Timed = scheduler.createClient({
		channel: 'sm511',
		prepare(plan, repeatSeconds) {
			return melody.prepareScheduled(readSm511MelodySequence(plan), repeatSeconds);
		},
	});
	const sm511 = withTimedPlayback(createSm511CodeChip(melody), sm511Timed);
	const registerClients = new Map();
	const release = () => {
		for (const owner of Object.values(performanceOwners)) {
			performance.noteOff(owner);
			sequence.stop(owner);
		}
		r1.stop();
		melody.stop();
	};
	let controls, runtime;
	function getRuntime() {
		runtime ??= createPlaygroundCodeRuntime({
			supportedSoundChips: ['lcd-buzzer', ...sm510Ids, 'sm511'],
			ensureReady: ensureAudio,
			now,
			async useSoundChip(name) {
				if (name === 'lcd-buzzer') return legacy;
				if (name === 'sm511') return sm511;
				const core = await r1.prepare();
				if (!registerClients.has(name)) {
					const mode = sm510RegisterModes[name];
					const chip = withTimedPlayback(createSm510CodeChip({
						id: name,
						write: value => r1.write(value, core, mode),
						playCycles: plan => r1.playCycles(plan, mode),
					}), sm510Timed);
					Object.assign(chip, performanceMethods(performanceOwners[name], 'sm510', name === 'sm510' ? undefined : mode));
					if (mode === DIRECT_R) chip.pulseTiming = (frequencyHz, duty) => {
						if (!Number.isFinite(frequencyHz) || frequencyHz <= 0)
							throw new RangeError('Use a positive pulse frequency in Hz.');
						return core.directPulseTiming(core.directHalfCycles(frequencyHz), duty);
					};
					registerClients.set(name, chip);
				}
				return registerClients.get(name);
			},
			prepareSource: (...args) => project.prepareSavedSource(...args),
			readFile: (...args) => project.readSavedFile(...args),
			onLog: line => controls?.appendLog(line),
			onState(state) {
				if (state.state === 'error') { r1.stop(); melody.stop(); }
				controls?.updateRuntimeState(state);
			},
			beforeStopSoundChips: release,
			stopSoundChips: release,
		});
		return runtime;
	}
	controls = setupSynthCodeControls({
		project, files, getRuntime, setStatus, onExpandedChange, onViewChange,
		onRunRequest, onStopRequest, onPlaybackChange,
		getStarterCode: () => BUZZER_STARTER,
		editorChip: 'sm510',
		journalKey: 'tetorica-lcd-buzzer-pending-code',
		transformDeclarations: buzzerCodeDeclarations,
		keepRunningOnKeyboard: true,
		persistentExpanded: true,
		allowTextFiles: true,
		writeText: (path, source) => project.writeEditorText(path, source),
	});
	return controls;
}
