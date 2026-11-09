const CACHE_PREFERENCE = 'tetorica-fm2612-synth-seek-cache';

function displayTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds || 0));
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
}

/** Scrubbing previews a position; only releasing the control starts a seek. */
export function setupSynthSongSeekControls({preview, onStatus = () => {}}) {
  const root = document.getElementById('synthSongPlayer');
  const range = document.getElementById('synthSongSeek');
  const time = document.getElementById('synthSongTime');
  const cache = document.getElementById('synthSongSeekCacheToggle');
  const listeners = [];
  let lastState = null, draft = null, editing = false, heldPosition = 0;
  let disposed = false, operation = 0;
  const navigation = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);
  const listen = (node, type, handler) => {
    node.addEventListener(type, handler);
    listeners.push(() => node.removeEventListener(type, handler));
  };
  function cancelDraft() {
    draft = null;
    editing = false;
    operation++;
  }
  function paint(state) {
    const duration = Number.isFinite(state.durationSeconds) ? Math.max(0, state.durationSeconds) : 0;
    const position = draft ?? (editing ? heldPosition : state.seekTargetSeconds ?? state.positionSeconds ?? 0);
    const bounded = Math.max(0, Math.min(duration, position));
    range.disabled = !(state.seekable ?? state.durationKnown) || duration <= 0;
    if (range.max !== String(duration)) range.max = String(duration);
    if (Number(range.value) !== bounded) range.value = String(bounded);
    range.style.setProperty('--seek-position', (duration ? bounded / duration * 100 : 0) + '%');
    const text = displayTime(bounded) + ' / ' + displayTime(duration);
    if (time.textContent !== text) time.textContent = text;
    const accessibleTime = displayTime(bounded) + ' of ' + displayTime(duration);
    if (range.getAttribute('aria-valuetext') !== accessibleTime) range.setAttribute('aria-valuetext', accessibleTime);
    range.title = range.disabled ? 'The seek bar becomes available when the VGM duration is known.'
      : 'Seek to ' + bounded.toFixed(3) + ' / ' + duration.toFixed(3) + ' seconds. Release to move; arrows: 1 second, Shift: 10 seconds.';
    const stats = state.cache ?? {};
    if (cache.checked !== (stats.enabled !== false)) cache.checked = stats.enabled !== false;
    const cacheTitle = 'Keep visited playback states in memory (up to 32 MiB). Uncached sections replay silently. ' +
      (stats.supported ? (stats.count ?? 0) + ' checkpoints, ' + ((stats.bytes ?? 0) / 1048576).toFixed(1) + ' MiB.'
        : 'Normal seeking is used when snapshots are unavailable.');
    if (cache.title !== cacheTitle) cache.title = cacheTitle;
    for (const [key, value] of Object.entries({
      cacheEnabled: stats.enabled !== false, cacheSupported: Boolean(stats.supported),
      cacheCount: stats.count ?? 0, cacheBytes: stats.bytes ?? 0,
      cacheMaxCount: stats.maxCount ?? 120, cacheMaxBytes: stats.maxBytes ?? 32 * 1024 * 1024,
      lastSeekCacheFrame: state.lastSeekCacheFrame ?? stats.lastRestoreFrame ?? 0,
    })) {
      if (root.dataset[key] !== String(value)) root.dataset[key] = String(value);
    }
  }
  function update(state) {
    if (disposed) return;
    if (lastState && (state.name !== lastState.name ||
      state.playback === 'loading' ||
      state.playback === 'stopped' && lastState.playback !== 'stopped')) cancelDraft();
    lastState = state;
    paint(state);
  }
  async function commit() {
    if (disposed || draft === null || range.disabled) return;
    const target = draft, ticket = ++operation;
    draft = null;
    editing = false;
    try {
      await preview.seek(target);
    } catch (error) {
      if (!disposed && ticket === operation && error.name !== 'AbortError') onStatus('Seek failed: ' + error.message);
    } finally {
      if (!disposed && ticket === operation) update(preview.getState());
    }
  }
  function previewPosition() {
    if (!lastState || range.disabled) return;
    draft = Number(range.value);
    heldPosition = draft;
    paint(lastState);
  }
  listen(range, 'pointerdown', () => {editing = true; heldPosition = Number(range.value);});
  listen(range, 'input', previewPosition);
  listen(range, 'change', () => {void commit();});
  listen(range, 'pointerup', () => {
    editing = false;
    if (draft !== null) void commit();
    else if (lastState) paint(lastState);
  });
  listen(range, 'pointercancel', () => {cancelDraft(); if (lastState) paint(lastState);});
  listen(range, 'keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      cancelDraft(); if (lastState) paint(lastState);
      return;
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation();
      return;
    }
    if (!navigation.has(event.key) || range.disabled) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 10 : 1;
    const deltas = {ArrowLeft:-step, ArrowDown:-step, ArrowRight:step, ArrowUp:step, PageDown:-10, PageUp:10};
    const value = Number(range.value), maximum = Number(range.max);
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? maximum : value + deltas[event.key];
    editing = true;
    range.value = String(Math.max(0, Math.min(maximum, target)));
    previewPosition();
  });
  listen(range, 'keyup', event => {
    if (!navigation.has(event.key)) return;
    event.stopPropagation();
    editing = false;
    void commit();
  });
  listen(range, 'blur', () => {editing = false; if (draft !== null) void commit();});
  listen(cache, 'change', () => {
    try {
      preview.setSeekCacheEnabled(cache.checked);
      try {localStorage.setItem(CACHE_PREFERENCE, cache.checked ? 'on' : 'off');} catch {}
    } catch (error) {onStatus('Seek cache: ' + error.message);}
    cache.blur();
  });
  try {preview.setSeekCacheEnabled(localStorage.getItem(CACHE_PREFERENCE) !== 'off');} catch {}
  update(preview.getState());
  return {update, cancelDraft, dispose() {
    disposed = true;
    cancelDraft();
    for (const remove of listeners) remove();
  }};
}
