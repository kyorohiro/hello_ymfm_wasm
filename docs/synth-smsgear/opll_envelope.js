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
		: decay + w * (0.08 + 0.12 * (1 - op.rr / 15));
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
		[decay + w * 0.04, level],
	];
	if (heldDecay) points.push([rate, bottom]);
	points.push(
		[off, offLevel],
		[releaseEnd, effectiveRelease === 0 ? offLevel : bottom],
		[left + w, effectiveRelease === 0 ? offLevel : bottom],
	);
	if (op.ar === 0) for (const point of points) point[1] = bottom;
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
			attack: { x: attack, y: op.ar === 0 ? bottom : top },
			decay: { x: decay, y: top + (h * op.sl) / 15 },
			sustain: { x: decay + w * 0.04, y: top + (h * op.sl) / 15 },
			rate: {
				x: rate,
				y: op.egt
					? effectiveRelease === 0
						? offLevel
						: bottom
					: heldDecay
						? bottom
						: level,
			},
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
							: ((x - g.decay) / g.w - 0.08) / 0.12)),
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
		for (const button of handles) {
			const point = g.handles[button.dataset.envelopeHandle];
			button.style.left = (point.x / canvas.width) * 100 + "%";
			button.style.top = (point.y / canvas.height) * 100 + "%";
			button.disabled = !canEdit();
			button.setAttribute(
				"aria-label",
				`OP${selected + 1} ${button.dataset.envelopeHandle}`,
			);
		}
		const op = values[selected];
		root.querySelector("[data-envelope-readout]").textContent =
			`OP${selected + 1} · AR ${op.ar} · DR ${op.dr} · SL ${op.sl} · RR ${op.rr} · ${op.egt ? "EG sustain: hold SL; RR controls release" : "Percussive: RR controls held decay; key-off uses fixed release"}${getSustain() ? " · channel Sustain overrides key-off rate" : ""}`;
	}
	const invalidate = () => {
		if (!dead && frame === null) frame = requestAnimationFrame(draw);
	};
	const point = (event) => {
		const rect = canvas.getBoundingClientRect();
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
			if (drag.handle === "decay") delete patch.sl;
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
			const key = {
				attack: "ar",
				decay: "dr",
				sustain: "sl",
				rate: "rr",
			}[handle];
			const sign =
				key === "sl"
					? event.key === "ArrowUp" || event.key === "ArrowLeft"
						? -1
						: 1
					: event.key === "ArrowLeft" || event.key === "ArrowUp"
						? 1
						: -1;
			edit({ [key]: clamp(getOperators()[selected][key] + sign, 0, 15) });
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
