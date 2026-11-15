// SPDX-License-Identifier: BSD-3-Clause
import { encodeScspSsfVoiceEdit } from './ssf_voice_parameters.js';

const copy = (value) => structuredClone(value);
const cancelled = () => new DOMException('SSF channel edit cancelled', 'AbortError');

/** Hold manual register edits until their rendered frames become audible.
 * Pausing retains them across channel / Reference choices. They never mutate
 * a source observation; later audible driver snapshots replace the overlay.
 */
export class ScspSsfVoiceEdits {
	constructor() {
		this.session = null;
		this.records = new Map();
	}
	sync(session, playback, snapshot) {
		if (session !== this.session || !['playing', 'paused', 'seeking'].includes(playback)) {
			this.records.clear();
			this.session = session;
		}
		if (playback === 'playing' && snapshot)
			for (const [slot, record] of this.records) {
				record.edits = record.edits.filter((edit) => snapshot.frame <= edit.frame);
				if (!record.edits.length && !record.pending) this.records.delete(slot);
			}
	}
	valid(target, session = this.session) {
		return session !== null && session === this.session &&
			Number.isInteger(target?.slot) && target.slot >= 0 && target.slot < 32 &&
			Boolean(target.snapshot?.slots?.[target.slot]?.voice);
	}
	pending(target, delta, session = this.session) {
		if (!this.valid(target, session)) return;
		let record = this.records.get(target.slot);
		if (!record && delta > 0) this.records.set(target.slot, record = { edits: [], pending: 0 });
		if (record) record.pending = Math.max(0, record.pending + delta);
	}
	commit(target, method, patch, result) {
		if (!this.valid(target, result?.session)) throw cancelled();
		const writes = encodeScspSsfVoiceEdit(method, patch);
		const frame = result.nativeFrame;
		if (!Number.isSafeInteger(frame) || frame < 0) throw new TypeError('Invalid SSF edit frame');
		if (!writes.length) return;
		let record = this.records.get(target.slot);
		if (!record) this.records.set(target.slot, record = { edits: [], pending: 0 });
		// Retain only the newest manual write to each parameter, even during a
		// long paused drag. Other parameters keep their own audible-frame fences.
		for (const edit of record.edits) if (edit.method === method) {
			for (const key of Object.keys(patch)) delete edit.patch[key];
			edit.writes = encodeScspSsfVoiceEdit(edit.method, edit.patch);
		}
		record.edits = record.edits.filter((edit) => edit.writes.length);
		record.edits.push({ method, patch: copy(patch), writes: writes.slice(), frame });
	}
	read(target) {
		if (!this.valid(target)) return null;
		const voice = copy(target.snapshot.slots[target.slot].voice);
		const record = this.records.get(target.slot);
		for (const { method, patch } of record?.edits ?? []) {
			if (method === 'setEnvelope') Object.assign(voice.envelope, copy(patch));
			else if (method === 'setLfo') Object.assign(voice.lfo, copy(patch));
			else Object.assign(voice, copy(patch));
		}
		return { voice, edited: Boolean(record?.edits.length), pending: Boolean(record?.pending) };
	}
	projectSnapshot(target) {
		const state = this.read(target);
		if (!state?.edited) return target.snapshot;
		const original = target.snapshot.slots[target.slot];
		const registers = original.registers.slice();
		for (const edit of this.records.get(target.slot).edits)
			for (let i = 0; i < edit.writes.length; i += 3) {
				const offset = edit.writes[i], mask = edit.writes[i + 1], value = edit.writes[i + 2];
				registers[offset / 2] = (registers[offset / 2] & ~mask) | (value & mask);
			}
		const slots = target.snapshot.slots.slice();
		slots[target.slot] = {
			...original, registers, voice: state.voice,
			flags: { ...original.flags, loopLink: state.voice.envelope.loopLink },
		};
		return { ...target.snapshot, slots };
	}
}
