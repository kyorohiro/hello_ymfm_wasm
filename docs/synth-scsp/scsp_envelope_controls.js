// SPDX-License-Identifier: BSD-3-Clause
/** Add the hardware LPSLNK option without changing the shared PCM draft editor. */
export function setupScspEnvelopeControls({
	root,
	invoke,
	getSelectedSlot = () => 0,
	onError = () => {},
}) {
	const doc = root.ownerDocument;
	const envelope = root
		.querySelector('[data-chip-control="scsp-attackRate"]')
		?.closest('fieldset');
	if (!envelope) throw new Error('SCSP Envelope controls are unavailable');
	const row = doc.createElement('div');
	row.className = 'scsp-envelope-option';
	const label = doc.createElement('label');
	const input = doc.createElement('input');
	input.type = 'checkbox';
	input.dataset.chipControl = 'scsp-loopLink';
	label.append(input, ' Attack / loop link · hardware');
	const help = doc.createElement('details');
	help.className = 'scsp-inline-help';
	const summary = doc.createElement('summary');
	summary.textContent = '?';
	summary.setAttribute('aria-label', 'About hardware Attack / loop link');
	const text = doc.createElement('p');
	text.textContent =
		'Hardware LPSLNK: exit Attack at the programmed loop start instead of its usual envelope threshold. Applies to new notes.';
	help.append(summary, text);
	row.append(label, help);
	envelope.append(row);
	let voice = null,
		readOnly = false,
		pending = false,
		disposed = false;
	function render() {
		if (disposed) return;
		input.checked = Boolean(voice?.envelope?.loopLink);
		input.disabled = !voice || readOnly || pending;
	}
	async function change() {
		if (disposed || input.disabled) {
			render();
			return;
		}
		const slot = getSelectedSlot();
		const loopLink = input.checked;
		pending = true;
		input.disabled = true;
		try {
			await invoke('setEnvelope', [slot, { loopLink }]);
		} catch (error) {
			if (!disposed) onError(error);
		} finally {
			pending = false;
			render();
			input.blur();
		}
	}
	input.addEventListener('change', change);
	render();
	return {
		update(next = {}) {
			voice = next.voice ?? null;
			readOnly = Boolean(next.readOnly);
			render();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			input.removeEventListener('change', change);
			row.remove();
		},
	};
}
