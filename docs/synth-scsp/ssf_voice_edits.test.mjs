import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ScspSsfVoiceEdits } from './ssf_voice_edits.js';
import { createScspSsfCapture } from './ssf_capture.js';
import { prepareScspSsfSource } from './ssf_source.js';
import { createScspSsfRenderer } from './ssf_renderer.js';
import { createScspSsfPlaybackFixture } from '../../test/helpers/scsp_ssf_fixture.mjs';

const voice = () => ({ frequencyHz: 44100, totalLevel: 12, directLevel: 7, pan: 0,
	envelope: { attackRate: 31, decay1Rate: 0, decay2Rate: 0, decayLevel: 0, releaseRate: 31, keyRateScaling: 15, loopLink: false },
	lfo: { frequencyCode: 0, pitchWave: 0, pitchDepth: 0, amplitudeWave: 0, amplitudeDepth: 0, reset: false },
	modulation: { depth: 0, xOffset: 0, yOffset: 0, writeInhibit: false } });
const snapshot = (frame = 100) => ({ frame, ram: new Uint8Array(524288), slots: Array.from({ length: 32 }, () => ({
	voice: voice(), registers: new Uint16Array(16), flags: { loopLink: false }, sample: { bits: 16 },
})) });

test('manual values remain until strictly later audible native frames, then later driver snapshots take over', () => {
	const edits = new ScspSsfVoiceEdits(), source = snapshot(), before = structuredClone(source), target = { snapshot: source, slot: 1, referenceMidi: 60 };
	edits.sync(7, 'playing', source);
	edits.commit(target, 'setMix', { pan: 15 }, { session: 7, nativeFrame: 200 });
	assert.equal(edits.read(target).voice.pan, 15);
	edits.sync(7, 'playing', snapshot(200));
	assert.equal(edits.read(target).voice.pan, 15, 'the equal-frame history can predate the write');
	edits.sync(7, 'playing', snapshot(201));
	assert.equal(edits.read(target).voice.pan, 0);
	assert.equal(edits.read(target).edited, false);
	assert.deepEqual(source, before);
});

test('paused channel/reference choices retain bounded detached edits; stop, seek and new sessions retire them', () => {
	const edits = new ScspSsfVoiceEdits(), source = snapshot(), target = { snapshot: source, slot: 0, referenceMidi: 60 };
	edits.sync(1, 'paused', source);
	for (let i = 0; i < 1000; i++) edits.commit(target, 'setMix', { pan: i % 32 }, { session: 1, nativeFrame: 200 });
	assert.equal(edits.records.get(0).edits.length, 1, 'a long drag does not grow an event log');
	edits.commit({ ...target, slot: 1 }, 'setLfo', { pitchDepth: 4 }, { session: 1, nativeFrame: 200 });
	edits.sync(1, 'paused', snapshot(999));
	assert.equal(edits.read({ ...target, referenceMidi: 84 }).voice.pan, 7);
	assert.equal(edits.read({ ...target, slot: 1 }).voice.lfo.pitchDepth, 4);
	const detached = edits.read(target); detached.voice.pan = 0;
	assert.equal(edits.read(target).voice.pan, 7);
	assert.throws(() => edits.commit(target, 'setMix', { pan: 32 }, { session: 1, nativeFrame: 200 }));
	assert.equal(edits.read(target).voice.pan, 7);
	edits.sync(1, 'seeking', source);
	assert.equal(edits.read(target).edited, true, 'a failed seek can return to the retained machine');
	edits.sync(2, 'paused', source);
	assert.equal(edits.read(target).edited, false, 'a committed new seek machine retires old overlays');
	assert.throws(() => edits.commit(target, 'setMix', { pan: 5 }, { session: 1, nativeFrame: 201 }), { name: 'AbortError' });
	edits.sync(null, 'stopped', null);
	assert.equal(edits.read(target), null);
});

test('Capture projects pending parameter/register changes without modifying original native PCM or snapshot', async () => {
	const fixture = createScspSsfPlaybackFixture(), files = fixture.standaloneFiles;
	const source = await prepareScspSsfSource(files, files[0].path);
	const wasmBinary = await readFile(new URL('../generated/ssf-player/ssf_player.wasm', import.meta.url));
	const renderer = await createScspSsfRenderer(source, { wasmBinary });
	try {
		renderer.process(new Float32Array(4096), new Float32Array(4096), 4096);
		const original = renderer.readSnapshot(), before = structuredClone(original), edits = new ScspSsfVoiceEdits();
		const target = { snapshot: original, slot: 0, referenceMidi: 60 };
		edits.sync(1, 'paused', original);
		for (const [method, patch] of [['setEnvelope', { attackRate: 17, loopLink: true }], ['setLfo', { amplitudeDepth: 4 }], ['setMix', { pan: 15 }]])
			edits.commit(target, method, patch, { session: 1, nativeFrame: original.frame + 500 });
		const projected = edits.projectSnapshot(target), captured = createScspSsfCapture(projected, 0), base = createScspSsfCapture(original, 0);
		assert.equal(projected.ram, original.ram);
		assert.equal(captured.preset.voice.envelope.attackRate, 17);
		assert.equal(captured.preset.voice.envelope.loopLink, true);
		assert.equal(captured.preset.voice.lfo.amplitudeDepth, 4);
		assert.equal(captured.preset.voice.pan, 15);
		assert.deepEqual(captured.preset.pcm, base.preset.pcm);
		assert.deepEqual(original, before);
	} finally { renderer.dispose(); }
});
