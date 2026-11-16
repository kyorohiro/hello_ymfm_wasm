// SPDX-License-Identifier: BSD-3-Clause
// Compact drag controls retain the original input as the host's value source.
export function setupNumberControls(root = document) {
  const cleanups = [], refreshers = new Map();
  for (const input of root.querySelectorAll('input[type="number"]')) {
    const doc = input.ownerDocument, group = doc.createElement('div');
    group.className = 'ym-stepper'; group.setAttribute('role', 'group');
    const label = input.closest('label')?.childNodes[0]?.textContent.trim() || input.id;
    group.setAttribute('aria-label', label);
    const output = doc.createElement('output'); output.id = input.id + 'Display';
    output.className = 'ym-stepper-value'; output.tabIndex = 0;
    output.setAttribute('role', 'spinbutton'); output.setAttribute('aria-label', label);
    const min = Number(input.min), max = Number(input.max), step = Number(input.step) || 1;
    output.setAttribute('aria-valuemin', String(min)); output.setAttribute('aria-valuemax', String(max));
    output.title = 'Drag left/right. Arrow keys change by one step; Shift drags faster.';
    const buttons = [-1, 1].map(delta => {
      const button = doc.createElement('button'); button.type = 'button';
      button.className = 'ym-stepper-button'; button.textContent = delta < 0 ? '−' : '+';
      button.setAttribute('aria-label', `${delta < 0 ? 'Decrease' : 'Increase'} ${label}`);
      button.addEventListener('pointerdown', e => {e.preventDefault(); doc.activeElement?.blur();});
      button.addEventListener('click', () => change(Number(input.value) + delta * step));
      return button;
    });
    group.append(buttons[0], output, buttons[1]); input.after(group); input.type = 'hidden';
    let drag = null;
    const refresh = () => {
      output.textContent = input.value; output.setAttribute('aria-valuenow', input.value);
      output.setAttribute('aria-disabled', String(input.disabled));
      output.tabIndex = input.disabled ? -1 : 0;
      buttons[0].disabled = input.disabled || Number(input.value) <= min;
      buttons[1].disabled = input.disabled || Number(input.value) >= max;
    };
    function change(value) {
      if (input.disabled) return;
      const next = Math.max(min, Math.min(max, Math.round(value / step) * step));
      if (Number(input.value) === next) return;
      input.value = String(next); refresh();
      input.dispatchEvent(new Event('input', {bubbles:true}));
    }
    output.addEventListener('pointerdown', e => {
      if (e.button !== 0 || input.disabled) return;
      e.preventDefault(); doc.activeElement?.blur();
      drag = {id:e.pointerId, x:e.clientX, value:Number(input.value), multiplier:e.shiftKey ? 16 : 1};
      output.setPointerCapture(e.pointerId);
    });
    output.addEventListener('pointermove', e => {
      if (drag?.id === e.pointerId) change(drag.value + Math.round((e.clientX - drag.x) / 4) * step * drag.multiplier);
    });
    const end = e => {if(drag?.id === e.pointerId) drag = null;};
    for (const type of ['pointerup','pointercancel','lostpointercapture']) output.addEventListener(type,end);
    output.addEventListener('keydown', e => {
      const n = Number(input.value);
      const value = ({ArrowUp:n+step,ArrowRight:n+step,ArrowDown:n-step,ArrowLeft:n-step,PageUp:n+step*16,PageDown:n-step*16,Home:min,End:max})[e.key];
      if(value === undefined) return;
      e.preventDefault(); e.stopPropagation(); change(value);
    });
    refreshers.set(input.id, refresh); refresh();
    cleanups.push(() => {group.remove(); input.type='number';});
  }
  return {refresh() {for(const fn of refreshers.values()) fn();}, dispose() {for(const fn of cleanups) fn();}};
}
