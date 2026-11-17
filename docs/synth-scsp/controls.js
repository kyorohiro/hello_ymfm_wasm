// SPDX-License-Identifier: BSD-3-Clause
/** Preserve native input/change handlers while adding performance-friendly
 * increment buttons and horizontal dragging to the standalone editor. */
export function enhanceScspNumberControls(root) {
	const events = new AbortController(),
		controls = [];
	let dragging = null;
	const doc = root.ownerDocument ?? root,
		win = doc.defaultView;
	const stepFor = (input) =>
		input.step !== 'any' && Number(input.step) > 0
			? Number(input.step)
			: input.dataset.chipControl?.includes('file-')
				? 0.001
				: 1;
	function assign(input, value) {
		const step = stepFor(input),
			minimum = input.min === '' ? -Infinity : Number(input.min);
		const maximum = input.max === '' ? Infinity : Number(input.max);
		const [mantissa, exponent = '0'] = String(step).toLowerCase().split('e');
		const precision = Math.max(0, (mantissa.split('.')[1]?.length ?? 0) - Number(exponent));
		const quantized = Number((Math.round(value / step) * step).toFixed(Math.min(100, precision)));
		// Clamp after rounding so an exact hardware limit survives serialization.
		const next = Math.max(minimum, Math.min(maximum, quantized));
		if (!Number.isFinite(next) || String(next) === input.value) return;
		input.value = String(next);
		input.dispatchEvent(new win.Event('input', { bubbles: true }));
		input.dispatchEvent(new win.Event('change', { bubbles: true }));
		update();
	}
	for (const input of root.querySelectorAll('input[type="number"]')) {
		if (input.closest('.scsp-stepper')) continue;
		const frame = doc.createElement('span');
		frame.className = 'scsp-stepper';
		const minus = doc.createElement('button'),
			plus = doc.createElement('button');
		for (const [button, delta, text] of [
			[minus, -1, '−'],
			[plus, 1, '+'],
		]) {
			button.type = 'button';
			button.textContent = text;
			button.setAttribute(
				'aria-label',
				`${delta > 0 ? 'Increase' : 'Decrease'} ${input.id || input.dataset.chipControl || input.getAttribute('aria-label') || 'value'}`,
			);
			button.addEventListener(
				'pointerdown',
				(event) => {
					event.preventDefault();
					doc.activeElement?.blur();
				},
				{ signal: events.signal },
			);
			button.addEventListener(
				'click',
				() => {
					if (!input.disabled)
						assign(input, (Number(input.value) || 0) + delta * stepFor(input));
				},
				{ signal: events.signal },
			);
		}
		input.before(frame);
		frame.append(minus, input, plus);
		controls.push({ input, minus, plus });
		input.addEventListener(
			'pointerdown',
			(event) => {
				if (input.disabled || event.button !== 0) return;
				event.preventDefault();
				doc.activeElement?.blur();
				dragging = {
					input,
					id: event.pointerId,
					x: event.clientX,
					value: Number(input.value) || 0,
				};
				input.classList.add('is-dragging');
				input.setPointerCapture(event.pointerId);
			},
			{ signal: events.signal },
		);
		input.addEventListener(
			'pointermove',
			(event) => {
				if (!dragging || dragging.input !== input || dragging.id !== event.pointerId)
					return;
				assign(
					input,
					dragging.value + Math.trunc((event.clientX - dragging.x) / 6) * stepFor(input),
				);
			},
			{ signal: events.signal },
		);
		const finish = (event) => {
			if (!dragging || dragging.input !== input || dragging.id !== event.pointerId) return;
			dragging = null;
			input.classList.remove('is-dragging');
			input.blur();
		};
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
			input.addEventListener(type, finish, { signal: events.signal });
		input.addEventListener(
			'keydown',
			(event) => {
				if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key))
					return;
				event.preventDefault();
				event.stopPropagation();
				assign(
					input,
					(Number(input.value) || 0) +
						(['ArrowUp', 'ArrowRight'].includes(event.key) ? 1 : -1) * stepFor(input),
				);
			},
			{ signal: events.signal },
		);
	}
	function update() {
		for (const { input, minus, plus } of controls) {
			const atMinimum =
				input.disabled || (input.min !== '' && Number(input.value) <= Number(input.min));
			const atMaximum =
				input.disabled || (input.max !== '' && Number(input.value) >= Number(input.max));
			if (minus.disabled !== atMinimum) minus.disabled = atMinimum;
			if (plus.disabled !== atMaximum) plus.disabled = atMaximum;
		}
	}
	const observer = new win.MutationObserver(update);
	observer.observe(root, {
		subtree: true,
		attributes: true,
		attributeFilter: ['disabled', 'min', 'max'],
	});
	update();
	return {
		update,
		dispose() {
			events.abort();
			observer.disconnect();
		},
	};
}
