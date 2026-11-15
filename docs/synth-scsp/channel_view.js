// SPDX-License-Identifier: BSD-3-Clause
/** One inspect / edit target. Selecting a tab never writes to the sound chip. */
export function setupScspChannelView({
	onChange = () => {},
	document: doc = globalThis.document,
} = {}) {
	const tabs = doc.getElementById('scspChannelTabs');
	const summary = doc.getElementById('scspChannelSummary');
	let selected = null,
		state = null,
		ssfSnapshot = null,
		ssfActive = false,
		disposed = false;
	const listeners = [];
	const label = (slot) => `CH${slot + 1}`;
	const physicalSlots = (slots) => {
		if (slots.length === 1) return label(slots[0]);
		if (slots.every((slot, index) => index === 0 || slot === slots[index - 1] + 1))
			return `${label(slots[0])}–${label(slots.at(-1))}`;
		return slots.map(label).join('+');
	};
	const lanes = () =>
		(state?.codeLanes ?? []).filter(
			(lane) =>
				lane.slots?.length &&
				Number.isInteger(lane.channel) &&
				lane.slots.every((slot) => Number.isInteger(slot) && slot >= 0 && slot < 32),
		);
	const mapping = (lane) => `Code ${label(lane.channel)} → ${physicalSlots(lane.slots)}`;
	const attr = (node, key, value) => {
		if (node.getAttribute(key) !== value) node.setAttribute(key, value);
	};
	const text = (node, value) => {
		if (node.textContent !== value) node.textContent = value;
	};
	function choose(value, { notify = true } = {}) {
		if (value !== null && (!Number.isInteger(value) || value < 0 || value >= 32))
			throw new RangeError('Choose Auto or a physical SCSP channel 0..31');
		if (disposed || selected === value) return false;
		selected = value;
		render();
		if (notify) onChange(selected);
		return true;
	}
	const buttons = [null, ...Array.from({ length: 32 }, (_, index) => index)].map((value) => {
		const button = doc.createElement('button');
		button.type = 'button';
		button.textContent = value === null ? 'Auto' : label(value);
		button.dataset.scspChannel = value === null ? 'auto' : String(value);
		button.setAttribute('role', 'tab');
		button.setAttribute('aria-controls', 'voice');
		const click = () => {
			choose(value);
			button.blur();
		};
		const keydown = (event) => {
			if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
			event.preventDefault();
			event.stopPropagation();
			const current = value === null ? 0 : value + 1;
			const index =
				event.key === 'Home'
					? 0
					: event.key === 'End'
						? 32
						: (current + (event.key === 'ArrowRight' ? 1 : 32)) % 33;
			choose(buttons[index].value);
			buttons[index].button.focus();
		};
		button.addEventListener('click', click);
		button.addEventListener('keydown', keydown);
		listeners.push(() => button.removeEventListener('click', click));
		listeners.push(() => button.removeEventListener('keydown', keydown));
		tabs.append(button);
		return { value, button };
	});
	function render() {
		if (disposed) return;
		const live = ssfActive && ssfSnapshot?.slots?.length === 32;
		tabs.dataset.source = live ? 'ssf' : 'authored';
		tabs.dataset.selected = selected === null ? 'auto' : String(selected);
		const code = lanes();
		for (const { value, button } of buttons) {
			const slot =
				value === null ? null : live ? ssfSnapshot.slots[value] : state?.slots?.[value];
			const gate =
				value === null
					? Boolean(state?.slots?.some((voice) => voice.gate))
					: Boolean(slot?.gate);
			const active = value === null ? gate : live ? Boolean(slot?.active) : gate;
			attr(button, 'aria-selected', String(value === selected));
			button.tabIndex = value === selected ? 0 : -1;
			button.dataset.active = String(active);
			button.dataset.gate = String(gate);
			button.style.setProperty(
				'--scsp-env',
				String(live && value !== null ? (slot?.envelopeLevel ?? 0) : 0),
			);
			const owners = value === null ? [] : code.filter((lane) => lane.slots.includes(value));
			button.title =
				value === null
					? 'Auto · grouped keyboard and logical Code lanes'
					: `${label(value)} · ${live ? `${active ? 'Active' : 'Inactive'} · Gate` : 'Requested gate'} ${gate ? 'On' : 'Off'}${owners.length && !live ? ' · ' + owners.map(mapping).join(' · ') : ''}`;
		}
		let message;
		if (live) {
			const slot = selected === null ? null : ssfSnapshot.slots[selected];
			message = slot
				? `SSF Live · ${label(selected)} · ${slot.active ? 'Active' : 'Inactive'} · Gate ${slot.gate ? 'On' : 'Off'} · ENV ${Math.round((slot.envelopeLevel ?? 0) * 100)}%`
				: 'SSF Live · choose a physical CH to inspect.';
		} else if (selected === null) {
			const shown = code.slice(0, 4).map(mapping);
			message =
				'Auto · grouped keyboard / Code voices.' +
				(shown.length
					? ' ' +
						shown.join(' · ') +
						(code.length > shown.length
							? ` · +${code.length - shown.length} lanes`
							: '')
					: '');
		} else {
			const slot = state?.slots?.[selected],
				owners = code.filter((lane) => lane.slots.includes(selected));
			message = `${label(selected)} · physical slot · ${slot?.sample ? 'PCM assigned' : 'No PCM'} · requested Gate ${slot?.gate ? 'On' : 'Off'}.`;
			if (owners.length) message += ' ' + owners.map(mapping).join(' · ');
		}
		text(summary, message);
	}
	render();
	return {
		getSelected: () => selected,
		setSelected: choose,
		update(next = {}) {
			state = next.state ?? null;
			ssfSnapshot = next.ssfSnapshot ?? null;
			ssfActive = Boolean(next.ssfActive);
			render();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			listeners.forEach((remove) => remove());
			buttons.forEach(({ button }) => button.remove());
		},
	};
}
