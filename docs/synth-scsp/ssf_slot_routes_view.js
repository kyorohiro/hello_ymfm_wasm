// SPDX-License-Identifier: BSD-3-Clause
// Passive selected-slot routes from one full SSF observation. No writes or topology inference.
const setting = (value, min, max) => Number.isInteger(value) && value >= min && value <= max ? value : null;
const flag = value => typeof value === 'boolean' ? value : null;
const phases = ['Attack', 'Decay 1', 'Decay 2', 'Release'];
const display = value => value === null ? 'Unavailable' : String(value);
const panLabel = value => value === null ? 'Unavailable' : value === 0 || value === 16 ? 'Center' :
	value === 15 ? 'Right only' : value === 31 ? 'Left only' : value < 16 ? 'Right' : 'Left';
const freeze = value => {
	if (value && typeof value === 'object') {
		Object.values(value).forEach(freeze);
		Object.freeze(value);
	}
	return value;
};

/** Detached configured routes, not measured audio or inferred CH / DSP topology.
 * X and Y remain ordered raw offsets, even when both reference the same offset.
 */
export function describeScspSsfSlotRoutes(snapshot, { slot = 0, playback = 'playing' } = {}) {
	const selected = setting(slot, 0, 31);
	const frame = Number.isSafeInteger(snapshot?.frame) && snapshot.frame >= 0 ? snapshot.frame : null;
	const full = Array.isArray(snapshot?.slots) && snapshot.slots.length === 32 &&
		Array.from(snapshot.slots).every(value => value !== null && typeof value === 'object');
	const coherent = frame !== null && full && selected !== null;
	const source = coherent ? snapshot.slots[selected] : null;
	const modulation = source?.voice?.modulation;
	const mode = setting(source?.sample?.sourceMode, 0, 3);
	const bits = source?.sample?.bits === 8 || source?.sample?.bits === 16 ? source.sample.bits : null;
	const depth = setting(modulation?.depth, 0, 15);
	const phase = setting(source?.envelopePhase, 0, 3);
	const model = {
		available: false,
		frame,
		slot: selected,
		playback: playback === 'paused' ? 'Paused' : playback === 'seeking' ? 'Seeking' : 'Live',
		references: [
			{ input: 'X', offset: setting(modulation?.xOffset, 0, 63) },
			{ input: 'Y', offset: setting(modulation?.yOffset, 0, 63) },
		],
		receiver: {
			sourceMode: mode,
			bits,
			source: mode === 0 ? bits === null ? 'Unavailable' : `PCM${bits}` :
				mode === null ? 'Unavailable' : ['PCM', 'Noise', 'Zero', 'Reserved'][mode],
			depth,
			// This threshold is specific to the pinned SSF Mednafen renderer.
			modulationEnabled: depth === null ? null : depth > 4,
			writeInhibit: flag(modulation?.writeInhibit),
		},
		outputs: {
			direct: { level: setting(source?.voice?.directLevel, 0, 7), pan: setting(source?.voice?.pan, 0, 31) },
			dsp: { input: setting(source?.dsp?.input, 0, 15), send: setting(source?.dsp?.send, 0, 7) },
		},
		activity: {
			requestedGate: flag(source?.gate),
			runtimeActive: flag(source?.active),
			envelopePhase: phase,
			envelopePhaseLabel: phase === null ? 'Unavailable' : phases[phase],
		},
		missing: [],
		reason: '',
	};
	const expected = [
		['X offset', model.references[0].offset], ['Y offset', model.references[1].offset],
		['source', mode === 0 ? bits : mode], ['MDL', depth], ['STWINH', model.receiver.writeInhibit],
		['Direct level', model.outputs.direct.level], ['Direct pan', model.outputs.direct.pan],
		['MIXS input', model.outputs.dsp.input], ['IMXL send', model.outputs.dsp.send],
		['Gate', model.activity.requestedGate], ['observed activity', model.activity.runtimeActive], ['ENV phase', phase],
	];
	model.missing = expected.filter(([, value]) => value === null).map(([name]) => name);
	model.available = coherent && model.missing.length === 0;
	model.reason = selected === null ? 'Choose an SSF channel from CH1–32.' :
		frame === null ? 'SSF snapshot frame unavailable.' :
		!full ? 'Full 32-slot SSF snapshot unavailable.' :
		model.missing.length ? 'Incomplete snapshot · missing fields are unavailable.' : 'Configured routes · read-only';
	return freeze(model);
}

/** Stable read-only DOM. The native help disclosure and keyboard focus are user-owned. */
export function setupScspSsfSlotRoutesView({ root } = {}) {
	if (!root?.ownerDocument) return { update() {}, dispose() {} };
	const doc = root.ownerDocument;
	const node = (tag, id, className, text) => {
		const value = doc.createElement(tag);
		if (id) value.id = id;
		if (className) value.className = `scsp-ssf-route-${className}`;
		if (text !== undefined) value.textContent = text;
		return value;
	};
	const heading = node('div', null, 'heading');
	const badge = node('span', 'scspSsfRouteBadge', 'badge', 'Unavailable');
	const frame = node('span', 'scspSsfRouteFrame', 'frame', 'Frame —');
	heading.append(node('h3', null, 'title', 'Selected SSF route'), badge, frame);
	const status = node('p', 'scspSsfRouteStatus', 'status');
	const diagram = node('div', 'scspSsfRouteDiagram', 'diagram');
	diagram.setAttribute('role', 'group');
	diagram.setAttribute('aria-label', 'Selected SSF channel configured routes');
	const references = node('div', null, 'stage');
	references.className += ' scsp-ssf-route-references';
	const x = node('p', 'scspSsfRouteX', 'reference');
	const y = node('p', 'scspSsfRouteY', 'reference');
	references.append(node('h4', null, 'name', 'Sound Stack'), x, y);
	const selected = node('div', null, 'stage');
	selected.className += ' scsp-ssf-route-selected';
	const selectedTitle = node('h4', 'scspSsfRouteSelected', 'name');
	const source = node('p', 'scspSsfRouteSource', 'value');
	const depth = node('p', 'scspSsfRouteDepth', 'value');
	const write = node('p', 'scspSsfRouteWrite', 'value');
	const activity = node('p', 'scspSsfRouteActivity', 'activity');
	selected.append(selectedTitle, source, depth, write, activity);
	const outputs = node('div', null, 'stage');
	outputs.className += ' scsp-ssf-route-outputs';
	const branch = (id, title) => {
		const group = node('div', null, 'branch');
		const value = node('p', id, 'value');
		group.append(node('h4', null, 'name', title), value);
		outputs.append(group);
		return value;
	};
	const direct = branch('scspSsfRouteDirect', 'Direct');
	const send = branch('scspSsfRouteSend', 'DSP send');
	const arrow = () => {
		const value = node('span', null, 'arrow', '→');
		value.setAttribute('aria-hidden', 'true');
		return value;
	};
	diagram.append(references, arrow(), selected, arrow(), outputs);
	const help = node('details', 'scspSsfRouteHelp', 'help');
	const summary = node('summary', null, 'help-summary', '?');
	summary.setAttribute('aria-label', 'About selected SSF routes');
	help.append(summary, node('p', null, 'help-text',
		'These configured fields share one full 32-slot observation frame. Gate is the requested key state; observed activity and ENV phase are separate sampled runtime state, not measured audio output. Inactive does not mean a slot is free. X/Y are raw 0–63 circular Sound Stack offsets, retained separately even when equal. Stack timing, history and delayed writes prevent identifying an immediate CH producer. MDL is the receiving depth 0–15: the pinned SSF Mednafen renderer applies address modulation only above 4; this is a renderer limitation, not a physical hardware claim. This does not imply Synth A/B pairs. STWINH inhibits Sound Stack writes; it does not mute Direct or MIXS. Direct level/pan and IMXL are configured levels, not audio meters. MIXSn names a DSP input; arbitrary DSP programs define the returns, so an exact return path is unavailable here. Missing captured fields remain unavailable rather than zero.'));
	heading.append(help);
	root.replaceChildren(heading, status, diagram);
	let disposed = false;
	const text = (target, value) => { if (target.textContent !== value) target.textContent = value; };
	const data = (name, value) => { if (root.dataset[name] !== String(value)) root.dataset[name] = String(value); };
	return {
		update(snapshot, options) {
			if (disposed) return;
			const model = describeScspSsfSlotRoutes(snapshot, options);
			data('available', model.available);
			data('frame', model.frame ?? '');
			data('slot', model.slot ?? '');
			data('playback', model.playback);
			text(badge, model.available ? model.playback : 'Unavailable');
			text(frame, `Frame ${model.frame ?? '—'}`);
			text(status, model.reason);
			text(selectedTitle, model.slot === null ? 'CH unavailable' : `CH${model.slot + 1} · receiver`);
			for (const [index, target] of [x, y].entries()) {
				const reference = model.references[index];
				text(target, `${reference.input} · offset ${display(reference.offset)}`);
			}
			const receiver = model.receiver;
			text(source, `Source ${receiver.source}`);
			text(depth, receiver.depth === null ? 'MDL Unavailable' : `MDL ${receiver.depth} · ${receiver.modulationEnabled ? 'enabled' : 'bypassed'}`);
			text(write, receiver.writeInhibit === null ? 'STWINH Unavailable' : receiver.writeInhibit ? 'STWINH On · writes inhibited' : 'STWINH Off · writes allowed');
			const observed = model.activity;
			text(activity, `Gate ${observed.requestedGate === null ? 'Unavailable' : observed.requestedGate ? 'On' : 'Off'} · Observed ${observed.runtimeActive === null ? 'Unavailable' : observed.runtimeActive ? 'active' : 'inactive'} · ENV ${observed.envelopePhaseLabel}`);
			const route = model.outputs.direct;
			text(direct, `Level ${display(route.level)} · Pan ${display(route.pan)} · ${panLabel(route.pan)}`);
			const dsp = model.outputs.dsp;
			text(send, `${dsp.input === null ? 'MIXS Unavailable' : `MIXS${dsp.input}`} · IMXL ${display(dsp.send)}`);
		},
		dispose() { disposed = true; },
	};
}
