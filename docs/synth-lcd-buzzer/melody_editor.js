// SPDX-License-Identifier: BSD-3-Clause
import { SM511_DEMO, SM511_ROM_STEPS, sm511Command, sm511CommandLabel, validateMelody } from './sm511.js';

const PAGE_SIZE = 16;
const REST = 0;
const STOP = 1;
const LENGTH_BIT = 0x20;
const PITCH_OPTIONS = [
	[REST, 'Rest'], [STOP, 'Stop'],
	...Array.from({ length: 24 }, (_, index) => {
		const pitch = sm511Command(49 + index);
		return [pitch, sm511CommandLabel(pitch)];
	}),
];
const PITCH_LABELS = new Map(PITCH_OPTIONS);
const ADDRESS_MOVES = new Map([
	['ArrowLeft', -1], ['ArrowUp', -4], ['ArrowRight', 1], ['ArrowDown', 4],
	['PageUp', -PAGE_SIZE], ['PageDown', PAGE_SIZE],
]);

const hexByte = value => `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
const pitchField = word => (word & 0xf) <= STOP ? word & 0xf : word & 0x1f;

export function setupSm511MelodyEditor({ document, onChange = () => {} }) {
	const byId = id => document.getElementById(id);
	const slots = byId('sm511RomSlots'), prev = byId('sm511RomPrev'), next = byId('sm511RomNext');
	const page = byId('sm511RomPage'), addressOutput = byId('sm511RomAddress');
	const pitch = byId('sm511RomPitch'), length = byId('sm511RomLength'), wordOutput = byId('sm511RomWord');
	const playFrom = byId('sm511PlayFrom');
	const rom = new Uint8Array(SM511_ROM_STEPS);
	let address = 0;

	pitch.replaceChildren(...PITCH_OPTIONS.map(([command, label]) => {
		const option = document.createElement('option');
		option.value = String(command);
		option.textContent = label;
		return option;
	}));

	const pageStart = () => address - address % PAGE_SIZE;
	const buttons = Array.from({ length: PAGE_SIZE }, (_, index) => {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'sm511-rom-slot';
		const slotAddress = document.createElement('span'), slotLabel = document.createElement('span');
		button.append(slotAddress, slotLabel);
		button.addEventListener('click', () => selectAddress(pageStart() + index, true));
		button.addEventListener('keydown', event => {
			const move = ADDRESS_MOVES.get(event.key);
			if (event.key === 'Home') selectAddress(0, true);
			else if (event.key === 'End') selectAddress(SM511_ROM_STEPS - 1, true);
			else if (move !== undefined) selectAddress(address + move, true);
			else return;
			event.preventDefault();
		});
		return { button, slotAddress, slotLabel };
	});
	slots.replaceChildren(...buttons.map(({ button }) => button));

	function render() {
		const start = pageStart();
		prev.disabled = start === 0;
		next.disabled = start + PAGE_SIZE >= SM511_ROM_STEPS;
		page.value = `${hexByte(start)}–${hexByte(start + PAGE_SIZE - 1)}`;
		const word = rom[address];
		const selectedAddress = hexByte(address);
		addressOutput.value = selectedAddress;
		wordOutput.value = hexByte(word);
		pitch.value = String(pitchField(word));
		length.value = String(word & LENGTH_BIT);
		length.disabled = (word & 0xf) === STOP;
		playFrom.textContent = `Play from ${selectedAddress}`;

		for (const [index, { button, slotAddress, slotLabel }] of buttons.entries()) {
			const current = start + index;
			const command = rom[current];
			const tone = pitchField(command);
			const pressed = current === address;
			const label = tone === STOP ? 'Stop' : `${PITCH_LABELS.get(tone)} · ${command & LENGTH_BIT ? '125' : '62.5'} ms`;
			slotAddress.textContent = hexByte(current);
			slotLabel.textContent = PITCH_LABELS.get(tone);
			button.title = `${hexByte(command)} · ${label}`;
			button.setAttribute('aria-label', `${hexByte(current)} · ${label}`);
			button.setAttribute('aria-pressed', String(pressed));
			button.tabIndex = pressed ? 0 : -1;
		}
	}

	function selectAddress(nextAddress, focus = false) {
		address = Math.max(0, Math.min(SM511_ROM_STEPS - 1, nextAddress));
		render();
		if (focus) buttons[address % PAGE_SIZE].button.focus();
	}

	function movePage(offset, button) {
		const hadFocus = document.activeElement === button;
		selectAddress(address + offset);
		if (hadFocus && button.disabled) buttons[address % PAGE_SIZE].button.focus();
	}
	prev.addEventListener('click', () => movePage(-PAGE_SIZE, prev));
	next.addEventListener('click', () => movePage(PAGE_SIZE, next));

	const getMelody = () => Array.from(rom);
	function writeWord(word) {
		if (rom[address] === word) return;
		rom[address] = word;
		render();
		onChange(getMelody());
	}
	pitch.addEventListener('change', () => {
		const command = Number(pitch.value);
		writeWord(command === STOP ? STOP : command | (rom[address] & LENGTH_BIT));
	});
	length.addEventListener('change', () => {
		if (!length.disabled) writeWord((rom[address] & ~LENGTH_BIT) | Number(length.value));
	});

	function setMelody(commands) {
		const validated = validateMelody(commands);
		rom.fill(STOP);
		rom.set(validated);
		selectAddress(0);
	}
	setMelody(SM511_DEMO);

	return { getMelody, setMelody, getAddress: () => address };
}
