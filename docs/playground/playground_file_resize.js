/** Resize the project sidebar without changing the editor's own sizing policy. */
export function installFileExplorerResize(explorer, divider) {
  if (!explorer || !divider) return;
  const workspace = explorer.parentElement;
  const storageKey = 'tetorica.playground.fileExplorerWidth';
  const defaultWidth = 210;
  let preferred = defaultWidth;
  try {
    const saved = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(saved) && saved >= 120) preferred = saved;
  } catch { /* Storage can be unavailable in embedded/private contexts. */ }
  let drag = null;
  const limits = () => {
    const width = workspace.clientWidth;
    const max = Math.max(0, width - Math.min(240, width / 2) - divider.offsetWidth);
    return {min: Math.min(120, max), max};
  };
  const apply = () => {
    if (!workspace.clientWidth) return; // Keep the preferred width while the tab is hidden.
    const {min, max} = limits();
    const width = Math.round(Math.max(min, Math.min(max, preferred)));
    workspace.style.setProperty('--file-explorer-width', `${width}px`);
    divider.setAttribute('aria-valuemin', String(Math.ceil(min)));
    divider.setAttribute('aria-valuemax', String(Math.round(max)));
    divider.setAttribute('aria-valuenow', String(width));
    divider.setAttribute('aria-valuetext', `${width} pixels`);
  };
  const save = () => { try { localStorage.setItem(storageKey, String(preferred)); } catch {} };
  const setWidth = width => {
    const {min, max} = limits();
    preferred = Math.max(min, Math.min(max, width));
    apply();
  };
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    divider.focus();
    drag = {id: event.pointerId, x: event.clientX, width: explorer.getBoundingClientRect().width};
    divider.setPointerCapture(event.pointerId);
    workspace.classList.add('is-resizing');
  });
  divider.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    setWidth(drag.width + event.clientX - drag.x);
  });
  const finish = event => {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    workspace.classList.remove('is-resizing');
    if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
    save();
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) divider.addEventListener(type, finish);
  divider.addEventListener('dblclick', () => { preferred = defaultWidth; apply(); save(); });
  divider.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const {min, max} = limits();
    const step = event.shiftKey ? 40 : 10;
    const current = explorer.getBoundingClientRect().width;
    setWidth(event.key === 'Home' ? min : event.key === 'End' ? max : current + (event.key === 'ArrowLeft' ? -step : step));
    save();
  });
  new ResizeObserver(apply).observe(workspace);
  apply();
}
