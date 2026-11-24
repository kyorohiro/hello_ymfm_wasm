// SPDX-License-Identifier: BSD-3-Clause
import { createPlaygroundCodeRuntime } from '../js/playground_code_runtime.js';
import { createFm2610CodeEffects } from './code_fx.js';

function starterCode(mode) {
	return `const opnb = await useSoundChip("${mode}");
setBpm(116);

await opnb.fm.setPreset(CH1, FM_PRESETS["one-op-basic"]);
await opnb.fm.setPreset(CH2, FM_PRESETS["two-op-bell"]);

liveLoop("duet", async () => {
  for (const [bass, lead] of [
    ["D3", "A4"], ["D3", "C5"], ["Bb2", "F4"], ["C3", "G4"],
  ]) {
    await opnb.fm.noteOn(CH1, bass);
    await opnb.fm.noteOn(CH2, lead);
    await beat(0.65);
    await opnb.fm.noteOff(CH2);
    await opnb.fm.noteOff(CH1);
    await beat(0.35);
  }
});
`;
}

function makeCodeInstrument(audio, instrument) {
	return new Proxy(instrument, {
		get(target, property) {
			const value = Reflect.get(target, property, target);
			return typeof value === 'function'
				? (...args) => audio.withCodeWrites(() => Reflect.apply(value, target, args))
				: value;
		},
	});
}

/** Bind the Code panel to the selected YM2610 variant and the page's audio owner. */
export function setupFm2610Code({
	textarea, runButton, applyButton, stopButton, status, output, sound, getMode, stopSound,
	beforeRun = () => {}, onState = () => {}, prepareSource, readFile, getEntryPath = () => '/index.js',
	createFxRack,
}) {
	let starter = starterCode(getMode());
	if (!textarea.value) textarea.value = starter;
	let revision = 0;
	let audio = null;
	let chip = null;
	let observation = null;
	let retained = null;
	const log = [];
	const appendLog = line => {
		log.push(line);
		if (log.length > 100) log.shift();
		output.textContent = log.join('\n');
	};
	const effects = createFm2610CodeEffects({createRack: createFxRack, onLog: appendLog});

	function updateControls(state) {
		status.textContent = state.status;
		runButton.disabled = state.busy;
		if (applyButton) applyButton.disabled = !state.running || state.busy;
		stopButton.disabled = !state.running;
	}

	function retainSnapshot() {
		if (!observation) return;
		observation.finish();
		retained = observation;
		observation = null;
	}

	const runtime = createPlaygroundCodeRuntime({
		supportedSoundChips: ['ym2610', 'ym2610b'],
		fx: effects.fx,
		prepareSource,
		readFile,
		async ensureReady() {
			const token = revision;
			const mode = getMode();
			const nextAudio = await sound();
			if (token !== revision || mode !== getMode()) {
				throw new DOMException('Code stopped', 'AbortError');
			}
			if (observation && audio === nextAudio && chip?.id === mode) return;
			await effects.prepare(nextAudio);
			if (token !== revision || mode !== getMode()) throw new DOMException('Code stopped', 'AbortError');
			observation = nextAudio.beginCodeObservation();
			retained = null;
			chip = { id: mode };
			for (const section of ['fm', 'ssg', 'adpcmA', 'adpcmB']) {
				chip[section] = makeCodeInstrument(nextAudio, nextAudio[section]);
			}
			audio = nextAudio;
		},
		now: () => audio?.context.currentTime ?? 0,
		getFm: () => chip?.fm ?? null,
		useSoundChip(name) {
			if (name !== chip.id) {
				throw new RangeError(`This Synth is using ${chip.id}. Use useSoundChip("${chip.id}") or change the chip in the Synth.`);
			}
			return chip;
		},
		onState(state) {
			effects.setBpm(state.bpm);
			updateControls(state);
			onState(state);
		},
		onLog: appendLog,
		beforeStopSoundChips: retainSnapshot,
		async stopSoundChips() {
			const previous = audio;
			audio = null;
			chip = null;
			try { if (previous) await stopSound(previous); }
			finally { effects.stop(); }
		},
	});
	updateControls(runtime.getState());

	function run() {
		retainSnapshot();
		beforeRun();
		revision++;
		log.length = 0;
		output.textContent = '';
		return runtime.run(textarea.value, {path: getEntryPath()});
	}

	function apply() {
		const state = runtime.getState();
		if (!state.running || state.busy) return Promise.resolve(state);
		return runtime.apply(textarea.value, {path: getEntryPath()});
	}

	function stop() {
		retainSnapshot();
		revision++;
		return runtime.stop();
	}

	function getSnapshot() {
		return (observation ?? retained)?.getSnapshot() ?? null;
	}

	function hasRetainedSnapshot() {
		const state = runtime.getState();
		return Boolean(retained && !state.running && !state.stopping);
	}

	function observationFor(snapshot, customWindow) {
		const current = observation ?? retained;
		if (!snapshot || snapshot !== current?.getSnapshot() ||
				(customWindow !== undefined && !hasRetainedSnapshot())) return null;
		return current;
	}

	function setMode() {
		const updated = starterCode(getMode());
		const changed = textarea.value === starter;
		if (changed) textarea.value = updated;
		starter = updated;
		return changed;
	}

	function report(error) {
		if (error?.name !== 'AbortError') status.textContent = `Code error: ${error?.message ?? error}`;
	}

	runButton.addEventListener('click', () => void run().catch(report));
	applyButton?.addEventListener('click', () => void apply().catch(report));
	stopButton.addEventListener('click', () => void stop().catch(report));
	return {
		run, apply, stop, setMode, getStarter: () => starter, getState: runtime.getState,
		getSnapshot, getFmSnapshot: getSnapshot, hasRetainedSnapshot,
		clearSnapshot() { retained = null; },
		getAdpcmAWindow(snapshot, channel, customWindow) {
			return observationFor(snapshot, customWindow)
				?.getAdpcmAWindow(channel, snapshot.adpcm.adpcmA, customWindow) ?? null;
		},
		retainAdpcmARom(snapshot) {
			return hasRetainedSnapshot() ?
				observationFor(snapshot)?.retainAdpcmARom(snapshot.adpcm.adpcmA) ?? null : null;
		},
		readAdpcmABytes(snapshot, channel, customWindow) {
			return observationFor(snapshot, customWindow)
				?.readAdpcmABytes(channel, snapshot.adpcm.adpcmA, customWindow) ?? null;
		},
		readAdpcmBBytes(snapshot) {
			return observationFor(snapshot)?.readAdpcmBBytes(snapshot.adpcm.adpcmB) ?? null;
		},
	};
}
