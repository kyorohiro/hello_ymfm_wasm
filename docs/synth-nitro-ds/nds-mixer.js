// SPDX-License-Identifier: BSD-3-Clause
import { soundChipMixDefaults, validateChipMix } from '../js/soundchip_mixer.js';

const CHANNEL_COUNT = 16;
const POLL_MS = 120;
const balance = value => value === 0 ? 'C' : `${Math.abs(value)}${value < 0 ? 'L' : 'R'}`;

export function setupNdsMixer({ root, reference, referenceValue, getAudioRoutes, onReferenceLevel, onError }) {
	const doc = root.ownerDocument;
	const channels = Array.from({ length: CHANNEL_COUNT }, () => soundChipMixDefaults());
	const routes = () => getAudioRoutes().filter(audio => audio && audio.context.state !== 'closed');
	let visible = false, disposed = false, revision = 0, poll;
	const make = (tag, className, text) => {
		const node = doc.createElement(tag);
		if (className) node.className = className;
		if (text) node.textContent = text;
		return node;
	};

	function setChannel(channel, patch) {
		const next = { ...channels[channel], ...patch };
		validateChipMix(next);
		channels[channel] = next;
		rows[channel].render(next);
		for (const audio of routes())
			void audio.chip.setChannelMix(channel, next).catch(onError);
	}

	function fader(channel, key, name, min, max, format) {
		const label = make('label', 'nds-mix-fader');
		const input = make('input'), output = make('output');
		input.type = 'range';
		input.min = min;
		input.max = max;
		input.setAttribute('aria-label', `CH${channel + 1} ${name.toLowerCase()}`);
		input.addEventListener('input', () => setChannel(channel, { [key]: input.valueAsNumber / 100 }));
		label.append(make('span', '', name), input, output);
		return {
			label,
			render(value) {
				const percent = Math.round(value * 100), text = format(percent);
				if (input.valueAsNumber !== percent) input.value = percent;
				output.value = text;
				input.setAttribute('aria-valuetext', text);
			},
		};
	}

	const rows = channels.map((mix, channel) => {
		const label = `CH${channel + 1}`;
		const strip = make('section', 'nds-mix-channel');
		strip.dataset.channel = String(channel);
		strip.setAttribute('aria-label', `${label} output`);
		const mute = make('button', '', 'Mute');
		mute.type = 'button';
		mute.setAttribute('aria-label', `${label} mute`);
		mute.addEventListener('click', () => setChannel(channel, { muted: !channels[channel].muted }));
		const volume = fader(channel, 'volume', 'Level', 0, 200, value => `${value}%`);
		const pan = fader(channel, 'pan', 'Balance', -100, 100, balance);
		strip.append(make('h3', '', label), mute, volume.label, pan.label);
		function render({ volume: level, pan: position, muted }) {
			volume.render(level);
			pan.render(position);
			mute.setAttribute('aria-pressed', String(muted));
			strip.dataset.muted = String(muted);
		}
		render(mix);
		return { strip, render };
	});
	root.replaceChildren(...rows.map(row => row.strip));

	function referenceInput() {
		const value = reference.valueAsNumber;
		referenceValue.value = `${value}%`;
		onReferenceLevel(value / 100);
	}
	reference.addEventListener('input', referenceInput);

	async function updateActivity(request) {
		if (!doc.hidden) {
			const states = await Promise.allSettled(routes().map(audio => audio.chip.getState()));
			if (request !== revision) return;
			rows.forEach(({ strip }, channel) => {
				const active = states.some(result => result.status === 'fulfilled' && result.value[channel]?.active);
				if (strip.dataset.active !== String(active)) strip.dataset.active = String(active);
			});
		}
		poll = setTimeout(() => void updateActivity(request), POLL_MS);
	}

	return {
		apply(audio) {
			return Promise.all(channels.flatMap((mix, channel) =>
				mix.volume !== 1 || mix.pan !== 0 || mix.muted ? [audio.chip.setChannelMix(channel, mix)] : []));
		},
		setVisible(next) {
			if (disposed || visible === next) return;
			visible = next;
			const request = ++revision;
			clearTimeout(poll);
			if (visible) void updateActivity(request);
		},
		dispose() {
			disposed = true;
			revision++;
			clearTimeout(poll);
			reference.removeEventListener('input', referenceInput);
		},
	};
}
