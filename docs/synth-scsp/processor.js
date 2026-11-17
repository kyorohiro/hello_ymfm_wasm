// SPDX-License-Identifier: BSD-3-Clause
import factory from '../generated/scsp_wasm.js';
import { Scsp } from '../js/scsp.js';
import { Pcm44100Resampler } from '../js/pcm_44100_resampler.js';
import { SynthInstrument } from './instrument.js?v=scsp-dsp-fir-1';

function auditionToken(value) {
	if (typeof value !== 'string' || !value.length || value.length > 256)
		throw new TypeError(
			'Audition selection token must be a nonempty string of at most 256 characters',
		);
	return value;
}
function staleAudition() {
	const error = new Error('SSF audition selection changed');
	error.name = 'AbortError';
	return error;
}
function validateAuditionLoad(preset, bend) {
	// Validate the complete incoming sound and the current performance bend
	// before replacing a native preview. This model never renders or owns audio.
	const check = new SynthInstrument({
		sampleRate: 44100,
		reset() {},
		write() {},
		loadRam() {},
		readRam(_address, length = 524288) {
			return new Uint8Array(length);
		},
		renderInto() {},
		dispose() {},
	});
	try {
		check.loadPatch(preset);
		check.setPitchBend(bend);
	} finally {
		check.dispose();
	}
}
class SynthProcessor extends AudioWorkletProcessor {
	constructor({ processorOptions = {} } = {}) {
		super();
		this.dead = false;
		this.auditionToken = null;
		this.legacyAudition = true;
		this.ready = Scsp.create({
			moduleFactory: factory,
			moduleOptions: { wasmBinary: processorOptions.wasmBinary },
		})
			.then(async (core) => {
				if (this.dead) {
					core.dispose();
					return;
				}
				this.instrument = new SynthInstrument(core);
				this.instrument.synth.prepare(128);
				this.resampler = new Pcm44100Resampler(this.instrument.synth, sampleRate);
				// A second native handle shares the compiled module and output, while
				// keeping paused-song audition RAM and voices out of the authored patch.
				const auditionCore = await Scsp.create({
					moduleFactory: () => core.module,
				});
				if (this.dead) {
					auditionCore.dispose();
					return;
				}
				this.audition = new SynthInstrument(auditionCore);
				this.audition.synth.prepare(128);
				this.auditionResampler = new Pcm44100Resampler(this.audition.synth, sampleRate);
				this.auditionRendering = false;
				this.auditionLeft = new Float32Array(128);
				this.auditionRight = new Float32Array(128);
				this.port.postMessage({
					ready: true,
					state: this.instrument.read(),
				});
			})
			.catch((error) => {
				this.instrument?.dispose();
				this.audition?.dispose();
				this.port.postMessage({ fatal: true, error: error.message });
			});
		this.port.onmessage = ({ data }) => {
			if (data.method === 'dispose') {
				this.dead = true;
				this.instrument?.dispose();
				this.audition?.dispose();
				return;
			}
			void this.ready.then(() => {
				if (this.dead) return;
				try {
					let value;
					if (data.type === 'chip-inspector')
						value =
							data.action === 'read'
								? this.instrument.read()
								: this.instrument.invoke(data.method, data.args);
					else if (data.method === 'setClickGuard') {
						const args = data.args ?? [];
						if (args.length !== 1 || typeof args[0] !== 'boolean')
							throw new TypeError('SCSP Click guard requires one boolean');
						value = this.instrument.setClickGuard(args[0]);
						this.audition.setClickGuard(args[0]);
					} else if (data.method === 'loadAudition') {
						const args = data.args ?? [];
						if (!Array.isArray(args) || ![1, 2].includes(args.length))
							throw new TypeError(
								'loadAudition takes a preset and optional selection token',
							);
						const token = args.length === 2 ? auditionToken(args[1]) : null;
						validateAuditionLoad(args[0], this.instrument.pitchBend);
						value = this.audition.loadPatch(args[0]);
						this.audition.setPitchBend(this.instrument.pitchBend);
						this.auditionToken = token;
						this.legacyAudition = args.length === 1;
						this.auditionResampler.reset();
						this.auditionRendering = false;
					} else if (data.method === 'invokeAudition') {
						const args = data.args ?? [];
						if (!Array.isArray(args) || args.length !== 3)
							throw new TypeError(
								'invokeAudition takes a selection token, method and arguments',
							);
						this.checkAuditionOwner(args[0], true);
						const [, method, parameters] = args;
						if (!['setEnvelope', 'setLfo', 'setMix'].includes(method))
							throw new TypeError(
								'Editable audition supports only Envelope, LFO and Mix',
							);
						if (
							!Array.isArray(parameters) ||
							parameters.length !== 2 ||
							parameters[0] !== 0
						)
							throw new TypeError(
								'Editable audition addresses source A (slot 0) only',
							);
						this.audition.invoke(method, parameters);
						const state = this.audition.read();
						value = { state, voice: state.slots[0] };
					} else if (data.method === 'auditionOn') {
						const args = data.args ?? [];
						if (!Array.isArray(args) || ![2, 3].includes(args.length))
							throw new TypeError(
								'auditionOn takes identity, MIDI note and optional selection token',
							);
						this.checkAuditionOwner(args[2], args.length === 3);
						value = this.audition.noteOn(args[0], args[1]);
						this.auditionRendering = true;
					} else if (data.method === 'auditionOff') {
						const args = data.args ?? [];
						if (!Array.isArray(args) || ![1, 2].includes(args.length))
							throw new TypeError(
								'auditionOff takes identity and optional selection token',
							);
						this.checkAuditionOwner(args[1], args.length === 2);
						value = this.audition.noteOff(args[0]);
					} else if (data.method === 'stopAudition') {
						const args = data.args ?? [];
						if (!Array.isArray(args) || args.length > 1)
							throw new TypeError('stopAudition takes an optional selection token');
						if (args.length && auditionToken(args[0]) !== this.auditionToken)
							value = false;
						else {
							value = this.audition.stopVoices();
							this.auditionToken = null;
							this.auditionResampler.reset();
							this.auditionRendering = false;
						}
					} else if (data.method === 'readAudition') value = this.audition.read();
					else if (
						[
							'loadIdleState',
							'readPhysical',
							'invokePhysical',
							'physicalNoteOn',
							'physicalNoteOff',
							'stopPhysicalVoices',
							'noteOn',
							'noteOff',
							'setConfig',
							'setEffect',
							'readDspProgram',
							'applyDspProgram',
							'readDspCoefficients',
							'setDspCoefficients',
							'setPitchBend',
							'loadPatch',
							'exportPatch',
							'stopVoices',
							'beginCode',
							'code',
							'endCode',
							'readAuthoring',
						].includes(data.method)
					) {
						const config = this.instrument.config,
							codeActive = this.instrument.codeActive;
						value = this.instrument[data.method](...(data.args ?? []));
						if (
							data.method === 'stopVoices' ||
							data.method === 'loadIdleState' ||
							(data.method === 'loadPatch' && !codeActive) ||
							(data.method !== 'loadPatch' &&
								(config.mode !== this.instrument.config.mode ||
									config.fm.algorithm !== this.instrument.config.fm.algorithm))
						)
							this.resampler.reset();
						if (data.method === 'setPitchBend')
							this.audition.setPitchBend(...(data.args ?? []));
					} else throw new Error('Unknown Synth command');
					if (data.id !== undefined) this.port.postMessage({ id: data.id, value });
				} catch (error) {
					if (error.fatal) {
						this.dead = true;
						this.instrument.dispose();
						this.audition.dispose();
						this.port.postMessage({ fatal: true, error: error.message });
					}
					this.port.postMessage({
						id: data.id,
						error: error.message,
						name: error.name,
					});
				}
			});
		};
	}
	checkAuditionOwner(token, provided) {
		if (provided) {
			if (auditionToken(token) !== this.auditionToken) throw staleAudition();
		} else if (!this.legacyAudition) throw staleAudition();
	}
	process(_inputs, outputs) {
		if (this.dead) return false;
		const [left, right] = outputs[0] ?? [];
		if (left && right) {
			if (this.resampler) this.resampler.render(left, right);
			else {
				left.fill(0);
				right.fill(0);
			}
			if (this.auditionRendering) {
				if (this.auditionLeft.length !== left.length) {
					this.auditionLeft = new Float32Array(left.length);
					this.auditionRight = new Float32Array(right.length);
				}
				this.auditionResampler.render(this.auditionLeft, this.auditionRight);
				for (let index = 0; index < left.length; index++) {
					left[index] += this.auditionLeft[index];
					right[index] += this.auditionRight[index];
				}
			}
		}
		return true;
	}
}
registerProcessor('tetorica-scsp-synth', SynthProcessor);
