/** Arrange Files beside an editor and independently selectable bottom tools. */
export function installPlaygroundWorkbench(root, {storage, search = window.location.search} = {}) {
  const params = new URLSearchParams(search);
  if (!root || params.get('mode') === 'simple') return null;
  try {if (storage === undefined) storage = globalThis.localStorage;} catch {storage = null;}
  const key = 'tetorica.playground.bottomPanel';
  let saved = {};
  try { saved = JSON.parse(storage?.getItem(key) || '{}') ?? {}; } catch {}
  const tabs = new Set(['audio', 'fxMonitor', 'console', 'shell']);
  let state = {
    height: Number.isFinite(saved.height) ? Math.max(120, Math.min(600, saved.height)) : 260,
    bottomTab: tabs.has(saved.bottomTab) ? saved.bottomTab : 'console',
    dockOpen: typeof saved.dockOpen === 'boolean' ? saved.dockOpen : true,
  };
  if (params.get('monitor') === '1') {state.bottomTab = 'audio'; state.dockOpen = true;}
  function element(tag, className) {
    const node = document.createElement(tag); node.className = className; return node;
  }
  const primaryTabs = root.querySelector('.tabbar');
  const explorer = document.getElementById('fileExplorer');
  const fileDivider = document.getElementById('fileExplorerDivider');
  primaryTabs.setAttribute('aria-label', 'Editor panels');
  const right = element('div', 'workbench-right');
  const editor = element('div', 'workbench-editor');
  const primaryPanels = element('div', 'workbench-primary-panels');
  const dock = element('section', 'workbench-dock'); dock.id = 'bottomDock';
  const dockTabs = element('div', 'tabbar');
  dockTabs.setAttribute('role', 'tablist'); dockTabs.setAttribute('aria-label', 'Bottom panels');
  const divider = element('div', 'bottom-panel-divider');
  divider.setAttribute('role', 'separator'); divider.tabIndex = 0;
  divider.setAttribute('aria-orientation', 'horizontal'); divider.setAttribute('aria-label', 'Bottom panel height');
  divider.setAttribute('aria-controls', 'bottomDock');
  divider.title = 'Drag to resize · Double-click to reset · Arrow keys to adjust';
  for (const [name, id] of [['audio','audioMonitor'], ['fxMonitor','fxMonitor'], ['console','console'], ['shell','shell']]) {
    dockTabs.appendChild(document.getElementById(`${id}Tab`));
    dock.appendChild(document.getElementById(`${id}Panel`));
  }
  const close = element('button', 'dock-close');
  close.type = 'button'; close.textContent = '×';
  close.title = 'Hide bottom panel'; close.setAttribute('aria-label', close.title);
  dockTabs.appendChild(close); dock.prepend(dockTabs);
  const toggle = element('button', 'dock-toggle');
  toggle.type = 'button'; toggle.textContent = 'Panel'; toggle.setAttribute('aria-controls', 'bottomDock');
  primaryTabs.appendChild(toggle);
  for (const id of ['codePanel','operatorPanel','keyboardPanel','helpersPanel']) primaryPanels.appendChild(document.getElementById(id));
  editor.append(primaryTabs, primaryPanels); right.append(editor, divider, dock);
  root.append(explorer, fileDivider, right);
  root.classList.add('workbench');
  let drag = null, visibilityHandler = null;
  function save() {try {storage?.setItem(key, JSON.stringify(state));} catch {}}
  function maxHeight() {return Math.max(120, right.clientHeight - 180);}
  function applyHeight() {
    const height = Math.round(Math.max(120, Math.min(maxHeight(), state.height)));
    right.style.setProperty('--bottom-panel-height', `${height}px`);
    divider.setAttribute('aria-valuemin', '120'); divider.setAttribute('aria-valuemax', String(Math.round(maxHeight())));
    divider.setAttribute('aria-valuenow', String(height)); divider.setAttribute('aria-valuetext', `${height} pixels`);
  }
  function sync({bottomTab, dockOpen}) {
    state.bottomTab = bottomTab; state.dockOpen = dockOpen;
    dock.hidden = divider.hidden = !dockOpen;
    toggle.setAttribute('aria-expanded', String(dockOpen));
    toggle.setAttribute('aria-label', dockOpen ? 'Hide bottom panel' : 'Show bottom panel');
    applyHeight(); save();
  }
  close.addEventListener('click', () => visibilityHandler?.(false));
  toggle.addEventListener('click', () => visibilityHandler?.(!state.dockOpen));
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    event.preventDefault(); divider.focus();
    drag = {id: event.pointerId, y: event.clientY, height: dock.getBoundingClientRect().height};
    divider.setPointerCapture(event.pointerId); root.classList.add('is-resizing');
  });
  divider.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    state.height = Math.max(120, Math.min(maxHeight(), drag.height + drag.y - event.clientY)); applyHeight();
  });
  function finish(event) {
    if (drag?.id !== event.pointerId) return;
    drag = null; root.classList.remove('is-resizing');
    if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
    save();
  }
  for (const type of ['pointerup','pointercancel','lostpointercapture']) divider.addEventListener(type, finish);
  divider.addEventListener('dblclick', () => {state.height = 260; applyHeight(); save();});
  divider.addEventListener('keydown', event => {
    if (!['ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const current = dock.getBoundingClientRect().height;
    state.height = event.key === 'Home' ? 120 : event.key === 'End' ? maxHeight() :
      Math.max(120, Math.min(maxHeight(), current + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 40 : 10)));
    applyHeight(); save();
  });
  const observer = new ResizeObserver(applyHeight); observer.observe(right);
  return {initialBottomTab: state.bottomTab, initialDockOpen: state.dockOpen, sync,
    onVisibilityChange(handler) {visibilityHandler = handler;}, dispose() {observer.disconnect();}};
}
