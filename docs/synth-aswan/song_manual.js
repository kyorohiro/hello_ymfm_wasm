// SPDX-License-Identifier: BSD-3-Clause
// Hardware-only keyboard writes into the reference chip. No previous VGM
// values, waveform, software envelope or oscillator phase is restored later.
const integer = (value, min, max, name) => {
	if (!Number.isInteger(value) || value < min || value > max)
		throw new RangeError(`${name} must be ${min}..${max}`);
	return value;
};
const identity = (id) => {
	if (typeof id !== 'string' || !id.length || id.length > 128)
		throw new TypeError('Manual note identity must contain 1..128 characters');
};
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const pitchValue = (value) => {
	if (!Number.isFinite(value) || value < -48 || value > 48)
		throw new RangeError('Manual Pitch must be -48..48');
	return value;
};

export function createAswanSongManual({ clock, getFrame, readSnapshot, write } = {}) {
	if (
		!Number.isFinite(clock) ||
		clock < 128 ||
		clock > 100000000 ||
		[getFrame, readSnapshot, write].some((fn) => typeof fn !== 'function')
	)
		throw new TypeError('Manual controls need a matching native song engine');
	const owners = Array(4).fill(null),
		effectiveClock = Math.floor(clock / 128) * 128;
	let pitch = 0,
		disposed = false;
	const open = () => {
		if (disposed) throw new Error('ASWAN song manual controls are disposed');
	};
	const codeFor = (frequency, bend) =>
		2048 -
		Math.max(
			1,
			Math.min(2048, Math.round(effectiveClock / (32 * frequency * 2 ** (bend / 12)))),
		);
	function availability(state, channel) {
		const r = state.registers,
			k = state.registerKnown,
			source =
				channel === 1 && r[16] & 32
					? 'pcm'
					: channel === 3 && r[16] & 128
						? 'noise'
						: 'wave';
		const result = { channel, source, playable: false, reason: '' };
		if (source === 'pcm')
			return {
				...result,
				reason: 'Voice PCM is a changing DAC byte, not a recovered keyboard sample.',
			};
		const required = [16, 17, 8 + channel, channel * 2, channel * 2 + 1];
		if (channel === 2 && r[16] & 64) required.push(12, 13);
		if (source === 'noise') required.push(14);
		if (required.some((index) => !k?.[index]))
			return {
				...result,
				reason: 'The rendered channel has incomplete recorded mode, output, pitch, volume or effect settings.',
			};
		if (source === 'wave' && !state.waveKnown[channel])
			return {
				...result,
				reason: 'All32 Wave RAM samples must be known before keyboard input.',
			};
		if (source === 'noise' && !(r[14] & 16))
			return { ...result, reason: 'The rendered Noise generator is disabled.' };
		return { ...result, playable: true };
	}
	function read(snapshot) {
		open();
		const state = snapshot ?? readSnapshot();
		return {
			pitch,
			voices: owners.filter(Boolean).map((owner) => ({ ...owner })),
			channels: Array.from({ length: 4 }, (_, ch) => availability(state, ch)),
		};
	}
	function receipt(changes, extra = {}) {
		return { nativeFrame: getFrame(), changes, manualState: read(), ...extra };
	}
	function periodWrite(operations, changes, state, channel, code) {
		const low = code & 255,
			high = (state.registers[channel * 2 + 1] & 0xf8) | (code >> 8);
		if (state.registers[channel * 2] === low && state.registers[channel * 2 + 1] === high)
			return;
		operations.push([0x80 + channel * 2, low], [0x81 + channel * 2, high]);
		changes.push({ channel, periodCode: code });
	}
	function apply(operations) {
		for (const [address, value] of operations) write(0, address, value);
	}
	function noteOn(id, midi, channel, options = {}) {
		open();
		identity(id);
		integer(midi, 0, 127, 'MIDI note');
		integer(channel, 0, 3, 'Manual channel');
		if (
			!options ||
			typeof options !== 'object' ||
			Array.isArray(options) ||
			Reflect.ownKeys(options).some(
				(key) => !['referenceMidi', 'frequencyHz', 'pitch'].includes(key),
			)
		)
			throw new TypeError('Invalid manual keyboard options');
		const referenceMidi = integer(options.referenceMidi ?? 60, 0, 127, 'Reference MIDI'),
			bend = pitchValue(options.pitch ?? pitch);
		if (
			options.frequencyHz !== undefined &&
			(!Number.isFinite(options.frequencyHz) || options.frequencyHz <= 0)
		)
			throw new RangeError('Reference frequency must be positive');
		if (owners.some((owner) => owner?.id === id))
			throw new Error('Manual note identity is already active');
		const state = readSnapshot(),
			available = availability(state, channel);
		if (!available.playable) throw new Error(available.reason);
		const baseFrequencyHz =
			options.frequencyHz === undefined
				? hz(midi)
				: options.frequencyHz * 2 ** ((midi - referenceMidi) / 12);
		if (!Number.isFinite(baseFrequencyHz) || baseFrequencyHz <= 0)
			throw new RangeError('Manual frequency is outside the finite hardware range');
		const code = codeFor(baseFrequencyHz, bend),
			operations = [],
			changes = [];
		periodWrite(operations, changes, state, channel, code);
		if (!(state.registers[16] & (1 << channel))) {
			operations.push([0x90, state.registers[16] | (1 << channel)]);
			const entry = changes.find((change) => change.channel === channel);
			if (entry) entry.gate = true;
			else changes.push({ channel, gate: true });
		}
		const stolenId = owners[channel]?.id ?? null;
		apply(operations);
		owners[channel] = {
			id,
			midi,
			channel,
			baseFrequencyHz,
			referenceMidi,
			source: available.source,
			gateOwned: true,
			pitchOwned: true,
			pitch: bend,
		};
		return receipt(changes, { channel, stolenId });
	}
	function releaseChannel(channel) {
		open();
		integer(channel, 0, 3, 'Manual channel');
		const owner = owners[channel];
		if (!owner) return false;
		const state = readSnapshot(),
			changes = [];
		if (state.registers[16] & (1 << channel)) {
			write(0, 0x90, state.registers[16] & ~(1 << channel));
			changes.push({ channel, gate: false });
		}
		owners[channel] = null;
		return receipt(changes, { channel });
	}
	function noteOff(id) {
		open();
		identity(id);
		const channel = owners.findIndex((owner) => owner?.id === id);
		return channel < 0 ? false : releaseChannel(channel);
	}
	function setPitch(value) {
		open();
		pitchValue(value);
		const state = readSnapshot(),
			operations = [],
			changes = [];
		for (const owner of owners)
			if (owner?.pitchOwned)
				periodWrite(
					operations,
					changes,
					state,
					owner.channel,
					codeFor(owner.baseFrequencyHz, value),
				);
		apply(operations);
		pitch = value;
		for (const owner of owners) if (owner?.pitchOwned) owner.pitch = value;
		return receipt(changes);
	}
	function releaseKeyboard() {
		open();
		const state = readSnapshot(),
			changes = [],
			releasedIds = [];
		let control = state.registers[16];
		for (let channel = 0; channel < 4; channel++)
			if (owners[channel]) {
				releasedIds.push(owners[channel].id);
				if (control & (1 << channel)) {
					control &= ~(1 << channel);
					changes.push({ channel, gate: false });
				}
			}
		if (changes.length) write(0, 0x90, control);
		owners.fill(null);
		pitch = 0;
		return receipt(changes, { releasedIds });
	}
	/** Only the original timeline calls this hook. A full0x90 write expresses
	 * driver ownership of all four gate bits, even when a bit stays On. Frequency
	 * bytes take pitch only; same-source Wave RAM/volume/effect writes keep gates.
	 */
	function observe(kind, address, value, registers) {
		if (disposed || kind !== 0) return;
		if (address === 0x90) owners.fill(null);
		else if (address >= 0x80 && address <= 0x87) {
			const owner = owners[(address - 0x80) >> 1];
			if (owner) owner.pitchOwned = false;
		} else if (address === 0x8e && owners[3] && (value & 8 || (registers[14] ^ value) & 16))
			owners[3] = null;
	}
	return {
		noteOn,
		noteOff,
		setPitch,
		releaseKeyboard,
		releaseChannel,
		read,
		observe,
		reset() {
			owners.fill(null);
			pitch = 0;
		},
		dispose() {
			disposed = true;
			owners.fill(null);
			pitch = 0;
		},
	};
}
