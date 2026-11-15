import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('./preset.js', import.meta.url), 'utf8');
test('portable ASWAN presets work inside AudioWorklet subset without btoa / atob / structuredClone', () => {
	const scope = { Uint8Array, btoa: undefined, atob: undefined, structuredClone: undefined };
	vm.runInNewContext(
		source.replace(/\bexport\s+/g, '') +
			'\nglobalThis.api={createDefaultPreset,readPreset,encodePcmData,decodePcmData};',
		scope,
	);
	const api = scope.api,
		preset = api.createDefaultPreset();
	assert.equal(api.readPreset(preset).format, 'tetorica-aswan-voice');
	for (const length of [1, 2, 3, 12287, 12288, 12289, 2097152]) {
		const bytes = Uint8Array.from({ length }, (_, i) => (i * 17) & 255),
			encoded = api.encodePcmData(bytes);
		assert.equal(encoded, Buffer.from(bytes).toString('base64'));
		assert.deepEqual(api.decodePcmData(encoded), bytes);
	}
	for (const invalid of ['AB==', 'AAB=', 'AA=A', '?AAA', 'A==='])
		assert.throws(() => api.decodePcmData(invalid));
});
