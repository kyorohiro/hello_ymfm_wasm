// SPDX-License-Identifier: BSD-3-Clause
import { createParamControl } from '../synth/synth_controls.js';
import { SM511_DEMO, SM511_ROM_STEPS, sm511Command, sm511CommandLabel, validateMelody } from './sm511.js';

const PAGE_SIZE = 16;
const REST = 0;
const STOP = 1;
const PITCH_MASK = 0xf;
const OCTAVE_BIT = 0x10;
const LENGTH_BIT = 0x20;
const ROM_PITCHES = Array.from({ length: 24 }, (_, index) => sm511Command(49 + index));
const ROM_COMMANDS = [STOP, REST, ...ROM_PITCHES];

const hexByte = value => `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
const commandLabel = command => command === STOP ? 'Stop' : command === REST ? 'Rest' : sm511CommandLabel(command);
function slotCommand(word) {
	const pitch = word & PITCH_MASK;
	return pitch > STOP ? word & (PITCH_MASK | OCTAVE_BIT) : pitch;
}

export function setupSm511MelodyEditor({ document, onChange = () => {} }) {
	const byId = id => document.getElementById(id);
	const slots = byId('sm511RomSlots'), prev = byId('sm511RomPrev'), next = byId('sm511RomNext');
	const page = byId('sm511RomPage'), addressOutput = byId('sm511RomAddress');
	const pitch = byId('sm511RomPitch'), length = byId('sm511RomLength'), wordOutput = byId('sm511RomWord');
	const lower = byId('sm511RomLower'), upper = byId('sm511RomUpper');
	const rom = new Uint8Array(SM511_ROM_STEPS);
	let address = 0;

	pitch.replaceChildren(...[REST, STOP, ...ROM_PITCHES.slice(0, 12)].map(command => {
		const option = document.createElement('option');
		option.value = String(command);
		option.textContent = command > STOP ? commandLabel(command).slice(0, -1) : commandLabel(command);
		return option;
	}));

	const pageStart = () => address - address % PAGE_SIZE;
	const cells = Array.from({ length: PAGE_SIZE }, (_, index) => {
		const element = document.createElement('div');
		element.className = 'sm511-rom-slot';
		const slotAddress = document.createElement('span');
		let drag = null;

		const control = createParamControl({
			label: 'ROM command', min: 0, max: ROM_COMMANDS.length - 1, step: 1, value: 0,
			showLabel: false, wheelAdjust: false,
			formatValue: value => commandLabel(ROM_COMMANDS[value]),
			onChange(value) {
				const target = pageStart() + index;
				const command = ROM_COMMANDS[value];
				const alreadySelected = address === target;
				address = target;
				if (command !== slotCommand(rom[target])) {
					const duration = drag?.duration ?? (rom[target] & LENGTH_BIT);
					writeWord(command === STOP ? STOP : command | duration);
				} else if (!alreadySelected) {
					render();
				}
			},
		});
		const valueButton = control.element.querySelector('.param-value');
		const [minus, plus] = control.element.querySelectorAll('.param-button');
		element.append(slotAddress, control.element);

		valueButton.addEventListener('pointerdown', event => {
			if (event.button !== 0 || !event.isPrimary || drag) {
				event.stopImmediatePropagation();
				return;
			}
			const target = pageStart() + index;
			// Keep the original duration even if the drag passes through Stop.
			drag = { pointer: event.pointerId, duration: rom[target] & LENGTH_BIT };
			selectAddress(target, true);
		}, { capture: true });
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
			valueButton.addEventListener(type, event => {
				if (drag?.pointer === event.pointerId) drag = null;
			});
		}
		valueButton.addEventListener('click', event => {
			if (event.detail === 0) selectAddress(pageStart() + index, true);
		});
		element.addEventListener('keydown', event => moveSelection(event, pageStart() + index));
		return {
			element, slotAddress, control, valueButton, minus, plus,
			cancelDrag() {
				drag = null;
				control.cancelDrag();
			},
		};
	});
	slots.replaceChildren(...cells.map(({ element }) => element));

	function render() {
		const start = pageStart();
		prev.disabled = start === 0;
		next.disabled = start + PAGE_SIZE >= SM511_ROM_STEPS;
		page.value = `${hexByte(start)}–${hexByte(start + PAGE_SIZE - 1)}`;
		const word = rom[address];
		const pitchCode = word & PITCH_MASK;
		const isNote = pitchCode > STOP;
		const upperOctave = Boolean(word & OCTAVE_BIT);
		addressOutput.value = hexByte(address);
		wordOutput.value = hexByte(word);
		pitch.value = String(pitchCode);
		lower.disabled = upper.disabled = !isNote;
		lower.setAttribute('aria-pressed', String(isNote && !upperOctave));
		upper.setAttribute('aria-pressed', String(isNote && upperOctave));
		length.value = String(word & LENGTH_BIT);
		length.disabled = pitchCode === STOP;

		for (const [index, { element, slotAddress, control, valueButton, minus, plus }] of cells.entries()) {
			const current = start + index;
			const word = rom[current];
			const command = slotCommand(word);
			const name = commandLabel(command);
			const selected = current === address;
			const hexAddress = hexByte(current);
			const label = command === STOP ? name : `${name} · ${word & LENGTH_BIT ? '125' : '62.5'} ms`;
			slotAddress.textContent = hexAddress;
			control.updateVisual(ROM_COMMANDS.indexOf(command));
			element.classList.toggle('is-selected', selected);
			valueButton.title = `${hexByte(word)} · ${label} · Drag left or right`;
			valueButton.setAttribute('aria-label', `${hexAddress} · ${label}`);
			valueButton.setAttribute('aria-pressed', String(selected));
			minus.setAttribute('aria-label', `${hexAddress} previous command`);
			plus.setAttribute('aria-label', `${hexAddress} next command`);
			valueButton.tabIndex = minus.tabIndex = plus.tabIndex = selected ? 0 : -1;
		}
	}

	function selectAddress(nextAddress, focus = false) {
		const clamped = Math.max(0, Math.min(SM511_ROM_STEPS - 1, nextAddress));
		if (Math.floor(clamped / PAGE_SIZE) !== Math.floor(address / PAGE_SIZE)) {
			for (const cell of cells) cell.cancelDrag();
		}
		address = clamped;
		render();
		if (focus) cells[address % PAGE_SIZE].valueButton.focus({ preventScroll: true });
	}

	function moveSelection(event, current) {
		let target;
		switch (event.key) {
			case 'ArrowLeft': target = current - 1; break;
			case 'ArrowRight': target = current + 1; break;
			case 'ArrowUp':
			case 'ArrowDown': {
				const rowEnd = cells.findIndex(({ element }) => element.offsetTop !== cells[0].element.offsetTop);
				const columns = rowEnd === -1 ? PAGE_SIZE : rowEnd;
				target = current + (event.key === 'ArrowUp' ? -columns : columns);
				break;
			}
			case 'PageUp': target = current - PAGE_SIZE; break;
			case 'PageDown': target = current + PAGE_SIZE; break;
			case 'Home': target = 0; break;
			case 'End': target = SM511_ROM_STEPS - 1; break;
			default: return;
		}
		event.preventDefault();
		selectAddress(target, true);
	}

	function movePage(offset, button) {
		const hadFocus = document.activeElement === button;
		selectAddress(address + offset);
		if (hadFocus && button.disabled) cells[address % PAGE_SIZE].valueButton.focus();
	}
	prev.addEventListener('click', () => movePage(-PAGE_SIZE, prev));
	next.addEventListener('click', () => movePage(PAGE_SIZE, next));

	const getMelody = () => Array.from(rom);
	function writeWord(word) {
		if (rom[address] === word) return;
		rom[address] = word;
		render();
		onChange(getMelody(), address);
	}
	pitch.addEventListener('change', () => {
		const command = Number(pitch.value);
		const current = rom[address];
		const octave = command > STOP && (current & PITCH_MASK) > STOP ? current & OCTAVE_BIT : 0;
		writeWord(command === STOP ? STOP : command | octave | (current & LENGTH_BIT));
	});
	lower.addEventListener('click', () => writeWord(rom[address] & ~OCTAVE_BIT));
	upper.addEventListener('click', () => writeWord(rom[address] | OCTAVE_BIT));
	length.addEventListener('change', () => {
		if (!length.disabled) writeWord((rom[address] & ~LENGTH_BIT) | Number(length.value));
	});

	function setMelody(commands) {
		const validated = validateMelody(commands);
		for (const cell of cells) cell.cancelDrag();
		rom.fill(STOP);
		rom.set(validated);
		selectAddress(0);
	}
	setMelody(SM511_DEMO);

	return { getMelody, setMelody };
}
