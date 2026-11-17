/** Exact additive hardware LPSLNK API revision. Defaults preserve the measured
 * programs; enabling the flag is separately tested against the existing core.
 * This is not a passive UI exception, normalization or new PCM measurement.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {restoreMixerCalibrationAySingleOutputPolicyRevision} from './mixer_calibration_ay_single_output_policy_revision.mjs';
import {createScspDspExecutionRevisionReadContext} from './mixer_calibration_scsp_dsp_execution_revision.mjs';

export const SCSP_LOOP_LINK_REVISION_BASE_COMMIT = '3ffde6b7fb1c8d1759b07d529a75b78259ee1953';
export const SCSP_LOOP_LINK_REVISION_RECEIPT_PATH =
	'docs/issues/scsp_loop_link_api_source_revision_01.json';
export const SCSP_LOOP_LINK_REVISION_RECEIPT_OBJECT_SHA256 =
	'fb1715790f0a54484a8aa678b00222b1a072e223db1f43cf977470dd15ee59d3';
export const SCSP_LOOP_LINK_REVISION_SOURCE_PATHS = Object.freeze([
	'tetorica_src/runtime/scspsynth.js',
	'docs/js/scspsynth.js',
	'docs/playground/tetorica-playground-globals.d.ts',
]);
export const SCSP_LOOP_LINK_REVISION_REPORT_PATHS = Object.freeze(
	['ps1', 'wonderswan', 'pokey', 'scsp'].flatMap((kind) => [
		`docs/issues/${kind}_spc_voice_edit_chip_levels_01.json`,
		`docs/issues/${kind}_spc_voice_edit_chip_levels_verify_01.json`,
	]),
);
export const SCSP_LOOP_LINK_REVISION_RELATED_PATHS = Object.freeze([
	'tetorica_src/runtime/scspsynth.d.ts',
	'scripts/soundchip_calibration_scsp.mjs',
	'tetorica_src/runtime/soundchip_pitch.js',
	'docs/js/soundchip_pitch.js',
	'docs/generated/scsp_wasm.js',
	'docs/generated/scsp_wasm.wasm',
	'tetorica_src/runtime/soundchip_mixer_presets.js',
	'docs/js/soundchip_mixer_presets.js',
]);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const record = (value) =>
	value &&
	Number.isSafeInteger(value.bytes) &&
	value.bytes > 0 &&
	/^[0-9a-f]{64}$/.test(value.sha256);
const keys = (value, names) =>
	value &&
	typeof value === 'object' &&
	!Array.isArray(value) &&
	Object.keys(value).length === names.length &&
	names.every((name) => Object.hasOwn(value, name));
const fail = (message) => {
	throw Error(
		'Invalid exact SCSP loop-link API revision; remeasure or review a new exact revision: ' +
			message,
	);
};
let receipt;
function evidence() {
	if (receipt) return receipt;
	const value = JSON.parse(
		readFileSync(
			new URL('../' + SCSP_LOOP_LINK_REVISION_RECEIPT_PATH, import.meta.url),
			'utf8',
		),
	);
	if (sha(JSON.stringify(value)) !== SCSP_LOOP_LINK_REVISION_RECEIPT_OBJECT_SHA256)
		fail('independently pinned receipt SHA mismatch');
	if (
		value.schemaVersion !== 1 ||
		value.scope !== 'scsp-loop-link-optional-hardware-envelope-api' ||
		value.baseCommit !== SCSP_LOOP_LINK_REVISION_BASE_COMMIT ||
		!keys(value.sources, SCSP_LOOP_LINK_REVISION_SOURCE_PATHS) ||
		!keys(value.reports, SCSP_LOOP_LINK_REVISION_REPORT_PATHS) ||
		!keys(value.relatedSources, SCSP_LOOP_LINK_REVISION_RELATED_PATHS)
	)
		fail('exact source / dependency scope mismatch');
	for (const path of [
		...SCSP_LOOP_LINK_REVISION_REPORT_PATHS,
		...SCSP_LOOP_LINK_REVISION_RELATED_PATHS,
	])
		if (!record(value.reports[path] ?? value.relatedSources[path]))
			fail('invalid dependency record: ' + path);
	for (const path of SCSP_LOOP_LINK_REVISION_SOURCE_PATHS) {
		const entry = value.sources[path];
		if (
			!record(entry?.before) ||
			!record(entry.after) ||
			!Array.isArray(entry.reverseHunks) ||
			!entry.reverseHunks.length
		)
			fail('invalid complete source pair: ' + path);
		let cursor = 0;
		for (const hunk of entry.reverseHunks) {
			if (
				!keys(hunk, ['afterOffset', 'afterBytes', 'beforeText']) ||
				!Number.isSafeInteger(hunk.afterOffset) ||
				hunk.afterOffset < cursor ||
				!Number.isSafeInteger(hunk.afterBytes) ||
				hunk.afterBytes < 0 ||
				hunk.afterOffset + hunk.afterBytes > entry.after.bytes ||
				typeof hunk.beforeText !== 'string'
			)
				fail('invalid reverse source hunk: ' + path);
			cursor = hunk.afterOffset + hunk.afterBytes;
		}
	}
	receipt = value;
	return value;
}

/** Known historical path aliases identify the same exact two runtime files.
 * Any future byte edit remains unmodified and fails the caller's raw hash.
 */
export function restoreMixerCalibrationScspLoopLinkRevision(
	path,
	bytes,
	{ readSource = (url) => readFileSync(url) } = {},
) {
	const latest = createScspDspExecutionRevisionReadContext(readSource);
	bytes = latest.restore(path, bytes);
	readSource = latest.readSource;
	const name =
		path === 'web/scspsynth.js'
			? 'tetorica_src/runtime/scspsynth.js'
			: path === 'js/scspsynth.js'
				? 'docs/js/scspsynth.js'
				: path === 'playground/tetorica-playground-globals.d.ts'
					? 'docs/' + path
					: path;
	if (!SCSP_LOOP_LINK_REVISION_SOURCE_PATHS.includes(name)) return bytes;
	const value = evidence(),
		entry = value.sources[name];
	if (Buffer.byteLength(bytes) !== entry.after.bytes || sha(bytes) !== entry.after.sha256)
		return bytes;
	for (const path of [
		...SCSP_LOOP_LINK_REVISION_REPORT_PATHS,
		...SCSP_LOOP_LINK_REVISION_RELATED_PATHS,
	]) {
		const expected = value.reports[path] ?? value.relatedSources[path],
			actual = restoreMixerCalibrationAySingleOutputPolicyRevision(path,readSource(new URL('../' + path, import.meta.url)),{readSource});
		if (actual.length !== expected.bytes || sha(actual) !== expected.sha256)
			fail('pinned report/helper/cache dependency changed: ' + path);
	}
	const current = Buffer.from(bytes),
		parts = [];
	let cursor = 0;
	for (const hunk of entry.reverseHunks) {
		parts.push(current.subarray(cursor, hunk.afterOffset), Buffer.from(hunk.beforeText));
		cursor = hunk.afterOffset + hunk.afterBytes;
	}
	parts.push(current.subarray(cursor));
	const original = Buffer.concat(parts);
	if (original.length !== entry.before.bytes || sha(original) !== entry.before.sha256)
		fail('complete predecessor reconstruction failed: ' + path);
	return original;
}
