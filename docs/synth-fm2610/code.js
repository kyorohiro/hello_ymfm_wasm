// SPDX-License-Identifier: BSD-3-Clause
import { createPlaygroundCodeRuntime } from '../js/playground_code_runtime.js';

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

/** Bind the Code panel to the selected YM2610 variant and the page's audio owner. */
export function setupFm2610Code({ textarea, runButton, stopButton, status, output, sound, getMode, stopSound }) {
	let starter = starterCode(getMode());
	if (!textarea.value) textarea.value = starter;
	let revision = 0;
	let audio = null;
	let chip = null;
	const log = [];

	function updateControls(state) {
		status.textContent = state.status;
		runButton.disabled = state.busy;
		stopButton.disabled = !state.running;
	}

	const runtime = createPlaygroundCodeRuntime({
		supportedSoundChips: ['ym2610', 'ym2610b'],
		async ensureReady() {
			const token = revision;
			const mode = getMode();
			const nextAudio = await sound();
			if (token !== revision || mode !== getMode()) {
				throw new DOMException('Code stopped', 'AbortError');
			}
			const { fm, ssg, adpcmA, adpcmB } = nextAudio;
			chip = { id: mode, fm, ssg, adpcmA, adpcmB };
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
		onState: updateControls,
		onLog(line) {
			log.push(line);
			if (log.length > 100) log.shift();
			output.textContent = log.join('\n');
		},
		async stopSoundChips() {
			const previous = audio;
			audio = null;
			chip = null;
			if (previous) await stopSound(previous);
		},
	});
	updateControls(runtime.getState());

	function run() {
		revision++;
		log.length = 0;
		output.textContent = '';
		return runtime.run(textarea.value);
	}

	function stop() {
		revision++;
		return runtime.stop();
	}

	function setMode() {
		const updated = starterCode(getMode());
		if (textarea.value === starter) textarea.value = updated;
		starter = updated;
	}

	function report(error) {
		if (error?.name !== 'AbortError') status.textContent = `Code error: ${error?.message ?? error}`;
	}

	runButton.addEventListener('click', () => void run().catch(report));
	stopButton.addEventListener('click', () => void stop().catch(report));
	return { run, stop, setMode, getState: runtime.getState };
}
