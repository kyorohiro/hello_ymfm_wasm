// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import { isNdsPresetPath, readNdsPreset, writeNdsPreset } from './nds-preset.js';
import { createNdsProject } from './nds-project.js';
import { makeNdsSample } from './nds-synth-api.js';

const mixer = { shape: 'triangle', volume: 90, pan: 40, divider: 2, duty: 3, loop: true };
const preset = mode => {
	const { bytes, loopStartWords, lengthWords } = makeNdsSample(mode, 'triangle');
	return { ...mixer, mode, sample: { bytes, sampleRate: 22050, rootNote: 57,
		loopStartWords: loopStartWords + 1, lengthWords: lengthWords - 2 } };
};

test('DS presets preserve exact sample formats and hardware loop/tuning settings', () => {
	assert(isNdsPresetPath('/presets/音色.NDS.JSON'));
	assert(!isNdsPresetPath('/presets/patch.json'));
	for (const mode of ['pcm8', 'pcm16', 'adpcm']) {
		const sound = preset(mode);
		const text = writeNdsPreset(' Loop 音 ', sound);
		assert.equal(typeof JSON.parse(text).sample.bytes, 'string');
		const reloaded = readNdsPreset(text);
		assert.deepEqual(reloaded, { name: 'Loop 音', ...sound });
		assert.notEqual(reloaded.sample.bytes, sound.sample.bytes);
		assert.equal(writeNdsPreset(reloaded.name, reloaded), text);
	}
});

test('DS presets support built-in PCM, pulse and noise without sample payloads', () => {
	for (const mode of ['pcm16', 'pulse', 'noise']) {
		const sound = { ...mixer, mode };
		assert.deepEqual(readNdsPreset(writeNdsPreset(mode, sound)), { name: mode, ...sound });
	}
	assert.throws(() => writeNdsPreset('Bad', { ...preset('pcm8'), mode: 'noise' }), /requires PCM8/);
});

test('DS presets reject noncanonical base64, invalid ADPCM and unsupported ranges before loading', () => {
	const sound = preset('adpcm');
	const record = JSON.parse(writeNdsPreset('Good', sound));
	assert.throws(() => readNdsPreset({ ...record, sample: { ...record.sample, bytes: `${record.sample.bytes}=` } }), /base64/);
	assert.throws(() => readNdsPreset({ ...record, sample: { ...record.sample, bytes: 'AAAAAAAAAAAAAAAAAAAAAB==' } }), /base64/);
	assert.throws(() => readNdsPreset({ ...record, sample: { ...record.sample, lengthWords: 1000 } }), /length|end|range/i);
	assert.throws(() => readNdsPreset({ ...record, sample: { ...record.sample, loopStartWords: 0 } }), /header|loop/i);
	assert.throws(() => readNdsPreset({ ...record, sample: { ...record.sample, sampleRate: 0 } }), /rate/i);
	assert.throws(() => readNdsPreset({ ...record, sample: { ...record.sample, rootNote: 128 } }), /root MIDI/i);
	const bad = sound.sample.bytes.slice();
	bad[2] = 89;
	assert.throws(() => writeNdsPreset('Bad header', { ...sound, sample: { ...sound.sample, bytes: bad } }), /header|index/i);
});

test('an explicit sound Save joins accepted Files and restores from Cassette independently of manual drafts', async () => {
	const path = '/presets/Loop.nds.json';
	const sound = preset('adpcm');
	const project = createNdsProject({ starterCode: '// saved code' });
	project.setAutoApply(false);
	project.writeEditorText('/index.js', '// draft code');
	project.importFiles([{ path, data: writeNdsPreset('Loop', sound) }], { save: true });
	assert.deepEqual(project.getDirtyPaths(), ['/index.js']);
	assert.deepEqual(readNdsPreset(project.savedFs.get(path).data), { name: 'Loop', ...sound });

	project.writeEditorText(path, writeNdsPreset('Edited Loop', { ...sound, volume: 11 }));
	const opened = createNdsProject();
	opened.restore(await opened.prepareImport(project.exportCassette()));
	assert.equal(opened.autoApply, false);
	assert.equal(opened.savedFs.get('/index.js').data, '// saved code');
	assert.equal(opened.fs.get('/index.js').data, '// draft code');
	assert.equal(readNdsPreset(opened.fs.get(path).data).volume, 11);
	assert.deepEqual(readNdsPreset(opened.savedFs.get(path).data), { name: 'Loop', ...sound });
});
