// SPDX-License-Identifier: BSD-3-Clause
import { SoundChipMixer } from '../js/soundchip_mixer.js';
import { NdsSynth } from './nds-synth-api.js?v=nds-shared-renderer-1';
import { loadSkyEmuModule, SKYEMU_SAMPLE_RATE } from './nds-skyemu-wasm.js?v=nds-shared-renderer-1';

const TIMEOUT = 12000;
const MAX_OUTSTANDING = 256;

function validateVolume(value) {
	if (!Number.isFinite(value) || value < 0 || value > 3.8)
		throw new RangeError('DS Master must be from 0 to 3.8.');
}

function deadline(promise, message) {
	let timer;
	const expiry = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(message)), TIMEOUT);
	});
	return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

/** One CPU-free DS audio instance shared by manual and Code voices. The 2SF
 * reference engine has its own output session because Pause freezes its clock. */
export async function createNdsAudio({ volume = .7, outputMix = {}, onError = () => {} } = {}) {
	validateVolume(volume);
	const mixer = new SoundChipMixer();
	mixer.set('nds', outputMix);
	const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
	if (!Context) throw new Error('Web Audio is unavailable.');
	const context = new Context({ latencyHint: 'interactive', sampleRate: SKYEMU_SAMPLE_RATE });
	const requests = new Map(), owners = Array(16).fill(null);
	let worklet, master, analyser, releaseOutput, closed = false, closing, nextId = 0;

	function dispose(error = new Error('DS audio is closed.')) {
		if (closed) return closing;
		closed = true;
		for (const { reject, timer } of requests.values()) {
			clearTimeout(timer);
			reject(error);
		}
		requests.clear();
		owners.fill(null);
		if (worklet) {
			worklet.onprocessorerror = null;
			worklet.port.onmessage = worklet.port.onmessageerror = null;
			worklet.port.postMessage({ method: 'dispose' });
			worklet.disconnect();
			worklet.port.close();
		}
		releaseOutput?.();
		master?.disconnect();
		analyser?.disconnect();
		closing = context.state === 'closed' ? Promise.resolve() : context.close();
		return closing;
	}

	function fail(error) {
		if (closed) return;
		void dispose(error).catch(() => {});
		onError(error);
	}

	function request(method, args = []) {
		if (closed || context.state === 'closed') return Promise.reject(new Error('Enable DS audio again.'));
		if (requests.size >= MAX_OUTSTANDING) return Promise.reject(new Error('DS audio command queue is full.'));
		const id = ++nextId;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => fail(new Error('The DS audio processor timed out.')), TIMEOUT);
			requests.set(id, { resolve, reject, timer });
			try {
				worklet.port.postMessage({ id, method, args });
			} catch (error) {
				clearTimeout(timer);
				requests.delete(id);
				reject(error);
			}
		});
	}

	try {
		if (!context.audioWorklet) throw new Error('DS Synth requires AudioWorklet over HTTPS or localhost.');
		const [module] = await deadline(Promise.all([
			loadSkyEmuModule(),
			context.resume(),
			context.audioWorklet.addModule(new URL('./nds-worklet.js?v=nds-keyboard-live-1', import.meta.url)),
		]), 'DS audio could not start. Check audio permission and try again.');
		worklet = new AudioWorkletNode(context, 'tetorica-nds-synth', {
			numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { module },
		});
		worklet.onprocessorerror = () => fail(new Error('The DS audio processor failed.'));
		worklet.port.onmessageerror = () => fail(new Error('The DS audio processor reply could not be read.'));
		worklet.port.onmessage = ({ data }) => {
			const command = requests.get(data?.id);
			if (!command) return;
			clearTimeout(command.timer);
			requests.delete(data.id);
			if (Array.isArray(data.owners)) owners.splice(0, owners.length, ...data.owners);
			if (!data.error) command.resolve(data.value);
			else {
				const error = new Error(data.error);
				error.name = data.name ?? 'Error';
				command.reject(error);
			}
		};
		master = context.createGain();
		master.gain.value = volume;
		analyser = context.createAnalyser();
		analyser.fftSize = 2048;
		releaseOutput = mixer.connect('nds', 'nds', master, analyser);
		worklet.connect(master);
		analyser.connect(context.destination);
		await request('ready');
	} catch (error) {
		await dispose(error).catch(() => {});
		throw error;
	}

	return {
		context, analyser,
		chip: new NdsSynth(request, { owners }),
		resume: () => deadline(context.resume(), 'DS audio could not resume.'),
		dispose,
		setVolume(value) {
			validateVolume(value);
			if (!closed) master.gain.setTargetAtTime(value, context.currentTime, .008);
		},
		setOutputMix(settings) {
			if (!closed) mixer.set('nds', settings);
		},
	};
}
