// SPDX-License-Identifier: BSD-3-Clause
const CHANNEL_COUNT = 16;

export function setupNdsChannelPicker({ onSelect }) {
	const synth = document.getElementById('ndsSynthView');
	const reference = document.getElementById('ndsReferenceView');
	const row = document.getElementById('ndsChannelButtons');
	const selections = { synth: -1, reference: 0 };
	let mode = 'synth', songPath = null, hasSong = false, switching = false, snapshot = null;
	const getSelection = () => ({ mode, channel: selections[mode] });
	const attribute = (element, name, value) => {
		if (element.getAttribute(name) !== value) element.setAttribute(name, value);
	};
	function buttonFor(channel) {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'nds-channel-button';
		button.dataset.channel = String(channel);
		button.textContent = channel === -1 ? 'Auto' : `CH${channel + 1}`;
		button.addEventListener('click', () => {
			if (selections[mode] === channel) return;
			selections[mode] = channel;
			update();
			onSelect?.(getSelection());
		});
		return button;
	}
	const buttons = Array.from({ length: CHANNEL_COUNT + 1 }, (_, index) => buttonFor(index - 1));
	row.replaceChildren(...buttons);

	function update() {
		const inspecting = mode === 'reference';
		attribute(synth, 'aria-pressed', String(!inspecting));
		attribute(reference, 'aria-pressed', String(inspecting));
		if (reference.disabled !== (!hasSong || switching)) reference.disabled = !hasSong || switching;
		if (buttons[0].hidden !== inspecting) buttons[0].hidden = inspecting;
		for (const [index, button] of buttons.entries()) {
			const channel = index - 1;
			attribute(button, 'aria-pressed', String(selections[mode] === channel));
			const active = inspecting && channel >= 0 && snapshot?.channels?.[channel]?.active === true;
			if (button.dataset.active !== String(active)) button.dataset.active = String(active);
		}
	}

	function selectMode(next) {
		if (mode === next) return;
		mode = next;
		update();
		onSelect?.(getSelection());
	}
	synth.addEventListener('click', () => selectMode('synth'));
	reference.addEventListener('click', () => selectMode('reference'));
	update();
	return {
		getSelection,
		getReferenceChannel: () => selections.reference,
		showSynth() {
			mode = 'synth';
			update();
		},
		render(state, nextSnapshot) {
			const activeSong = state.phase === 'playing' || state.phase === 'paused';
			if (!activeSong) mode = 'synth';
			else if (!hasSong || state.path !== songPath) mode = 'reference';
			hasSong = activeSong;
			songPath = state.path;
			switching = Boolean(state.switching);
			snapshot = nextSnapshot;
			update();
		},
	};
}
