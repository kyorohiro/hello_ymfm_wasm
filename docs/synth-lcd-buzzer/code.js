// SPDX-License-Identifier: BSD-3-Clause
import { createPlaygroundCodeRuntime } from '../js/playground_code_runtime.js';
import { setupSynthCodeControls } from '../synth/synth_code_controls.js';
import { selectCodeHostDeclarations } from '../synth/synth_code_declarations.js';
import { buzzerMidi } from './buzzer.js';

export const BUZZER_STARTER = `const buzzer = await useSoundChip("lcd-buzzer");
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
const types = `
type BuzzerNote = string | number;
interface BuzzerPattern {
  notes: Array<number | null>; bpm: number; gate: number; volume: number; loop: boolean;
}
interface BuzzerCodeChip {
  readonly id: 'lcd-buzzer';
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
declare function useSoundChip(name: 'lcd-buzzer'): Promise<BuzzerCodeChip>;
declare const pg: BuzzerCodeGlobals;
`;
const declarations = source => selectCodeHostDeclarations(source, {
	globals, customTypes: types, apiName: 'BuzzerCodeGlobals', banner: 'Tetorica SM510 Synth Code',
});

function checkChannel(channel) {
	if (channel !== 0) throw new RangeError('Tetorica SM510 Synth uses CH1.');
}

const patternNote = note => note === null ? null : buzzerMidi(note);

export function setupBuzzerCode({ workspace, performance, ensureAudio, now, sequence, setStatus, onExpandedChange }) {
	const { project, files } = workspace;
	const owner = Symbol('LCD Buzzer Code');
	const client = {
		id: 'lcd-buzzer',
		noteOn(channel, note) { checkChannel(channel); return performance.noteOn(note, owner); },
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
			return sequence.play(owner, loop);
		},
		stopPattern() { sequence.stop(owner); },
	};
	const release = () => { performance.noteOff(owner); sequence.stop(owner); };
	let controls, runtime;
	function getRuntime() {
		runtime ??= createPlaygroundCodeRuntime({
			supportedSoundChips: ['lcd-buzzer'],
			ensureReady: ensureAudio,
			now,
			useSoundChip: () => client,
			prepareSource: (...args) => project.prepareSavedSource(...args),
			readFile: (...args) => project.readSavedFile(...args),
			onLog: line => controls?.appendLog(line),
			onState: state => controls?.updateRuntimeState(state),
			beforeStopSoundChips: release,
			stopSoundChips: release,
		});
		return runtime;
	}
	controls = setupSynthCodeControls({
		project, files, getRuntime, setStatus, onExpandedChange,
		getStarterCode: () => BUZZER_STARTER,
		editorChip: 'lcd-buzzer',
		journalKey: 'tetorica-lcd-buzzer-pending-code',
		transformDeclarations: declarations,
		keepRunningOnKeyboard: true,
		allowTextFiles: true,
		writeText: (path, source) => project.writeEditorText(path, source),
		onModeChange(mode) { if (mode === 'code') performance.stopKeyboard(); },
	});
	return controls;
}
