// SPDX-License-Identifier: BSD-3-Clause
const CHANNEL_COUNT = 16;

export function setupNdsChannelPicker({ onSelect }) {
	const row = document.getElementById('ndsChannelButtons');
	let selected = -1, snapshot = null;
	const attribute = (element, name, value) => {
		if (element.getAttribute(name) !== value) element.setAttribute(name, value);
	};
	function buttonFor(channel) {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'nds-channel-button';
		button.dataset.channel = String(channel);
		button.textContent = channel === -1 ? 'Auto' : `CH${channel + 1}`;
		button.addEventListener('click', () => select(channel));
		return button;
	}
	const buttons = Array.from({ length: CHANNEL_COUNT + 1 }, (_, index) => buttonFor(index - 1));
	row.replaceChildren(...buttons);

	function update() {
		for (const [index, button] of buttons.entries()) {
			const channel = index - 1;
			attribute(button, 'aria-pressed', String(selected === channel));
			const active = channel >= 0 && snapshot?.channels?.[channel]?.active === true;
			if (button.dataset.active !== String(active)) button.dataset.active = String(active);
		}
	}

	function select(channel) {
		if (selected === channel) return;
		selected = channel;
		update();
		onSelect?.(channel);
	}
	update();
	return {
		getSelection: () => selected,
		select,
		render(nextSnapshot) {
			snapshot = nextSnapshot;
			update();
		},
	};
}
