const CLASS_NAME = 'is-live-changed';
const ANIMATION_NAME = 'synth-live-change';

/**
 * Highlight changed scalar values during existing Live UI updates only.
 * Controls supply cached DOM references and a scalar reader for each value.
 * CSS owns pulse duration; this helper adds no timer, frame loop or layout read.
 */
export function createSynthLiveHighlighter({controls, enabled=true}) {
  if (!Array.isArray(controls)) throw new TypeError('Highlight controls must be an array');
  if (typeof enabled !== 'boolean') throw new TypeError('Highlight enabled must be a boolean');
  const bindings = controls.map(({element, read}) => {
    if (!element?.classList || typeof read !== 'function') throw new TypeError('Highlight controls need an element and scalar reader');
    return {element, read};
  });
  const active = new Set(), handlers = new Map();
  let values = null, lastChannel, lastRevision, disposed = false;

  for (const {element} of bindings) {
    if (handlers.has(element)) continue;
    const finish = event => {
      if (event.target !== element || event.animationName !== ANIMATION_NAME || !active.delete(element)) return;
      element.classList.remove(CLASS_NAME);
    };
    handlers.set(element, finish);
    element.addEventListener('animationend', finish);
  }

  function clear() {
    for (const element of active) element.classList.remove(CLASS_NAME);
    active.clear();
    values = null;
    lastChannel = lastRevision = undefined;
  }

  function update(view) {
    // Off is intentionally before even inspecting a view or reading controls.
    if (!enabled || disposed) return;
    if (!view || view.paused || view.following === false || !view.snapshot || view.snapshot.frame === 0) {
      // Cooperative VGM preparation can report several partial register sets
      // before the first audible frame. Those are initialization, not edits.
      clear();
      return;
    }
    if (values && view.channel !== lastChannel) clear();
    const revision = view.snapshot.revision;
    // Frames advance without register changes. Reuse the previous baseline.
    if (values && revision !== undefined && revision === lastRevision) return;
    if (!values) {
      values = bindings.map(binding => binding.read(view));
    } else {
      for (let index = 0; index < bindings.length; index++) {
        const binding = bindings[index], next = binding.read(view);
        if (Object.is(next, values[index])) continue;
        values[index] = next;
        // A rapidly changing value gets one bounded pulse, not repeated
        // animation restarts, class writes or forced reflows within that pulse.
        if (!active.has(binding.element)) {
          active.add(binding.element);
          binding.element.classList.add(CLASS_NAME);
        }
      }
    }
    lastChannel = view.channel;
    lastRevision = revision;
  }

  return {
    update,
    clear,
    setEnabled(value) {
      if (typeof value !== 'boolean') throw new TypeError('Highlight enabled must be a boolean');
      if (disposed || value === enabled) return;
      enabled = value;
      clear();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
      for (const [element, handler] of handlers) element.removeEventListener('animationend', handler);
      handlers.clear();
    },
  };
}
