// SPDX-License-Identifier: BSD-3-Clause

/** Native disclosures retain their control nodes and session open state. */
export function createPanelLayout({root, onSourceHidden = () => {}, onVisibilityChange = () => {}}) {
  const doc = root.ownerDocument ?? root, win = doc.defaultView;
  const monitor = root.querySelector('#monitorPanel'), pin = root.querySelector('#keepMonitorVisible');
  const events = new AbortController(), pointerSummaries = new WeakSet();
  const media = win.matchMedia('(min-width: 900px) and (min-height: 700px)');
  let disposed = false;
  function syncPin() {
    if (disposed) return;
    const pinned = pin.checked && media.matches;
    monitor.classList.toggle('is-pinned', pinned);
    monitor.dataset.pinned = String(pinned);
    doc.documentElement.style.setProperty('--nes-monitor-offset', `${pinned ? monitor.offsetHeight + 16 : 0}px`);
  }
  root.addEventListener('pointerdown', event => {
    const summary = event.target.closest?.('.nes-disclosure > summary');
    if (event.button !== 0 || !summary) return;
    pointerSummaries.add(summary);
    if (doc.activeElement !== summary) doc.activeElement?.blur?.();
  }, {signal:events.signal});
  root.addEventListener('click', event => {
    const summary = event.target.closest?.('.nes-disclosure > summary');
    if (!summary || !pointerSummaries.has(summary)) return;
    pointerSummaries.delete(summary);
    queueMicrotask(() => {if (!disposed && summary.contains(doc.activeElement)) doc.activeElement?.blur?.();});
  }, {signal:events.signal});
  root.addEventListener('keydown', event => {
    const summary = event.target.closest?.('.nes-disclosure > summary');
    if (summary) pointerSummaries.delete(summary);
  }, {signal:events.signal});
  root.addEventListener('toggle', event => {
    const details = event.target;
    if (!details.matches?.('details.nes-disclosure')) return;
    if (!details.open) {
      if (details.id === 'sourcePanel') onSourceHidden();
      const summary = details.querySelector(':scope > summary');
      if (details.contains(doc.activeElement) && !summary?.contains(doc.activeElement)) summary?.focus({preventScroll:true});
    }
    syncPin(); onVisibilityChange();
  }, {capture:true,signal:events.signal});
  pin.addEventListener('change', () => {pin.blur();syncPin();}, {signal:events.signal});
  media.addEventListener('change', syncPin, {signal:events.signal});
  const resize = new win.ResizeObserver(syncPin); resize.observe(monitor);
  syncPin();
  return {dispose() {
    if (disposed) return;
    disposed = true; events.abort(); resize.disconnect();
    monitor.classList.remove('is-pinned'); doc.documentElement.style.removeProperty('--nes-monitor-offset');
  }};
}
