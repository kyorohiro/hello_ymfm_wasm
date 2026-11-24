// SPDX-License-Identifier: BSD-3-Clause
import { createParamControl } from '../synth/synth_controls.js';
import { CH5_MODULATION_LENGTH, CH5_MODULATION_MAX, CH5_MODULATION_MIN, CH5_MODULATION_PRESETS } from './ch5.js?v=vsu-modulation-controls';

const formatOffset = value => value > 0 ? `+${value}` : String(value);

export function setupVsuModulationEditor({ grid, samples, onEdit, onSample }) {
  let values = [], selected = 0, drag = null, editable = false;

  function selectStep(index) {
    if (selected !== index) {
      setSelected(cells[selected], false);
      selected = index;
      setSelected(cells[selected], true);
    }
  }

  function setSelected(cell, isSelected) {
    cell.element.classList.toggle('is-selected', isSelected);
    for (const button of cell.buttons) button.tabIndex = isSelected ? 0 : -1;
  }

  function cancelDrag() {
    if (!drag) return;
    const { index } = drag;
    drag = null;
    cells[index].control.cancelDrag();
    cells[index].showValue(values[index]);
  }

  const cells = Array.from({ length: CH5_MODULATION_LENGTH }, (_, index) => {
    const element = document.createElement('div');
    element.className = 'ch5-mod-step';
    element.dataset.step = index;
    const address = document.createElement('span');
    address.textContent = String(index).padStart(2, '0');
    const name = `Modulation step ${address.textContent}`;
    const control = createParamControl({
      label: name, min: CH5_MODULATION_MIN, max: CH5_MODULATION_MAX, step: 1, value: 0,
      showLabel: false, wheelAdjust: false, formatValue: formatOffset,
      onChange(value) {
        if (!editable) return;
        selectStep(index);
        if (drag?.index === index) {
          drag.value = value;
          showValue(value);
        } else {
          onEdit(index, value);
          showValue(values[index]);
        }
      },
    });
    const buttons = [...control.element.querySelectorAll('button')];
    const [minus, valueButton, plus] = buttons;
    minus.setAttribute('aria-label', `Decrease ${name.toLowerCase()}`);
    plus.setAttribute('aria-label', `Increase ${name.toLowerCase()}`);
    valueButton.title = 'Drag left or right';

    function showValue(value) {
      control.updateVisual(value);
      const label = `${name}: ${formatOffset(value)}`;
      if (valueButton.getAttribute('aria-label') !== label) valueButton.setAttribute('aria-label', label);
    }

    valueButton.addEventListener('pointerdown', event => {
      if (!editable || event.button !== 0 || drag) {
        event.stopImmediatePropagation();
        return;
      }
      selectStep(index);
      valueButton.focus({ preventScroll: true });
      drag = { index, pointer: event.pointerId, value: values[index] };
    }, { capture: true });
    valueButton.addEventListener('pointerup', event => {
      if (drag?.index !== index || drag.pointer !== event.pointerId) return;
      const { value } = drag;
      drag = null;
      // The VSU locks Modulation RAM while CH5 is active. Commit the gesture
      // once so the note can keep sounding without repeated retriggering.
      if (editable) onEdit(index, value);
      showValue(values[index]);
    }, { capture: true });
    for (const type of ['pointercancel', 'lostpointercapture']) {
      valueButton.addEventListener(type, event => {
        if (drag?.index === index && drag.pointer === event.pointerId) cancelDrag();
      });
    }

    element.append(address, control.element);
    return { element, control, buttons, valueButton, showValue };
  });
  grid.replaceChildren(...cells.map(cell => cell.element));
  cells.forEach((cell, index) => setSelected(cell, index === selected));
  grid.addEventListener('focusin', event => {
    const cell = event.target.closest('.ch5-mod-step');
    if (cell) selectStep(Number(cell.dataset.step));
  });
  grid.addEventListener('keydown', event => {
    if (!editable || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const [minus, , plus] = cells[selected].buttons;
      (event.key === 'ArrowDown' ? minus : plus).click();
      return;
    }
    const last = cells.length - 1;
    const index = { ArrowLeft: Math.max(0, selected - 1), ArrowRight: Math.min(last, selected + 1), Home: 0, End: last }[event.key];
    if (index === undefined) return;
    event.preventDefault();
    cells[index].valueButton.focus();
  });

  const sampleButtons = CH5_MODULATION_PRESETS.map(({ id, label }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => {
      if (!editable) return;
      cancelDrag();
      onSample(id);
    });
    return button;
  });
  samples.replaceChildren(...sampleButtons);

  return {
    refresh(nextValues, canEdit) {
      if (drag && (!canEdit || values !== nextValues)) cancelDrag();
      values = nextValues;
      editable = canEdit;
      cells.forEach((cell, index) => {
        if (drag?.index !== index) cell.showValue(values[index]);
        for (const button of cell.buttons) button.disabled = !editable;
      });
      for (const button of sampleButtons) button.disabled = !editable;
    },
  };
}
