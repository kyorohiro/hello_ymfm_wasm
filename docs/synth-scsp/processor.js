// SPDX-License-Identifier: BSD-3-Clause
import factory from '../generated/scsp_wasm.js';
import { Scsp } from '../js/scsp.js';
import { Pcm44100Resampler } from '../js/pcm_44100_resampler.js';
import { SynthInstrument } from './instrument.js';
class SynthProcessor extends AudioWorkletProcessor {
	constructor({ processorOptions = {} } = {}) {
		super();
		this.dead = false;
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
					else if (data.method === 'loadAudition') {
						value = this.audition.loadPatch(...(data.args ?? []));
						this.audition.setPitchBend(this.instrument.pitchBend);
						this.auditionResampler.reset();
						this.auditionRendering = false;
					} else if (data.method === 'auditionOn') {
						value = this.audition.noteOn(...(data.args ?? []));
						this.auditionRendering = true;
					} else if (data.method === 'auditionOff')
						value = this.audition.noteOff(...(data.args ?? []));
					else if (data.method === 'stopAudition') {
						value = this.audition.stopVoices();
						this.auditionResampler.reset();
						this.auditionRendering = false;
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
					this.port.postMessage({
						id: data.id,
						error: error.message,
						name: error.name,
					});
				}
			});
		};
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
