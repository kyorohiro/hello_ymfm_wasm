// SPDX-License-Identifier: BSD-3-Clause
import opllFactory from "../generated/ym2413_wasm.js";
import psgFactory from "../generated/segapsg_wasm.js";
import { createSmsGearSongEngine } from "./song_engine.js";
class SmsGearSongProcessor extends AudioWorkletProcessor {
	constructor(options) {
		super();
		this.engine = null;
		this.dead = false;
		this.seekId = null;
		const { plan, opllBinary, psgBinary } = options.processorOptions;
		createSmsGearSongEngine({
			plan,
			sampleRate,
			opllFactory,
			psgFactory,
			opllBinary,
			psgBinary,
		})
			.then((engine) => {
				if (this.dead) {
					engine.dispose();
					return;
				}
				this.engine = engine;
				this.port.postMessage({ ready: true });
			})
			.catch((error) => this.port.postMessage({ error: error.message }));
		this.port.onmessage = ({ data }) => {
			try {
				if (data.method === "dispose") {
					this.dead = true;
					this.engine?.dispose();
					this.engine = null;
					return;
				}
				if (!this.engine) throw Error("Song is not ready");
				if (data.method === "seek") {
					this.engine.beginSeek(data.value);
					this.seekId = data.id;
					return;
				}
				const value =
					data.method === "snapshot"
						? this.engine.snapshot()
						: data.method === "play"
							? this.engine.play()
							: data.method === "pause"
								? this.engine.pause()
								: data.method === "reset"
									? this.engine.reset()
									: data.method === "mix"
										? this.engine.setMix(data.value)
										: data.method === "channelMutes"
											? this.engine.setChannelMutes(
													data.value,
												)
											: undefined;
				if (data.id !== undefined)
					this.port.postMessage({ id: data.id, value });
			} catch (error) {
				this.port.postMessage({ id: data.id, error: error.message });
			}
		};
	}
	process(_inputs, outputs) {
		if (this.dead) return false;
		const [left, right] = outputs[0];
		if (this.engine) {
			this.engine.process(left, right);
			if (this.seekId !== null && !this.engine.seeking) {
				this.port.postMessage({
					id: this.seekId,
					value: this.engine.snapshot(),
				});
				this.seekId = null;
			}
		} else {
			left.fill(0);
			right.fill(0);
		}
		return true;
	}
}
registerProcessor("tetorica-smsgear-song", SmsGearSongProcessor);
