import {
  drawOperatorEnvelopeGuides,
  getOperatorEnvelopeGeometry,
  operatorEnvelopePatchFromPoint,
} from './synth_envelope.js?v=synth-adsr-2';

// Patch editing without an analyser, audio initialization or animation loop.
// Synth can supply its existing RMS history; Playground remains guide-only.
export function createOperatorEnvelopeView({ root, getOperators, onEdit, getSelectionKey = () => 0, getOutputEnvelope = () => null }) {
  const canvas = root.querySelector('[data-operator-envelope]');
  const context = canvas.getContext('2d');
  const operatorButtons = [...(root.querySelectorAll?.('[data-envelope-operator]') ?? [])];
  const handleButtons = [...(root.querySelectorAll?.('[data-envelope-handle]') ?? [])];
  const readout = root.querySelector('[data-envelope-readout]');
  const editable = typeof onEdit === 'function';
  let selectedOperator = 4;
  let visible = false;
  let inView = typeof IntersectionObserver === 'undefined';
  let dirty = true;
  let outputDirty = false;
  let frame = null;
  let disposed = false;
  let previousSignature = '';
  let drag = null;
  let pendingPoint = null;
  let applyingPoint = false;

  function endDrag() {
    const pointerId = drag?.pointerId;
    drag = null;
    pendingPoint = null;
    if (pointerId !== undefined && canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
  }

  function cancel() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function canDraw() {
    return !disposed && visible && inView && root.open && !document.hidden;
  }

  function edit(patch) {
    if (!patch || !canDraw() || !editable) return;
    const settings = getOperators()[selectedOperator];
    const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => value !== settings[key]));
    if (Object.keys(changed).length) onEdit(selectedOperator, changed);
  }

  function applyPendingPoint() {
    if (!drag || !pendingPoint) return;
    if (!canDraw() || drag.selection !== getSelectionKey()) {
      endDrag();
      return;
    }
    const point = pendingPoint;
    pendingPoint = null;
    applyingPoint = true;
    try {
      edit(operatorEnvelopePatchFromPoint({
        width: canvas.width, height: canvas.height,
        settings: getOperators()[selectedOperator], handle: drag.handle, ...point,
      }));
    } finally { applyingPoint = false; }
  }

  function updateHandles(operators) {
    for (const button of operatorButtons) {
      const selected = Number(button.dataset.envelopeOperator) === selectedOperator;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-selected', selected);
    }
    if (!editable) return;
    const settings = operators[selectedOperator];
    const geometry = getOperatorEnvelopeGeometry({width: canvas.width, height: canvas.height, settings});
    if (!geometry) return;
    for (const button of handleButtons) {
      const handle = geometry.handles.find(point => point.id === button.dataset.envelopeHandle);
      if (!handle) continue;
      button.style.left = `${handle.x / canvas.width * 100}%`;
      button.style.top = `${handle.y / canvas.height * 100}%`;
      const label = `OP${selectedOperator} ${handle.params.map(key => `${key.toUpperCase()} ${settings[key]}`).join(', ')}`;
      button.setAttribute('aria-label', label);
      button.title = label;
    }
    if (readout) readout.textContent = `OP${selectedOperator} · ${['ar', 'tl', 'd1r', 'sl', 'd2r', 'rr'].map(key => `${key.toUpperCase()} ${settings[key]}`).join(' · ')}`;
  }

  function draw() {
    frame = null;
    if (!canDraw() || !dirty || !context) return;
    applyPendingPoint();
    const width = Math.max(280, Math.round(canvas.getBoundingClientRect().width));
    const operators = getOperators();
    const signature = [width, selectedOperator, ...[1, 2, 3, 4].flatMap(op =>
      ['ar', 'd1r', 'd2r', 'sl', 'rr', 'tl', 'dt'].map(key => operators[op][key]))].join(',');
    dirty = false;
    const guidesChanged = signature !== previousSignature;
    if (!guidesChanged && !outputDirty) return;
    outputDirty = false;
    previousSignature = signature;
    if (canvas.width !== width) canvas.width = width;
    drawOperatorEnvelopeGuides({ canvas, context, operatorStates: operators, editable, selectedOperator,
      outputEnvelope: getOutputEnvelope() });
    if (guidesChanged) updateHandles(operators);
  }

  function schedule() {
    if (canDraw() && dirty && frame === null && !applyingPoint) frame = requestAnimationFrame(draw);
  }

  function invalidate() {
    if (drag && drag.selection !== getSelectionKey()) endDrag();
    dirty = true;
    schedule();
  }

  function refreshVisibility() {
    if (canDraw()) schedule();
    else { endDrag(); cancel(); }
  }

  function pointerPoint(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    return {x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height};
  }

  function pointerDown(event) {
    if (event.target.closest?.('[data-envelope-operator]')) event.preventDefault();
    const handle = event.target.closest?.('[data-envelope-handle]');
    if (!editable || !handle || !handleButtons.includes(handle) || !canDraw() || drag || event.button !== 0) return;
    event.preventDefault(); // Keep the computer keyboard available for audition.
    drag = {handle: handle.dataset.envelopeHandle, pointerId: event.pointerId, selection: getSelectionKey()};
    canvas.setPointerCapture(event.pointerId);
  }

  function pointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    pendingPoint = pointerPoint(event);
    invalidate();
  }

  function pointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    try {
      // Commit the last move even if pointerup arrives before its queued frame.
      // A plain click never rewrites quantized parameter values.
      if (pendingPoint) applyPendingPoint();
    } finally { endDrag(); }
  }

  function pointerCancel(event) {
    if (drag && event.pointerId === drag.pointerId) endDrag();
  }

  function selectOperator(event) {
    const button = event.target.closest?.('[data-envelope-operator]');
    if (!button || !operatorButtons.includes(button)) return;
    const next = Number(button.dataset.envelopeOperator);
    if (!Number.isInteger(next) || next < 1 || next > 4) return;
    endDrag();
    selectedOperator = next;
    invalidate();
  }

  function keyDown(event) {
    const button = event.target.closest?.('[data-envelope-handle]');
    if (!editable || !button || !handleButtons.includes(button) || !canDraw() || event.ctrlKey || event.metaKey || event.altKey) return;
    const params = {attack: ['ar', 'tl'], decay: ['d1r', 'sl'], sustain: ['d2r'], release: ['rr']}[button.dataset.envelopeHandle];
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    if (!params || (!horizontal && !vertical)) return;
    event.preventDefault();
    event.stopPropagation();
    const key = vertical && params[1] ? params[1] : params[0];
    const delta = horizontal ? (event.key === 'ArrowLeft' ? 1 : -1)
      : (params[1] ? (event.key === 'ArrowUp' ? -1 : 1) : (event.key === 'ArrowUp' ? 1 : -1));
    const max = key === 'tl' ? 127 : key === 'sl' || key === 'rr' ? 15 : 31;
    edit({[key]: Math.max(0, Math.min(max, getOperators()[selectedOperator][key] + delta))});
    invalidate();
  }

  const intersection = typeof IntersectionObserver === 'undefined' ? null :
    new IntersectionObserver(entries => {
      inView = entries.some(entry => entry.isIntersecting);
      refreshVisibility();
    });
  intersection?.observe(canvas);
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(invalidate);
  resize?.observe(canvas);
  root.addEventListener('toggle', refreshVisibility);
  root.addEventListener('pointerdown', pointerDown);
  root.addEventListener('click', selectOperator);
  root.addEventListener('keydown', keyDown);
  canvas.addEventListener?.('pointermove', pointerMove);
  canvas.addEventListener?.('pointerup', pointerUp);
  canvas.addEventListener?.('pointercancel', pointerCancel);
  canvas.addEventListener?.('lostpointercapture', pointerCancel);
  globalThis.window?.addEventListener('blur', endDrag);
  document.addEventListener('visibilitychange', refreshVisibility);

  return {
    invalidate,
    invalidateOutput() {
      outputDirty = true;
      dirty = true;
      schedule();
    },
    setVisible(nextVisible) {
      visible = Boolean(nextVisible);
      refreshVisibility();
    },
    dispose() {
      disposed = true;
      endDrag();
      cancel();
      intersection?.disconnect();
      resize?.disconnect();
      root.removeEventListener('toggle', refreshVisibility);
      root.removeEventListener('pointerdown', pointerDown);
      root.removeEventListener('click', selectOperator);
      root.removeEventListener('keydown', keyDown);
      canvas.removeEventListener?.('pointermove', pointerMove);
      canvas.removeEventListener?.('pointerup', pointerUp);
      canvas.removeEventListener?.('pointercancel', pointerCancel);
      canvas.removeEventListener?.('lostpointercapture', pointerCancel);
      globalThis.window?.removeEventListener('blur', endDrag);
      document.removeEventListener('visibilitychange', refreshVisibility);
    },
  };
}
