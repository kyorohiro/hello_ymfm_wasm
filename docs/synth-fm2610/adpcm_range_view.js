// SPDX-License-Identifier: BSD-3-Clause

/** Overlay the editable ROM range on the source waveform. The numeric
 * controls expose the same start/end values to keyboard and screen readers. */
export function createAdpcmRangeView(canvas, idPrefix, onChange) {
  const doc = canvas.ownerDocument;
  const element = (tag, className) => {
    const node = doc.createElement(tag);
    node.className = className;
    return node;
  };
  const plot = element('div', 'fm2610-adpcm-range-plot');
  const overlay = element('div', 'fm2610-adpcm-range-overlay');
  overlay.id = idPrefix + 'RangeOverlay';
  overlay.setAttribute('aria-hidden', 'true');
  const selected = element('div', 'fm2610-adpcm-range-selection');
  const markers = {};
  for (const [edge, label] of [['start', 'S'], ['end', 'E']]) {
    const marker = element('div', 'fm2610-adpcm-range-marker');
    const handle = doc.createElement('span');
    handle.textContent = label;
    handle.dataset.rangeMarker = edge;
    marker.append(handle);
    markers[edge] = marker;
  }
  const hint = element('p', 'fm2610-sample-name fm2610-adpcm-range-hint');
  hint.id = idPrefix + 'RangeHint';
  hint.textContent = 'Drag S / E to set the ROM range.';
  canvas.setAttribute('aria-describedby', hint.id);
  overlay.append(selected, markers.start, markers.end);
  plot.append(canvas, overlay);

  let view = null, drag = null;
  function cancelDrag() {
    if (!drag) return;
    const {pointer} = drag;
    drag = null;
    if (overlay.hasPointerCapture(pointer)) overlay.releasePointerCapture(pointer);
    delete overlay.dataset.dragging;
  }

  function show(next) {
    if (!next || !view || view.channel !== next.channel || view.rom !== next.rom ||
        view.first !== next.first || view.last !== next.last) cancelDrag();
    view = next;
    overlay.hidden = hint.hidden = !view;
    if (!view) return;
    const percent = address => (100 * (address - view.first) / (view.last - view.first)) + '%';
    selected.style.left = percent(view.start);
    markers.start.style.setProperty('--marker-position', percent(view.start));
    markers.end.style.setProperty('--marker-position', percent(view.end));
    selected.style.width = (100 * (view.end - view.start) / (view.last - view.first)) + '%';
  }

  function address(event) {
    const bounds = overlay.getBoundingClientRect();
    return view.first + (event.clientX - bounds.left) / bounds.width * (view.last - view.first);
  }

  overlay.addEventListener('pointerdown', event => {
    if (!view || drag || event.button !== 0) return;
    event.preventDefault();
    const at = address(event);
    const handle = event.target.closest('[data-range-marker]');
    const edge = handle?.dataset.rangeMarker ??
      (Math.abs(at - view.start) < Math.abs(at - view.end) ? 'start' : 'end');
    // Grabbing the label keeps the marker under the same point of the pointer.
    drag = {pointer: event.pointerId, edge, offset: handle ? at - view[edge] : 0};
    overlay.dataset.dragging = edge;
    overlay.setPointerCapture(event.pointerId);
    if (!handle) onChange(edge, at, view);
  });
  overlay.addEventListener('pointermove', event => {
    if (drag?.pointer !== event.pointerId) return;
    onChange(drag.edge, address(event) - drag.offset, view);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    overlay.addEventListener(type, event => {
      if (drag?.pointer === event.pointerId) cancelDrag();
    });
  }
  doc.defaultView.addEventListener('blur', cancelDrag);
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) cancelDrag(); });
  show(null);
  return {plot, hint, show, cancelDrag};
}
