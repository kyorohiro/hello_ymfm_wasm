// Exercise the real shared runtime without creating an audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaygroundCodeRuntime } from '../js/playground_code_runtime.js';
import { ASWAN_STARTER_CODE } from './code_host.js';
import { resolveAswanCodeNoteTarget } from './code_audio.js';
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));
async function until(fn) {
	const end = performance.now() + 3000;
	while (performance.now() < end) {
		if (fn()) return;
		await turn();
	}
	throw Error('Runtime did not reach expected gate');
}
function fixture(source = 'wave', sweep = false) {
	const calls = [];
	const client = {
		getState: async () => ({ editorSource: source, preset: { sweep: { enabled: sweep } } }),
		noteOn: async (...args) => calls.push(['on', ...args]),
		noteOff: async (...args) => calls.push(['off', ...args]),
		keyOff: async (...args) => calls.push(['raw-off', ...args]),
	};
	const runtime = createPlaygroundCodeRuntime({
		ensureReady: async () => {},
		now: () => performance.now() / 1000,
		supportedSoundChips: ['wonderswan'],
		useSoundChip: async () => client,
		resolveNoteTarget: (...args) => resolveAswanCodeNoteTarget(client, ...args),
		stopSoundChips: async () => calls.push(['stop']),
		guardExecution: false,
		createTaskChannel: () => null,
	});
	return {
		runtime,
		calls,
		setSource(value) {
			source = value;
		},
	};
}
test('ASWAN starter follows source selection with physical Wave/Noise/PCM channels, retaining a running loop', async () => {
	const f = fixture();
	try {
		await f.runtime.run(ASWAN_STARTER_CODE);
		await until(() => f.calls.some((c) => c[0] === 'on' && c[1] === 0));
		f.setSource('noise');
		await until(() => f.calls.some((c) => c[0] === 'on' && c[1] === 3));
		f.setSource('pcm');
		await until(() => f.calls.some((c) => c[0] === 'on' && c[1] === 1));
		assert(f.runtime.getState().running);
		assert.deepEqual(f.runtime.getState().loopNames, ['melody']);
		assert.equal(f.calls.filter((c) => c[0] === 'stop').length, 1);
		assert.match(ASWAN_STARTER_CODE, /await beat\(/);
		assert.doesNotMatch(ASWAN_STARTER_CODE, /\b(?:play|sleep)\(/);
	} finally {
		await f.runtime.stop();
	}
});
test('stopLoop releases one owned physical channel without stopping the shared editor chip', async () => {
	const f = fixture();
	try {
		await f.runtime.run(
			`const ws=await useSoundChip('wonderswan');context.cancel=()=>stopLoop('held');liveLoop('held',async()=>{await ws.noteOn(CH3,'C4');await beat(100);});`,
		);
		await until(() => f.calls.some((c) => c[0] === 'on' && c[1] === 2));
		const stops = f.calls.filter((c) => c[0] === 'stop').length;
		f.runtime.getContext().cancel();
		await until(() => f.calls.some((c) => c[0] === 'off' && c[1] === 2));
		assert.equal(f.calls.filter((c) => c[0] === 'stop').length, stops);
	} finally {
		await f.runtime.stop();
	}
});

test('ASWAN starter respects hardware Sweep physical CH3', async () => {
	const f = fixture('wave', true);
	try {
		await f.runtime.run(ASWAN_STARTER_CODE);
		await until(() => f.calls.some((c) => c[0] === 'on' && c[1] === 2));
		assert(!f.calls.some((c) => c[0] === 'on' && c[1] !== 2));
	} finally {
		await f.runtime.stop();
	}
});
