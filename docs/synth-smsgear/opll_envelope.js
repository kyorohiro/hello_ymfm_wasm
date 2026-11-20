// SPDX-License-Identifier: BSD-3-Clause
// A parameter guide, not a measured/time-calibrated envelope. No invented D2R.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function opllEnvelopeGeometry(
	op,
	{ width = 640, height = 170, sustain = false } = {},
) {
	const left = 16,
		w = width - 32,
		top = 24,
		bottom = height - 24,
		h = bottom - top;
	const attack = left + w * (0.1 + 0.24 * (1 - op.ar / 15));
	const decay = attack + w * (0.08 + 0.14 * (1 - op.dr / 15));
	const level = op.dr === 0 ? top : top + (h * op.sl) / 15;
	const off = left + w * 0.78;
	const rate = op.egt
		? left + w * (0.82 + 0.14 * (1 - op.rr / 15))
		: decay + w * (0.15 + 0.07 * (1 - op.rr / 15));
	const sustainX = decay + Math.max(18, w * 0.04);
	const heldDecay = !op.egt && op.rr > 0 && op.dr > 0;
	const offLevel = heldDecay ? bottom : level;
	const effectiveRelease = sustain ? 5 : op.egt ? op.rr : 7;
	const releaseEnd =
		op.egt && !sustain
			? rate
			: left + w * (0.82 + 0.14 * (1 - effectiveRelease / 15));
	const points = [
		[left, bottom],
		[attack, top],
		[decay, level],
		[sustainX, level],
	];
	if (heldDecay) points.push([rate, bottom]);
	points.push(
		[off, offLevel],
		[releaseEnd, effectiveRelease === 0 ? offLevel : bottom],
		[left + w, effectiveRelease === 0 ? offLevel : bottom],
	);
	if (op.ar === 0) for (const point of points) point[1] = bottom;
	const levelScale = 1 - ((op.tl ?? 0) / (op.tlMax ?? 63)) * 0.85;
	for (const point of points)
		point[1] = bottom - (bottom - point[1]) * levelScale;
	// Inactive stages (AR/DR/RR=0 or a channel Sustain override) must not
	// leave handles at a hypothetical SL/release point off the actual curve.
	const onCurve = (x) => {
		for (let i = 1; i < points.length; i++) {
			const a = points[i - 1],
				b = points[i];
			if (x <= b[0])
				return {
					x,
					y:
						a[1] +
						(b[1] - a[1]) *
							(b[0] === a[0] ? 1 : (x - a[0]) / (b[0] - a[0])),
				};
		}
		return { x, y: points.at(-1)[1] };
	};
	return {
		left,
		w,
		top,
		bottom,
		h,
		attack,
		decay,
		off,
		points,
		handles: {
			attack: onCurve(attack),
			decay: onCurve(decay),
			sustain: onCurve(sustainX),
			rate: onCurve(rate),
		},
	};
}
export function opllEnvelopePatch(op, handle, { x, y }, size = {}) {
	const g = opllEnvelopeGeometry(op, size),
		unit = (x - g.left) / g.w;
	const rate = (value) => clamp(Math.round(value), 0, 15);
	if (handle === "attack")
		return { ar: rate(15 * (1 - (unit - 0.1) / 0.24)) };
	if (handle === "decay")
		return {
			dr: rate(15 * (1 - ((x - g.attack) / g.w - 0.08) / 0.14)),
			sl: rate((15 * (y - g.top)) / g.h),
		};
	if (handle === "rate")
		return {
			rr: rate(
				15 *
					(1 -
						(op.egt
							? (unit - 0.82) / 0.14
							: ((x - g.decay) / g.w - 0.15) / 0.07)),
			),
		};
	if (handle === "sustain") return { sl: rate((15 * (y - g.top)) / g.h) };
	throw Error("Unknown OPLL Envelope handle");
}
export function createOpllEnvelopeEditor({
	root,
	getOperators,
	getSustain,
	canEdit,
	onEdit,
	getSelectionKey,
}) {
	const canvas = root.querySelector("canvas"),
		ctx = canvas.getContext("2d");
	const handles = [...root.querySelectorAll("[data-envelope-handle]")],
		operators = [...root.querySelectorAll("[data-envelope-operator]")];
	const colors = ["#f38d71", "#6db6ff"],
		events = new AbortController();
	let selected = 0,
		drag = null,
		frame = null,
		dead = false;
	const size = () => ({
		width: canvas.width,
		height: canvas.height,
		sustain: getSustain(),
	});
	function canvasContent() {
		const rect = canvas.getBoundingClientRect(),
			style = getComputedStyle(canvas);
		const left = parseFloat(style.borderLeftWidth) || 0,
			right = parseFloat(style.borderRightWidth) || 0,
			top = parseFloat(style.borderTopWidth) || 0,
			bottom = parseFloat(style.borderBottomWidth) || 0;
		return {
			left: rect.left + left,
			top: rect.top + top,
			width: rect.width - left - right,
			height: rect.height - top - bottom,
		};
	}
	function cancel() {
		const id = drag?.id;
		drag = null;
		if (id !== undefined && canvas.hasPointerCapture(id))
			canvas.releasePointerCapture(id);
	}
	function draw() {
		frame = null;
		if (dead) return;
		if (root.closest("[hidden]")) {
			cancel();
			return;
		}
		if (drag && (!canEdit() || drag.selection !== getSelectionKey()))
			cancel();
		const width = Math.max(
			280,
			Math.round(canvas.getBoundingClientRect().width),
		);
		if (canvas.width !== width) canvas.width = width;
		const values = getOperators(),
			geometries = values.map((op) => opllEnvelopeGeometry(op, size())),
			g = geometries[selected];
		root.dataset.operator = String(selected);
		ctx.fillStyle = "#101b24";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.strokeStyle = "#42546a";
		ctx.beginPath();
		ctx.moveTo(g.left, g.bottom);
		ctx.lineTo(g.left + g.w, g.bottom);
		ctx.moveTo(g.off, g.top);
		ctx.lineTo(g.off, g.bottom);
		ctx.stroke();
		ctx.fillStyle = "#b7c5d6";
		ctx.font = "12px sans-serif";
		ctx.fillText("Attack", g.left, 14);
		ctx.fillText("Decay / SL", g.decay - 30, 14);
		ctx.fillText("Key Off", g.off - 20, 14);
		for (const i of [1 - selected, selected]) {
			ctx.strokeStyle = colors[i];
			ctx.lineWidth = i === selected ? 3 : 1.5;
			ctx.globalAlpha = i === selected ? 1 : 0.55;
			ctx.beginPath();
			geometries[i].points.forEach(([x, y], j) =>
				j ? ctx.lineTo(x, y) : ctx.moveTo(x, y),
			);
			ctx.stroke();
		}
		ctx.globalAlpha = 1;
		for (const button of operators)
			button.setAttribute(
				"aria-pressed",
				String(Number(button.dataset.envelopeOperator) === selected),
			);
		const content = canvasContent(),
			plot = canvas.parentElement.getBoundingClientRect();
		for (const button of handles) {
			const point = g.handles[button.dataset.envelopeHandle];
			button.style.left =
				content.left -
				plot.left +
				(point.x / canvas.width) * content.width +
				"px";
			button.style.top =
				content.top -
				plot.top +
				(point.y / canvas.height) * content.height +
				"px";
			button.disabled = !canEdit();
			button.setAttribute(
				"aria-label",
				`OP${selected + 1} ${button.dataset.envelopeHandle === "attack" ? "AT: horizontal Attack, vertical " + (selected ? "channel attenuation" : "total level") : button.dataset.envelopeHandle === "decay" ? "DS: horizontal Decay, vertical Sustain level" : "Release rate"}`,
			);
		}
		const op = values[selected];
		root.querySelector("[data-envelope-readout]").textContent =
			`OP${selected + 1} · AR ${op.ar} · DR ${op.dr} · SL ${op.sl} · RR ${op.rr} · ${op.egt ? "EG sustain: hold SL; RR controls release" : "Percussive: RR controls held decay; key-off uses fixed release"}${op.ar === 0 ? " · AR 0: no attack" : op.dr === 0 ? " · DR 0: holds peak; SL inactive" : ""}${getSustain() ? " · channel Sustain overrides key-off rate" : ""}`;
	}
	const invalidate = () => {
		if (!dead && frame === null) frame = requestAnimationFrame(draw);
	};
	const point = (event) => {
		const rect = canvasContent();
		return {
			x: ((event.clientX - rect.left) * canvas.width) / rect.width,
			y: ((event.clientY - rect.top) * canvas.height) / rect.height,
		};
	};
	function edit(patch) {
		if (canEdit()) onEdit(selected, patch);
		invalidate();
	}
	root.addEventListener(
		"click",
		(event) => {
			const button = event.target.closest("[data-envelope-operator]");
			if (!operators.includes(button)) return;
			cancel();
			selected = Number(button.dataset.envelopeOperator);
			invalidate();
		},
		{ signal: events.signal },
	);
	root.addEventListener(
		"pointerdown",
		(event) => {
			const button = event.target.closest("[data-envelope-handle]");
			if (!handles.includes(button) || !canEdit() || event.button !== 0)
				return;
			event.preventDefault();
			const p = point(event),
				g = opllEnvelopeGeometry(getOperators()[selected], size())
					.handles[button.dataset.envelopeHandle];
			drag = {
				id: event.pointerId,
				handle: button.dataset.envelopeHandle,
				selection: getSelectionKey(),
				dx: p.x - g.x,
				dy: p.y - g.y,
				startY: p.y,
				sl: getOperators()[selected].sl,
				tl: getOperators()[selected].tl ?? 0,
			};
			canvas.setPointerCapture(event.pointerId);
		},
		{ signal: events.signal },
	);
	canvas.addEventListener(
		"pointermove",
		(event) => {
			if (!drag || event.pointerId !== drag.id) return;
			if (!canEdit() || drag.selection !== getSelectionKey()) {
				cancel();
				return;
			}
			event.preventDefault();
			const p = point(event),
				patch = opllEnvelopePatch(
					getOperators()[selected],
					drag.handle,
					{ x: p.x - drag.dx, y: p.y - drag.dy },
					size(),
				);
			if (drag.handle === "attack")
				patch.tl = clamp(
					Math.round(
						drag.tl +
							((p.y - drag.startY) *
								(getOperators()[selected].tlMax ?? 63)) /
								((canvas.height - 48) * 0.85),
					),
					0,
					getOperators()[selected].tlMax ?? 63,
				);
			// SL can be stored but inactive at DR=0/AR=0. Use displacement
			// from that value, rather than jumping to the projected curve level.
			if (drag.handle === "sustain" || drag.handle === "decay")
				patch.sl = clamp(
					Math.round(
						drag.sl +
							((p.y - drag.startY) * 15) / (canvas.height - 48),
					),
					0,
					15,
				);
			edit(patch);
		},
		{ signal: events.signal },
	);
	for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
		canvas.addEventListener(
			type,
			(event) => {
				if (event.pointerId === drag?.id) cancel();
			},
			{ signal: events.signal },
		);
	root.addEventListener(
		"keydown",
		(event) => {
			const handle = event.target.closest("[data-envelope-handle]")
				?.dataset.envelopeHandle;
			if (
				!handle ||
				!canEdit() ||
				!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
					event.key,
				)
			)
				return;
			event.preventDefault();
			event.stopPropagation();
			const vertical =
				event.key === "ArrowUp" || event.key === "ArrowDown";
			const key =
				vertical && handle === "attack"
					? "tl"
					: vertical && handle === "decay"
						? "sl"
						: {
								attack: "ar",
								decay: "dr",
								sustain: "sl",
								rate: "rr",
							}[handle];
			const sign =
				key === "sl" || key === "tl"
					? event.key === "ArrowUp" || event.key === "ArrowLeft"
						? -1
						: 1
					: event.key === "ArrowLeft" || event.key === "ArrowUp"
						? 1
						: -1;
			edit({
				[key]: clamp(
					(getOperators()[selected][key] ?? 0) + sign,
					0,
					key === "tl" ? (getOperators()[selected].tlMax ?? 63) : 15,
				),
			});
		},
		{ signal: events.signal },
	);
	window.addEventListener("blur", cancel, { signal: events.signal });
	const resize = new ResizeObserver(invalidate);
	resize.observe(canvas);
	return {
		invalidate,
		dispose() {
			dead = true;
			cancel();
			resize.disconnect();
			events.abort();
			if (frame !== null) cancelAnimationFrame(frame);
		},
	};
}
