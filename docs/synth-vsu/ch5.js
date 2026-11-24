// SPDX-License-Identifier: BSD-3-Clause
import { vsuChannelRegister, VSU_REGISTERS } from './vsu.js';

export const CH5 = 4;
export const CH5_MODULATION_LENGTH = 32;
// Preserve the complete signed byte range when copying Modulation RAM from a VGM.
export const CH5_MODULATION_MIN = -128;
export const CH5_MODULATION_MAX = 127;

const MODULATION_RAM = 0x280;
const MODES = ['off', 'sweep', 'modulation'];
const CLOCK_MS = Object.freeze({ fast: 0.96, slow: 7.68 });
const MODULATION_PRESETS = {
	vibrato: {
		label: 'Vibrato',
		offset: index => Math.round(64 * Math.sin(2 * Math.PI * index / CH5_MODULATION_LENGTH)),
	},
	'rising-bend': { label: 'Rising bend', offset: index => 6 * Math.min(index, 16) },
	trill: { label: 'Trill', offset: index => index % 8 < 4 ? 0 : 72 },
};

export const CH5_MODULATION_PRESETS = Object.freeze(
	Object.entries(MODULATION_PRESETS).map(([id, { label }]) => Object.freeze({ id, label })),
);

function integer(value, min, max, label) {
	if (!Number.isInteger(value) || value < min || value > max)
		throw new RangeError(`${label} must be an integer from ${min} to ${max}.`);
	return value;
}

function checkMode(mode) {
	if (!MODES.includes(mode)) throw new RangeError('Choose an Off, Sweep, or Modulation mode for CH5.');
	return mode;
}

function validateControls(settings) {
	const { mode, clock, rate, direction, shift, repeat } = settings ?? {};
	checkMode(mode);
	if (clock !== 'fast' && clock !== 'slow') throw new RangeError('Choose a fast or slow CH5 clock.');
	integer(rate, 0, 7, 'CH5 interval multiplier');
	if (direction !== 'up' && direction !== 'down') throw new RangeError('Choose up or down for CH5 sweep.');
	integer(shift, 0, 7, 'CH5 sweep shift');
	if (typeof repeat !== 'boolean') throw new TypeError('CH5 modulation repeat must be true or false.');
	return { mode, clock, rate, direction, shift, repeat };
}

function validateModulation(values) {
	if ((!Array.isArray(values) && !ArrayBuffer.isView(values)) || values.length !== CH5_MODULATION_LENGTH)
		throw new RangeError('CH5 Modulation RAM requires 32 signed offsets.');
	return Array.from(values, value => integer(value, CH5_MODULATION_MIN, CH5_MODULATION_MAX, 'CH5 modulation offset'));
}

export function createCh5ModulationPreset(id) {
	if (!Object.hasOwn(MODULATION_PRESETS, id)) throw new RangeError('Choose a CH5 modulation preset.');
	const { offset } = MODULATION_PRESETS[id];
	return validateModulation(Array.from({ length: CH5_MODULATION_LENGTH }, (_, index) => offset(index)));
}

export function createCh5Settings() {
	return {
		mode: 'off', clock: 'slow', rate: 7, direction: 'up', shift: 6, repeat: true,
		modulation: createCh5ModulationPreset('vibrato'),
	};
}

export function validateCh5Settings(settings) {
	return { ...validateControls(settings), modulation: validateModulation(settings.modulation) };
}

export function decodeCh5Settings(ev1, swp, modulation) {
	integer(ev1, 0, 255, 'CH5 EV1');
	integer(swp, 0, 255, 'CH5 SWP');
	return validateCh5Settings({
		mode: !(ev1 & 0x40) ? 'off' : (ev1 & 0x10) ? 'modulation' : 'sweep',
		clock: (swp & 0x80) ? 'slow' : 'fast',
		rate: (swp >> 4) & 7,
		direction: (swp & 8) ? 'up' : 'down',
		shift: swp & 7,
		repeat: Boolean(ev1 & 0x20),
		modulation,
	});
}

export function ch5StepMs(settings) {
	const { mode, clock, rate } = validateControls(settings);
	return mode === 'off' ? 0 : CLOCK_MS[clock] * rate;
}

export function ch5ControlWrites(settings, envelopeBits = 0) {
	const { mode, clock, rate, direction, shift, repeat } = validateControls(settings);
	integer(envelopeBits, 0, 3, 'CH5 envelope control');
	// Nintendo's Virtual Boy Development Manual, §6.4.14.
	const timing = (clock === 'slow' ? 0x80 : 0) | (rate << 4);
	const sweep = mode === 'sweep' ? (direction === 'up' ? 8 : 0) | shift : 0;
	let control = mode === 'off' ? 0 : 0x40;
	if (mode === 'modulation') control |= repeat ? 0x30 : 0x10;
	return [
		[vsuChannelRegister(CH5, VSU_REGISTERS.SWP), timing | sweep],
		[vsuChannelRegister(CH5, VSU_REGISTERS.EV1), control | envelopeBits],
	];
}

export function ch5ModulationWrites(values) {
	// Modulation RAM uses one signed byte per four-byte slot. The caller
	// stops CH5 before sending these writes to satisfy the hardware lock.
	return validateModulation(values).map((value, index) => [MODULATION_RAM + index * 4, value & 0xff]);
}

export function createCh5DemoSettings(mode) {
	const settings = createCh5Settings();
	settings.mode = checkMode(mode);
	if (mode === 'modulation') settings.rate = 1;
	return settings;
}
