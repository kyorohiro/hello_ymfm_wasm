// SPDX-License-Identifier: BSD-3-Clause
const formatLabels = {
	pcm8: 'PCM8', pcm16: 'PCM16', adpcm: 'IMA-ADPCM', pulse: 'PSG pulse', noise: 'Noise', reserved: 'Reserved',
};
const rateLabel = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

export function setupTwoSfLiveView({ getChannel, onEnabledChange, onAuditionChange, onCapture }) {
	const node = (id) => document.getElementById(id);
	const panel = node('twoSfLivePanel'), enabled = node('twoSfLiveEnabled');
	const status = node('twoSfLiveStatus'), details = node('twoSfLiveDetails');
	const active = node('twoSfLiveActive'), format = node('twoSfLiveFormat');
	const volume = node('twoSfLiveVolume'), pan = node('twoSfLivePan');
	const rate = node('twoSfLiveRate'), rateTitle = node('twoSfLiveRateLabel');
	const auditionTools = node('twoSfAuditionTools');
	const reference = node('twoSfAuditionReference'), auditionMessage = node('twoSfAuditionStatus');
	const capture = node('twoSfCapture');
	let view = { phase: 'stopped' };

	const write = (field, value) => {
		if (field.textContent !== value) field.textContent = value;
	};
	const getSelection = () => ({
		channel: getChannel(),
		referenceNote: Number(reference.value),
	});

	function update() {
		const { referenceView, phase, pending, switching, monitorSupported, snapshot, auditionSupported, auditionStatus, canCapture } = view;
		const hasSong = phase === 'playing' || phase === 'paused';
		const hidePanel = !referenceView;
		if (panel.hidden !== hidePanel) panel.hidden = hidePanel;
		const selected = referenceView && hasSong && !switching ? snapshot?.channels[getChannel()] : null;
		const current = enabled.checked ? selected : null;
		const hideDetails = !current;
		if (details.hidden !== hideDetails) details.hidden = hideDetails;

		const hideAudition = hidePanel || phase !== 'paused' || Boolean(pending || switching);
		if (auditionTools.hidden !== hideAudition) auditionTools.hidden = hideAudition;
		const disableAudition = !selected || auditionSupported !== true;
		if (reference.disabled !== disableAudition) reference.disabled = disableAudition;
		const disableCapture = hideAudition || canCapture !== true;
		if (capture.disabled !== disableCapture) capture.disabled = disableCapture;
		write(auditionMessage, hideAudition ? '' : auditionStatus ?? '');

		let label = 'No song playing';
		if (!enabled.checked) label = phase === 'playing' ? 'Live view off · Pause for keyboard audition' : 'Live view off';
		else if (switching) label = 'Preparing channel view…';
		else if (hasSong) {
			if (monitorSupported === false) label = 'Update the 2SF renderer for Live view';
			else if (!current) label = 'Waiting for channel data…';
			else label = phase === 'paused' ? 'Paused · Read only' : 'Live · Pause for keyboard audition';
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

	enabled.addEventListener('change', () => {
		onEnabledChange(enabled.checked);
		update();
	});
	reference.addEventListener('change', () => onAuditionChange?.(getSelection()));
	capture.addEventListener('click', () => onCapture?.());
	update();
	return {
		getSelection,
		render(state) {
			view = state;
			update();
		},
	};
}
