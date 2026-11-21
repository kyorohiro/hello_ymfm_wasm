// SPDX-License-Identifier: BSD-3-Clause
const formatLabels = {
	pcm8: 'PCM8', pcm16: 'PCM16', adpcm: 'IMA-ADPCM', pulse: 'PSG pulse', noise: 'Noise', reserved: 'Reserved',
};
const rateLabel = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

export function setupTwoSfLiveView({ onEnabledChange }) {
	const node = (id) => document.getElementById(id);
	const enabled = node('twoSfLiveEnabled'), channel = node('twoSfLiveChannel');
	const status = node('twoSfLiveStatus'), details = node('twoSfLiveDetails');
	const active = node('twoSfLiveActive'), format = node('twoSfLiveFormat');
	const volume = node('twoSfLiveVolume'), pan = node('twoSfLivePan');
	const rate = node('twoSfLiveRate'), rateTitle = node('twoSfLiveRateLabel');
	let view = { phase: 'stopped' };

	channel.replaceChildren(...Array.from({ length: 16 }, (_, index) => new Option(`CH${index + 1}`, index)));
	const write = (field, value) => {
		if (field.textContent !== value) field.textContent = value;
	};

	function update() {
		const { phase, switching, monitorSupported, snapshot } = view;
		const hasSong = phase === 'playing' || phase === 'paused';
		const disableSelect = !enabled.checked || !hasSong || switching || monitorSupported === false;
		const current = disableSelect ? null : snapshot?.channels[Number(channel.value)];
		const hideDetails = !current;
		if (channel.disabled !== disableSelect) channel.disabled = disableSelect;
		if (details.hidden !== hideDetails) details.hidden = hideDetails;

		let label = 'No song playing';
		if (!enabled.checked) label = 'Live view off';
		else if (switching) label = 'Preparing channel view…';
		else if (hasSong) {
			if (monitorSupported === false) label = 'Update the 2SF renderer for Live view';
			else if (!current) label = 'Waiting for channel data…';
			else label = phase === 'paused' ? 'Paused · Read only' : 'Live · Read only';
		}
		write(status, label);
		if (!current) return;

		const isActive = String(current.active);
		if (details.dataset.active !== isActive) details.dataset.active = isActive;
		write(active, current.active ? 'Active' : 'Idle');
		write(format, formatLabels[current.format] ?? '—');
		write(volume, String(current.volume));
		write(pan, String(current.pan));
		write(rateTitle, current.format === 'pulse' || current.format === 'noise' ? 'Step rate' : 'Sample rate');
		write(rate, Number.isFinite(current.sampleRate) ? `${rateLabel.format(current.sampleRate)} Hz` : '—');
	}

	channel.addEventListener('change', () => {
		channel.blur();
		update();
	});
	enabled.addEventListener('change', () => {
		onEnabledChange(enabled.checked);
		update();
	});
	update();
	return {
		render(state) {
			view = state;
			update();
		},
	};
}
