// SPDX-License-Identifier: BSD-3-Clause
import { readScspSsfPcmPreview } from './ssf_snapshot.js';

const phases = ['Attack', 'Decay 1', 'Decay 2', 'Release'];
const loops = ['One-shot', 'Forward', 'Reverse', 'Alternating'];
const sources = ['PCM', 'Noise', 'Zero', 'Reserved'];
const hex = (value) =>
	'0x' +
	Math.max(0, value ?? 0)
		.toString(16)
		.padStart(5, '0');
const usable = (snapshot) => snapshot?.slots?.length === 32 && snapshot.ram instanceof Uint8Array;

/** Prepare one physical slot's hardware fields and same-time raw RAM prefix
 * for the existing waveform / EG / LFO controls. */
export function projectScspSsfLiveSlot(snapshot, index) {
	if (!usable(snapshot) || !Number.isInteger(index) || index < 0 || index >= 32)
		throw new TypeError('Choose a slot from a complete SSF snapshot');
	const slot = snapshot.slots[index];
	const preview = readScspSsfPcmPreview(snapshot, index, { maxSamples: 256 });
	const bits = slot.sample.bits;
	const pcm = preview.pcm ?? (bits === 8 ? new Int8Array() : new Int16Array());
	return {
		slot,
		preview,
		read: { voice: slot.voice, sample: slot.sample, pcm },
	};
}

/** Observe the song through the existing authoring panel. Calling update with
 * an aligned snapshot never advances the sound CPU or changes an instrument. */
export function setupScspSsfLiveView({
	panel,
	panelRoot,
	onChange = () => {},
	onCapture = null,
	getCaptureAvailability = () => ({ available: true }),
	document: doc = globalThis.document,
} = {}) {
	const byId = (id) => doc.getElementById(id);
	const section = byId('scspSsfLive');
	const enabled = byId('scspSsfLiveEnabled');
	const select = byId('scspSsfSlot');
	const activity = byId('scspSsfSlots');
	const status = byId('scspSsfLiveStatus');
	const reference = byId('scspSsfReference');
	const capture = byId('scspSsfCapture');
	const captureStatus = byId('scspSsfCaptureStatus');
	const listeners = [];
	let playback = null,
		snapshot = null,
		selected = 0,
		active = false,
		disposed = false,
		projected = null,
		capturing = false,
		captureError = '';
	const hidden = new Map();
	const disabled = new Map();
	let checkpoint = null;
	const authorSections = [...doc.querySelectorAll('.voice-routing, .operator-panel')];
	const input = (name) => panelRoot.querySelector(`[data-chip-control="scsp-${name}"]`);
	const rootLabel = input('root')?.closest('label');
	const rootText = rootLabel?.firstChild;
	const originalRootText = rootText?.textContent;
	const canvas = input('waveform');
	const originalCanvasLabel = canvas?.getAttribute('aria-label');
	const waveform = canvas?.closest('fieldset');
	const legend = waveform?.querySelector('legend');
	const originalLegend = legend?.textContent;
	const memory = panelRoot.querySelector(':scope > p');
	const draftStatus = [...(waveform?.children ?? [])].find(
		(node) => node.tagName === 'P' && node.getAttribute('role') === 'status',
	);
	const shapeRow = panelRoot.querySelector('[data-chip-action="scsp-sine"]')?.parentElement;
	const filePanel = panelRoot
		.querySelector('[data-chip-control="scsp-audio-file"]')
		?.closest('fieldset');
	const apply = panelRoot.querySelector('[data-chip-action="scsp-apply"]');
	const copy = panelRoot.querySelector('[data-chip-action="scsp-copy"]');
	const editorHelp = [...(waveform?.querySelectorAll('p') ?? [])].find(
		(node) =>
			node.textContent.startsWith('Software waveform editor') ||
			node.textContent.startsWith('Software editor:'),
	);
	const authoredNodes = [
		...authorSections,
		shapeRow,
		filePanel,
		apply,
		copy,
		editorHelp,
		input('rate')?.closest('label'),
		input('loop')?.closest('label'),
		input('sample')?.closest('label'),
	].filter(Boolean);
	for (const node of authoredNodes) hidden.set(node, node.hidden);

	const modulation = doc.createElement('fieldset');
	modulation.className = 'scsp-ssf-modulation';
	modulation.hidden = true;
	const title = doc.createElement('legend');
	title.textContent = 'Slot modulation · read-only';
	modulation.append(title);
	const modulationValues = new Map();
	for (const [key, name] of [
		['depth', 'MDL'],
		['xOffset', 'X stack offset'],
		['yOffset', 'Y stack offset'],
		['writeInhibit', 'Inhibit stack write'],
	]) {
		const label = doc.createElement('label');
		const output = doc.createElement('output');
		label.append(name + ' ', output);
		modulation.append(label);
		modulationValues.set(key, output);
	}
	panelRoot.append(modulation);

	function listen(node, type, callback) {
		node.addEventListener(type, callback);
		listeners.push(() => node.removeEventListener(type, callback));
	}
	function choose(index) {
		selected = index;
		captureError = '';
		select.value = String(index);
		render();
		onChange();
	}
	const buttons = Array.from({ length: 32 }, (_, index) => {
		const option = doc.createElement('option');
		option.value = String(index);
		option.textContent = `Slot ${index + 1}`;
		select.append(option);
		const button = doc.createElement('button');
		button.type = 'button';
		button.textContent = String(index + 1);
		button.dataset.ssfSlot = String(index);
		button.setAttribute('aria-label', `Inspect SSF slot ${index + 1}`);
		button.setAttribute('aria-pressed', 'false');
		listen(button, 'click', () => {
			choose(index);
			button.blur();
		});
		activity.append(button);
		return button;
	});
	select.value = '0';
	listen(select, 'change', () => {
		choose(Number(select.value));
		select.blur();
	});
	listen(enabled, 'change', () => {
		captureError = '';
		render();
		onChange();
		enabled.blur();
	});
	reference.value = '60';
	listen(reference, 'change', () => {
		if (![36, 48, 60, 72, 84].includes(Number(reference.value))) reference.value = '60';
		captureError = '';
		render();
		onChange();
		reference.blur();
	});
	listen(capture, 'click', async () => {
		const target = selectedTarget();
		if (capture.disabled || !target || !onCapture) return;
		capturing = true;
		captureError = '';
		render();
		try {
			await onCapture(target);
		} catch (error) {
			captureError = error?.message ?? String(error);
		} finally {
			capturing = false;
			if (!disposed) render();
			capture.blur();
		}
	});
	function selectedTarget() {
		return active && ['playing', 'paused'].includes(playback?.playback)
			? {
					snapshot,
					slot: selected,
					referenceMidi: Number(reference.value),
				}
			: null;
	}
	function renderCapture() {
		const target = selectedTarget();
		let available = false,
			reason = '';
		if (target) {
			try {
				const result = getCaptureAvailability(target);
				available = result?.available !== false;
				reason = result?.reason ?? '';
			} catch (error) {
				reason = error?.message ?? String(error);
			}
		}
		reference.disabled = capturing;
		capture.disabled = !target || !available || !onCapture || capturing;
		capture.textContent = capturing ? 'Capturing…' : 'Capture to Synth';
		captureStatus.textContent =
			captureError ||
			reason ||
			(capturing
				? 'Preparing the selected slot.'
				: target
					? playback.paused
						? 'Keyboard: selected SSF slot · Reference key sets its captured pitch.'
						: 'Keyboard: authored Synth · Pause to audition the selected SSF slot.'
					: 'Capture copies a supported PCM slot into the editable Synth.');
		captureStatus.dataset.error = String(Boolean(captureError || (target && !available)));
	}

	function readonly(value) {
		if (active === value) return;
		active = value;
		if (value) {
			const context = canvas?.getContext?.('2d');
			checkpoint = {
				canvas: context?.getImageData?.(0, 0, canvas.width, canvas.height),
				memory: memory?.textContent,
				status: draftStatus?.textContent,
				values: new Map(
					['root', 'rate', 'loop', 'bits', 'modulation-padding']
						.map((name) => input(name))
						.filter(Boolean)
						.map((node) => [node, node.value]),
				),
			};
			for (const id of [
				'scspDspTab',
				'effectEnabled',
				'delayTime',
				'delayFeedback',
				'effectSend',
				'effectReturn',
				'scspSaveSoundAs',
				'scspFileSaveSoundButton',
				'scspPresetSelect',
				'save',
			]) {
				const node = byId(id);
				if (node) {
					disabled.set(node, node.disabled);
					node.disabled = true;
				}
			}
		} else {
			for (const [node, original] of disabled) node.disabled = original;
			disabled.clear();
		}
		panel.setConnected(!value);
		if (!value && checkpoint) {
			for (const [node, original] of checkpoint.values) node.value = original;
			if (checkpoint.canvas)
				canvas?.getContext?.('2d')?.putImageData(checkpoint.canvas, 0, 0);
			if (memory) memory.textContent = checkpoint.memory;
			if (draftStatus) draftStatus.textContent = checkpoint.status;
			checkpoint = null;
		}
		panelRoot.dataset.ssfLive = String(value);
		panelRoot.dataset.ssfSlot = value ? String(selected) : '';
		for (const [node, original] of hidden) node.hidden = value || original;
		modulation.hidden = !value;
		if (rootText)
			rootText.textContent = value ? 'Playback rate (samples/s) ' : originalRootText;
		if (legend) legend.textContent = value ? 'PCM waveform · SSF preview' : originalLegend;
		if (canvas)
			canvas.setAttribute(
				'aria-label',
				value
					? 'SSF PCM preview from programmed sample start, read-only'
					: originalCanvasLabel,
			);
	}
	function displaySlot(read) {
		const voice = read.voice;
		for (const [name, value] of [
			['root', voice.frequencyHz],
			['bits', read.sample.bits],
			...Object.entries(voice.envelope),
			...['totalLevel', 'directLevel', 'pan'].map((name) => [name, voice[name]]),
			...Object.entries(voice.lfo).map(([name, value]) => ['lfo-' + name, value]),
		]) {
			const node = input(name);
			if (!node) continue;
			if (node.type === 'checkbox') node.checked = Boolean(value);
			else node.value = String(value);
		}
		const context = canvas?.getContext?.('2d');
		if (!context) return;
		const width = canvas.width,
			height = canvas.height,
			middle = height / 2;
		context.clearRect(0, 0, width, height);
		context.strokeStyle = '#46616b';
		context.beginPath();
		context.moveTo(0, middle);
		context.lineTo(width, middle);
		context.stroke();
		context.strokeStyle = '#63d5dc';
		context.beginPath();
		const full = read.sample.bits === 8 ? 128 : 32768;
		for (let index = 0; index < read.pcm.length; index++) {
			const x = read.pcm.length === 1 ? width / 2 : (index * width) / (read.pcm.length - 1);
			const y = middle - (read.pcm[index] / full) * (middle - 5);
			if (index) context.lineTo(x, y);
			else context.moveTo(x, y);
		}
		context.stroke();
	}
	function render() {
		if (disposed) return false;
		const ssf = playback?.kind === 'ssf' && playback.loaded;
		section.hidden = !ssf;
		const observing =
			ssf &&
			enabled.checked &&
			usable(snapshot) &&
			['playing', 'paused', 'seeking'].includes(playback.playback);
		readonly(Boolean(observing));
		section.dataset.active = String(active);
		section.dataset.frame = active ? String(snapshot.frame) : '';
		select.disabled = !ssf || !enabled.checked || !usable(snapshot);
		renderCapture();
		for (const [index, button] of buttons.entries()) {
			const slot = active ? snapshot.slots[index] : null;
			const sounding = Boolean(slot?.active);
			button.dataset.active = String(sounding);
			button.dataset.gate = String(Boolean(slot?.gate));
			button.setAttribute('aria-pressed', String(active && index === selected));
			button.disabled = select.disabled;
			button.title = slot
				? `Slot ${index + 1} · ${sounding ? 'Active' : 'Inactive'} · Gate ${slot.gate ? 'On' : 'Off'} · ENV ${Math.round(slot.envelopeLevel * 100)}%`
				: `Slot ${index + 1}`;
			button.style.setProperty('--ssf-env', String(slot?.envelopeLevel ?? 0));
		}
		if (!active) {
			projected = null;
			status.textContent = !enabled.checked
				? 'Live Off · authored instrument'
				: playback?.playing || playback?.playback === 'seeking'
					? 'Waiting for an audible SSF snapshot.'
					: playback?.paused
						? 'Waiting for a paused SSF snapshot.'
						: 'Play SSF to inspect its slots.';
			return false;
		}
		projected = projectScspSsfLiveSlot(snapshot, selected);
		panelRoot.dataset.ssfSlot = String(selected);
		displaySlot(projected.read);
		const slot = projected.slot;
		if (memory) memory.textContent = 'SSF sound RAM · 512 KiB · read-only snapshot';
		if (draftStatus) draftStatus.textContent = projected.preview.reason;
		for (const [key, output] of modulationValues)
			output.textContent =
				key === 'writeInhibit'
					? slot.voice.modulation[key]
						? 'On'
						: 'Off'
					: String(slot.voice.modulation[key]);
		const mode = slot.sample;
		const prefix = playback.paused
			? 'Paused · frozen'
			: playback.playback === 'seeking'
				? 'Seeking · frozen'
				: 'Live';
		const source =
			typeof mode.sourceMode === 'number'
				? (sources[mode.sourceMode] ?? `Source ${mode.sourceMode}`)
				: mode.sourceMode;
		const loop =
			typeof mode.loopMode === 'number'
				? (loops[mode.loopMode] ?? `Loop ${mode.loopMode}`)
				: mode.loopMode;
		status.textContent = `${prefix} · Slot ${selected + 1} · ${slot.active ? 'Active' : 'Inactive'} · Gate ${slot.gate ? 'On' : 'Off'} · ENV ${Math.round(slot.envelopeLevel * 100)}% ${phases[slot.envelopePhase] ?? ''} · ${source} ${mode.bits}-bit · Start ${hex(mode.startAddress)} · Loop ${mode.loopStart}–${mode.loopEnd} ${loop} · ${projected.read.pcm.length} preview samples · read-only`;
		return true;
	}
	return {
		update(nextPlayback = playback, nextSnapshot = snapshot) {
			playback = nextPlayback;
			snapshot = nextSnapshot;
			return render();
		},
		isActive: () => active,
		isEnabled: () => enabled.checked,
		setEnabled(value) {
			if (enabled.checked === Boolean(value)) return;
			enabled.checked = Boolean(value);
			captureError = '';
			render();
			onChange();
		},
		getPCM() {
			if (!active || !projected) throw new Error('No selected SSF slot snapshot');
			return projected.read;
		},
		getSelectedSlot: () => selected,
		getSelectedTarget: selectedTarget,
		getAuditionTarget() {
			return playback?.playback === 'paused' ? selectedTarget() : null;
		},
		dispose() {
			if (disposed) return;
			readonly(false);
			disposed = true;
			listeners.forEach((remove) => remove());
			modulation.remove();
		},
	};
}
