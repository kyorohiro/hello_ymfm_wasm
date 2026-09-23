// Cache per DOM node: changing tracks or view modes never reuses another node's state.
const htmlValues = new WeakMap();
const graphs = new WeakMap();
export function updateNoteishHtml(node, html) {
  if (htmlValues.get(node) === html) return;
  node.innerHTML = html;
  htmlValues.set(node, html);
}
export function updateNoteishGraph(viewport, mode, render) {
  let state = graphs.get(viewport);
  if (!state || state.mode !== mode) {
    htmlValues.delete(viewport);
    updateNoteishHtml(viewport, render(false));
    state = {mode};
    if (mode !== 'fretboard') {
      state.range = viewport.querySelector('[data-noteish-range]');
      state.current = viewport.querySelector('[data-noteish-current]');
      state.history = viewport.querySelector('[data-noteish-history]');
    }
    graphs.set(viewport, state);
    return;
  }
  if (mode === 'fretboard') { updateNoteishHtml(viewport, render(false)); return; }
  const parts = render(true);
  updateNoteishHtml(state.range, parts.range);
  updateNoteishHtml(state.current, parts.current);
  if (state.history && state.path !== parts.history) {
    state.history.setAttribute('d', parts.history);
    state.path = parts.history;
  }
}
