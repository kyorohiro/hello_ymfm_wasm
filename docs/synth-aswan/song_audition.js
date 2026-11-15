// SPDX-License-Identifier: BSD-3-Clause
// A private preview shares the existing Worklet and output, never the song or Auto instrument.
import { readPreset } from './preset.js';

const cancelled = () => new DOMException('ASWAN paused audition cancelled', 'AbortError');
const isAbort = (error) => error?.name === 'AbortError';
let nextToken = 0;
function identity(id) {
	if (typeof id !== 'string' || !id.length || id.length > 128)
		throw new TypeError('Audition note identity must contain 1–128 characters');
}
function selection(value) {
	if (value == null) return null;
	if (typeof value.key !== 'string' || !value.key.length || value.key.length > 8192)
		throw new TypeError('Paused audition needs a stable selection key');
	if (!Number.isInteger(value.channel) || value.channel < 0 || value.channel > 3)
		throw new RangeError('ASWAN audition channel must be 0..3');
	const preset = readPreset(value.preset);
	if (preset.source === 'pcm')
		throw new Error('A transient Voice PCM DAC snapshot has no complete sample to audition');
	if (
		(preset.source === 'noise' && value.channel !== 3) ||
		(preset.sweep.enabled && value.channel !== 2)
	)
		throw new Error('Noise uses CH4 and hardware Sweep uses CH3');
	const referenceNote = value.referenceNote ?? 60;
	if (!Number.isInteger(referenceNote) || referenceNote < 0 || referenceNote > 127)
		throw new RangeError('Audition reference note must be MIDI 0–127');
	if (!Number.isFinite(value.frequency) || value.frequency <= 0)
		throw new RangeError('Audition needs the recorded positive hardware frequency');
	const clock = value.clock ?? 3072000;
	if (!Number.isFinite(clock) || clock <= 0)
		throw new RangeError('Audition source clock must be positive');
	return {
		key: value.key,
		channel: value.channel,
		preset,
		frequency: value.frequency,
		referenceNote,
		clock,
		identity: JSON.stringify([
			value.key,
			value.channel,
			value.frequency,
			referenceNote,
			clock,
			preset.source,
		]),
		signature: JSON.stringify(preset),
	};
}

/** Selection keys identify the paused song run/frame/channel, not its editable
 * parameters. A generation also distinguishes A→B→A. Preset edits reuse the
 * current preview and do not release held notes. Every cleanup names its token.
 * Captured frequency is C4 by default; Noise keys transpose its hardware clock.
 */
export function createAswanSongAudition({
	ensureAudio,
	getAudio,
	onState = () => {},
	onError = () => {},
} = {}) {
	for (const callback of [ensureAudio, getAudio, onState, onError])
		if (typeof callback !== 'function')
			throw new TypeError('ASWAN audition needs host callbacks');
	let selected = null,
		epoch = 0,
		lease = null,
		disposed = false,
		pending = 0,
		tail = Promise.resolve(),
		lastError = '',
		pitch = 0;
	const notes = new Map();
	function read() {
		return {
			state: disposed
				? 'disposed'
				: lease?.ready
					? 'ready'
					: lease || pending
						? 'preparing'
						: lastError
							? 'error'
							: 'idle',
			active: Boolean(lease || pending || notes.size),
			heldCount: notes.size,
			channel: selected?.channel ?? null,
			key: selected?.key ?? null,
			hasSelection: Boolean(selected),
			token: lease?.token ?? null,
			loading: Boolean((lease && !lease.ready) || (pending && !lease)),
			source: selected?.preset.source ?? null,
			pitch,
			error: lastError,
			snapshot: lease?.snapshot ?? null,
		};
	}
	function emit() {
		if (!disposed)
			try {
				onState(read());
			} catch {}
	}
	function fail(error) {
		if (isAbort(error)) return;
		lastError = error?.message ?? String(error);
		try {
			onError(error);
		} catch {}
		emit();
	}
	function enqueue(work) {
		pending++;
		emit();
		const result = tail.then(work).finally(() => {
			pending--;
			emit();
		});
		tail = result.catch(() => {});
		return result;
	}
	const current = (item) =>
		!disposed &&
		lease === item &&
		!item.retired &&
		item.epoch === epoch &&
		selected?.identity === item.identity &&
		getAudio() === item.engine;
	function check(item) {
		if (!current(item)) throw cancelled();
	}
	function forget(note) {
		note.released = true;
		if (notes.get(note.id) === note) notes.delete(note.id);
	}
	function noteCurrent(note) {
		if (note.released || notes.get(note.id) !== note || note.epoch !== epoch) return false;
		try {
			return note.isCurrent() !== false;
		} catch {
			return false;
		}
	}
	function retire(item) {
		if (!item) return Promise.resolve(false);
		if (item.retirement) return item.retirement;
		item.retired = true;
		if (lease === item) lease = null;
		// Invalidate a pending engine load immediately, rather than waiting for the
		// serial note queue. An old retirement can never stop a newer token.
		try {
			item.retirement = Promise.resolve(item.engine.stopAudition(item.token));
		} catch (error) {
			item.retirement = Promise.reject(error);
		}
		void item.retirement.catch(() => {});
		return item.retirement;
	}
	async function syncPreset(item) {
		check(item);
		while (item.signature !== selected.signature) {
			const next = selected;
			await item.engine.invokeAudition(item.token, 'setPreset', [next.preset]);
			check(item);
			item.signature = next.signature;
		}
	}
	async function prepare(requestEpoch) {
		if (requestEpoch !== epoch || !selected || disposed) throw cancelled();
		if (lease?.ready && current(lease)) {
			await syncPreset(lease);
			return lease;
		}
		const target = selected;
		await ensureAudio();
		if (requestEpoch !== epoch || selected?.identity !== target.identity || disposed)
			throw cancelled();
		const engine = getAudio();
		if (
			!engine ||
			['loadAudition', 'invokeAudition', 'stopAudition'].some(
				(name) => typeof engine[name] !== 'function',
			)
		)
			throw new Error('Paused audition needs the existing ASWAN audio engine');
		const item = (lease = {
			engine,
			epoch: requestEpoch,
			identity: target.identity,
			signature: target.signature,
			token: `aswan-preview-${++nextToken}`,
			ready: false,
			retired: false,
			retirement: null,
			snapshot: null,
		});
		emit();
		try {
			const loaded = await engine.loadAudition(target.preset, {
				token: item.token,
				channel: target.channel,
				frequencyHz: target.frequency,
				referenceMidi: target.referenceNote,
				clock: target.clock,
			});
			check(item);
			if (loaded?.token !== item.token)
				throw new Error('ASWAN audition load returned a different token');
			item.snapshot = loaded.state ?? null;
			item.ready = true;
			await syncPreset(item);
			// Explicitly send zero too: the worklet may inherit the author's wheel.
			await engine.invokeAudition(item.token, 'setPitch', [pitch]);
			check(item);
			emit();
			return item;
		} catch (error) {
			await retire(item).catch(() => {});
			throw error;
		}
	}
	function setSelection(value) {
		if (disposed) return Promise.reject(new Error('ASWAN audition is disposed'));
		const next = selection(value);
		if (next?.identity === selected?.identity) {
			if (next?.signature === selected?.signature) return Promise.resolve(read());
			selected = next;
			lastError = '';
			return enqueue(async () => {
				const item = lease;
				if (!item?.ready || !current(item)) return read();
				try {
					await syncPreset(item);
					emit();
					return read();
				} catch (error) {
					if (!isAbort(error)) fail(error);
					throw error;
				}
			});
		}
		epoch++;
		selected = next;
		lastError = '';
		pitch = 0;
		for (const note of notes.values()) forget(note);
		const retired = retire(lease);
		emit();
		return retired.then(() => read());
	}
	function updateSelection(value) {
		if (!selected)
			return Promise.reject(new Error('Pause the song and choose a channel first'));
		return setSelection({ ...selected, ...value });
	}
	function noteOn(id, midi, { isCurrent = () => true } = {}) {
		identity(id);
		if (!Number.isInteger(midi) || midi < 0 || midi > 127)
			throw new RangeError('Audition note must be MIDI 0–127');
		if (typeof isCurrent !== 'function')
			throw new TypeError('Audition isCurrent must be a function');
		if (disposed) return Promise.reject(new Error('ASWAN audition is disposed'));
		if (!selected)
			return Promise.reject(new Error('Pause the song and choose a playable channel first'));
		if (notes.has(id))
			return Promise.reject(new Error('Audition note identity is already held'));
		const stolenId = [...notes.values()].at(-1)?.id ?? null;
		for (const note of notes.values()) forget(note);
		const note = { id, midi, isCurrent, epoch, released: false, item: null };
		notes.set(id, note);
		lastError = '';
		emit();
		return enqueue(async () => {
			let item;
			try {
				if (!noteCurrent(note)) {
					forget(note);
					return null;
				}
				item = await prepare(note.epoch);
				note.item = item;
				if (!noteCurrent(note)) {
					forget(note);
					return null;
				}
				check(item);
				const result = await item.engine.invokeAudition(item.token, 'noteOn', [id, midi]);
				if (!noteCurrent(note) || !current(item)) {
					await item.engine.invokeAudition(item.token, 'noteOff', [id]).catch(() => {});
					forget(note);
					return null;
				}
				emit();
				return { channel: selected.channel, stolenId, result };
			} catch (error) {
				forget(note);
				if (item) await retire(item).catch(() => {});
				if (isAbort(error)) return null;
				fail(error);
				throw error;
			}
		});
	}
	function noteOff(id) {
		identity(id);
		const note = notes.get(id);
		if (!note) return Promise.resolve(false);
		forget(note);
		emit();
		return enqueue(async () => {
			const item = note.item;
			if (!item || !current(item)) return false;
			try {
				await item.engine.invokeAudition(item.token, 'noteOff', [id]);
				emit();
				return true;
			} catch (error) {
				if (isAbort(error)) return false;
				fail(error);
				throw error;
			}
		});
	}
	function setPitch(value) {
		if (!Number.isFinite(value) || value < -48 || value > 48)
			throw new RangeError('Audition Pitch must be within ±48 semitones');
		if (disposed) return Promise.reject(new Error('ASWAN audition is disposed'));
		pitch = value;
		const requestEpoch = epoch;
		return enqueue(async () => {
			const item = lease;
			if (requestEpoch !== epoch || !item?.ready || !current(item)) return read();
			await item.engine.invokeAudition(item.token, 'setPitch', [pitch]);
			check(item);
			emit();
			return read();
		});
	}
	function stop() {
		epoch++;
		lastError = '';
		pitch = 0;
		for (const note of notes.values()) forget(note);
		const result = retire(lease);
		emit();
		return result.then(() => read());
	}
	function dispose() {
		if (disposed) return tail;
		disposed = true;
		selected = null;
		return stop();
	}
	return {
		setSelection,
		updateSelection,
		edit: (value) => updateSelection(value?.format ? { preset: value } : value),
		noteOn,
		noteOff,
		setPitch,
		read,
		stop,
		invalidate: stop,
		allNotesOff: stop,
		dispose,
	};
}
