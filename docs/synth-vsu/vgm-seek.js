// SPDX-License-Identifier: BSD-3-Clause
const VGM_RATE = 44100;
const RENDER_FRAMES = 2048;
const MAX_CHECKPOINTS = 256;
const WORK_MS = 8;

const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));

export function createVgmSeekRenderer(core, sampleRate) {
	const address = core.__heap_base.value;
	const size = core.vsu_size();
	const left = address + Math.ceil(size / 4) * 4;
	const right = left + 4 * RENDER_FRAMES;
	const end = right + 4 * RENDER_FRAMES;
	const { memory } = core;
	if (end > memory.buffer.byteLength) memory.grow(Math.ceil((end - memory.buffer.byteLength) / 65536));
	const state = new Uint8Array(memory.buffer, address, size);
	const frameAt = tick => Math.round(tick * sampleRate / VGM_RATE);
	const checkpoints = new Map();
	let loadedPlan = null, stride = 0, last = null;

	function nearestCheckpoint(target) {
		for (let frame = target - target % stride; frame > 0; frame -= stride) {
			if (last && last.frame >= frame && last.frame <= target) return last;
			if (checkpoints.has(frame)) return checkpoints.get(frame);
		}
		return last && last.frame <= target ? last : null;
	}

	return {
		async seek(plan, tick, { signal } = {}) {
			signal?.throwIfAborted();
			if (plan !== loadedPlan) {
				loadedPlan = plan;
				checkpoints.clear();
				last = null;
				stride = Math.max(sampleRate * 4, Math.ceil(frameAt(plan.durationTicks) / MAX_CHECKPOINTS));
			}
			const target = frameAt(tick);
			const checkpoint = nearestCheckpoint(target);
			let frame = checkpoint?.frame ?? 0;
			let cursor = checkpoint?.cursor ?? 0;
			if (checkpoint) state.set(checkpoint.bytes);
			else core.vsu_reset(address);

			const { writes } = plan;
			let deadline = performance.now() + WORK_MS;
			while (true) {
				// A checkpoint at this frame still includes every write that was
				// due at its rounded sample boundary, just like live playback.
				let written = 0;
				while (cursor < writes.length && frameAt(writes[cursor]) <= frame && written < 1024) {
					core.vsu_write(address, writes[cursor + 1], writes[cursor + 2]);
					cursor += 3;
					written++;
				}
				if (cursor === writes.length || frameAt(writes[cursor]) > frame) {
					if (frame && frame % stride === 0 && !checkpoints.has(frame)) {
						checkpoints.set(frame, { frame, cursor, bytes: state.slice() });
					}
					if (frame === target) break;
					const nextWrite = cursor < writes.length ? frameAt(writes[cursor]) : target;
					const nextCheckpoint = frame - frame % stride + stride;
					const count = Math.min(nextWrite, nextCheckpoint, target, frame + RENDER_FRAMES) - frame;
					core.vsu_render(address, left, right, count, sampleRate);
					frame += count;
				}
				if (performance.now() >= deadline) {
					await nextTurn();
					signal?.throwIfAborted();
					deadline = performance.now() + WORK_MS;
				}
			}
			signal?.throwIfAborted();
			last = { tick, frame, cursor, bytes: state.slice() };
			// The caller may transfer its copy without detaching the cached state.
			return { ...last, bytes: last.bytes.slice() };
		},
	};
}
