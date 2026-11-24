// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	CH5, CH5_MODULATION_LENGTH, CH5_MODULATION_PRESETS, createCh5Settings, validateCh5Settings, ch5StepMs,
	ch5ControlWrites, ch5ModulationWrites, createCh5DemoSettings, createCh5ModulationPreset,
} from './ch5.js';

test('CH5 control encodes the hardware clock, enable, direction, shift and repeat bits', () => {
	const settings = createCh5Settings();
	assert.equal(CH5, 4);
	assert.deepEqual(ch5ControlWrites(settings), [[0x51c, 0xf0], [0x514, 0]]);
	assert.deepEqual(ch5ControlWrites({ ...settings, mode: 'sweep' }), [[0x51c, 0xfe], [0x514, 0x40]]);
	assert.deepEqual(ch5ControlWrites({ ...settings, mode: 'sweep', clock: 'fast', rate: 2, direction: 'down', shift: 3 }),
		[[0x51c, 0x23], [0x514, 0x40]]);
	assert.deepEqual(ch5ControlWrites({ ...settings, mode: 'modulation', repeat: false }),
		[[0x51c, 0xf0], [0x514, 0x50]]);
	assert.deepEqual(ch5ControlWrites({ ...settings, mode: 'modulation', rate: 0 }),
		[[0x51c, 0x80], [0x514, 0x70]]);
	assert.deepEqual(ch5ControlWrites({ ...settings, mode: 'sweep' }, 3),
		[[0x51c, 0xfe], [0x514, 0x43]]);
	assert.throws(() => ch5ControlWrites(settings, 4), /CH5 envelope control/);
});

test('CH5 step time honors Off, the zero multiplier, and both clock bases', () => {
	const settings = createCh5Settings();
	assert.equal(ch5StepMs(settings), 0);
	assert.equal(ch5StepMs({ ...settings, mode: 'sweep', rate: 0 }), 0);
	assert.equal(ch5StepMs({ ...settings, mode: 'sweep', clock: 'fast', rate: 3 }), 2.88);
	assert.ok(Math.abs(ch5StepMs({ ...settings, mode: 'modulation' }) - 53.76) < 1e-9);
});

test('CH5 modulation validates every signed value and writes the correct byte to every slot', () => {
	const values = Array(CH5_MODULATION_LENGTH).fill(0);
	values[0] = -127;
	values[1] = -1;
	values[31] = 127;
	const writes = ch5ModulationWrites(values);
	assert.deepEqual(writes[0], [0x280, 0x81]);
	assert.deepEqual(writes[1], [0x284, 0xff]);
	assert.deepEqual(writes[2], [0x288, 0x00]);
	assert.deepEqual(writes[31], [0x2fc, 0x7f]);
	assert.throws(() => ch5ModulationWrites(values.slice(0, 31)), /32 signed offsets/);
	assert.deepEqual(ch5ModulationWrites([...values.slice(0, 31), -128])[31], [0x2fc, 0x80]);
	assert.throws(() => ch5ModulationWrites([...values.slice(0, 31), -129]), /-128 to 127/);
	assert.throws(() => ch5ModulationWrites([...values.slice(0, 31), 128]), /-128 to 127/);
	assert.throws(() => ch5ModulationWrites(Array(32)), /CH5 modulation offset/);
});

test('CH5 modulation presets load fresh signed tables with distinct pitch patterns', () => {
	assert.deepEqual(CH5_MODULATION_PRESETS, [
		{ id: 'vibrato', label: 'Vibrato' }, { id: 'rising-bend', label: 'Rising bend' }, { id: 'trill', label: 'Trill' },
	]);
	assert(Object.isFrozen(CH5_MODULATION_PRESETS) && CH5_MODULATION_PRESETS.every(Object.isFrozen));
	const [vibrato, bend, trill] = CH5_MODULATION_PRESETS.map(({ id }) => {
		const values = createCh5ModulationPreset(id);
		assert(Array.isArray(values));
		assert.equal(ch5ModulationWrites(values).length, CH5_MODULATION_LENGTH);
		return values;
	});
	assert.deepEqual(vibrato, createCh5Settings().modulation);
	assert.deepEqual([vibrato[0], vibrato[8], vibrato[16], vibrato[24]], [0, 64, 0, -64]);
	assert.deepEqual(bend.slice(0, 16), [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 90]);
	assert.deepEqual(bend.slice(16), Array(16).fill(96));
	const trillCycle = [0, 0, 0, 0, 72, 72, 72, 72];
	assert.deepEqual(trill, [...trillCycle, ...trillCycle, ...trillCycle, ...trillCycle]);
	trill[0] = -12;
	assert.equal(createCh5ModulationPreset('trill')[0], 0);
	assert.throws(() => createCh5ModulationPreset('unknown'), /modulation preset/);
});

test('CH5 setups validate persisted values and comparison presets share a fresh default table', () => {
	const settings = createCh5Settings();
	const validated = validateCh5Settings(settings);
	assert.deepEqual(validated, settings);
	validated.modulation[0] = 93;
	assert.equal(settings.modulation[0], 0);
	assert.throws(() => validateCh5Settings({ ...settings, mode: 'vibrato' }), /mode/);
	assert.throws(() => validateCh5Settings({ ...settings, clock: 'auto' }), /clock/);
	assert.throws(() => validateCh5Settings({ ...settings, rate: 8 }), /interval multiplier/);
	assert.throws(() => validateCh5Settings({ ...settings, direction: 'toggle' }), /sweep/);
	assert.throws(() => validateCh5Settings({ ...settings, shift: -1 }), /sweep shift/);
	assert.throws(() => validateCh5Settings({ ...settings, repeat: 1 }), /true or false/);
	assert.deepEqual(createCh5DemoSettings('off'), settings);
	assert.equal(ch5StepMs(createCh5DemoSettings('sweep')).toFixed(2), '53.76');
	const modulation = createCh5DemoSettings('modulation');
	assert.equal(ch5StepMs(modulation), 7.68);
	assert.equal(Math.min(...modulation.modulation), -64);
	assert.equal(Math.max(...modulation.modulation), 64);
});
