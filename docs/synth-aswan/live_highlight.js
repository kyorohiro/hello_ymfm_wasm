// SPDX-License-Identifier: BSD-3-Clause
import { createSynthLiveHighlighter } from '../synth/synth_live_highlight.js';

// Readers stay scalar. In particular, no PCM payload is hashed or traversed.
// Each eligible field has its own baseline so showing a previously hidden or
// unknown control does not claim that a placeholder was a recovered value.
const definitions = {
	source: { read: (p) => p.source, unknown: ['source'] },
	wave: {
		read: (p) => p.wave.join(','),
		available: (v, p) => p.source === 'wave' && v.waveKnown === true,
		unknown: ['wave'],
	},
	volumeLeft: { read: (p) => p.left, available: (v, p) => p.source !== 'pcm', unknown: ['left'] },
	volumeRight: {
		read: (p) => p.right,
		available: (v, p) => p.source !== 'pcm',
		unknown: ['right'],
	},
	sweepEnabled: {
		read: (p) => p.sweep.enabled,
		available: (v, p) => v.physicalChannel === 2 && p.source === 'wave',
		unknown: ['sweep'],
	},
	sweepStep: {
		read: (p) => p.sweep.step,
		available: (v, p) => v.physicalChannel === 2 && p.source === 'wave',
		unknown: ['sweep'],
	},
	sweepTime: {
		read: (p) => p.sweep.time,
		available: (v, p) => v.physicalChannel === 2 && p.source === 'wave',
		unknown: ['sweep'],
	},
	noiseType: {
		read: (p) => p.noise.type,
		available: (v, p) => p.source === 'noise',
		unknown: ['noise'],
	},
	pcmLeftGain: {
		read: (p) => (p.left >= 8 ? 15 : p.left ? 7 : 0),
		sample: true,
		unknown: ['left'],
	},
	pcmRightGain: {
		read: (p) => (p.right >= 8 ? 15 : p.right ? 7 : 0),
		sample: true,
		unknown: ['right'],
	},
	pcmRootNote: { read: (p) => p.pcm.rootNote, sample: true, unknown: ['pcm.rootNote'] },
	pcmSampleRate: { read: (p) => p.pcm.sampleRate, sample: true, unknown: ['pcm.sampleRate'] },
	pcmLoop: { read: (p) => p.pcm.loop, sample: true, unknown: ['pcm.loop'] },
};

export const ASWAN_LIVE_PARAMETERS = Object.freeze(Object.keys(definitions));

export function createAswanLiveHighlighter({ controls, enabled = true }) {
	if (typeof enabled !== 'boolean') throw new TypeError('Highlight enabled must be a boolean');
	if (!controls || typeof controls !== 'object' || Array.isArray(controls))
		throw new TypeError('ASWAN highlight controls must be a parameter map');
	let disposed = false;
	const bindings = Object.entries(controls).map(([name, element]) => {
		const definition = definitions[name];
		if (!definition) throw new TypeError(`Unknown ASWAN highlight parameter: ${name}`);
		element.dataset.liveParameter = name;
		const parents = [];
		for (let parent = element; parent; parent = parent.parentElement) parents.push(parent);
		return {
			definition,
			parents,
			highlighter: createSynthLiveHighlighter({
				enabled,
				controls: [{ element, read: (view) => definition.read(view.snapshot.preset) }],
			}),
		};
	});
	function clear() {
		for (const { highlighter } of bindings) highlighter.clear();
	}
	return {
		update(view) {
			// Off avoids even reading a snapshot or walking its PCM metadata.
			if (!enabled || disposed) return;
			if (
				!view ||
				view.paused ||
				view.following === false ||
				!view.snapshot?.preset ||
				view.snapshot.frame === 0
			) {
				clear();
				return;
			}
			const preset = view.snapshot.preset,
				unknown = view.unknownFields ?? [];
			for (const { definition, parents, highlighter } of bindings) {
				const available =
					!unknown.includes('source') &&
					parents.every(
						(element) =>
							!element.hidden && (element.tagName !== 'DETAILS' || element.open),
					) &&
					!definition.unknown?.some((field) => unknown.includes(field)) &&
					(!definition.available || definition.available(view, preset)) &&
					(!definition.sample ||
						(preset.source === 'pcm' &&
							!unknown.includes('pcm.data') &&
							Boolean(preset.pcm.data)));
				highlighter.update(available ? view : null);
			}
		},
		clear,
		setEnabled(value) {
			if (typeof value !== 'boolean')
				throw new TypeError('Highlight enabled must be a boolean');
			if (disposed || value === enabled) return;
			enabled = value;
			for (const { highlighter } of bindings) highlighter.setEnabled(value);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const { highlighter } of bindings) highlighter.dispose();
		},
	};
}
