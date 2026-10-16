import { drawOperatorEnvelopeGuides } from '../synth/synth_envelope.js';

// A passive patch diagram: no analyser, audio initialization or animation loop.
export function createOperatorEnvelopeView({ root, getOperators }) {
  const canvas = root.querySelector('[data-operator-envelope]');
  const context = canvas.getContext('2d');
  let visible = false;
  let inView = typeof IntersectionObserver === 'undefined';
  let dirty = true;
  let frame = null;
  let disposed = false;
  let previousSignature = '';

  function cancel() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function canDraw() {
    return !disposed && visible && inView && root.open && !document.hidden;
  }

  function draw() {
    frame = null;
    if (!canDraw() || !dirty || !context) return;
    const width = Math.max(280, Math.round(canvas.getBoundingClientRect().width));
    const operators = getOperators();
    const signature = [width, ...[1, 2, 3, 4].flatMap(op =>
      ['ar', 'd1r', 'd2r', 'sl', 'rr', 'tl', 'dt'].map(key => operators[op][key]))].join(',');
    dirty = false;
    if (signature === previousSignature) return;
    previousSignature = signature;
    if (canvas.width !== width) canvas.width = width;
    drawOperatorEnvelopeGuides({ canvas, context, operatorStates: operators });
  }

  function schedule() {
    if (canDraw() && dirty && frame === null) frame = requestAnimationFrame(draw);
  }

  function invalidate() {
    dirty = true;
    schedule();
  }

  function refreshVisibility() {
    if (canDraw()) schedule();
    else cancel();
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
  document.addEventListener('visibilitychange', refreshVisibility);

  return {
    invalidate,
    setVisible(nextVisible) {
      visible = Boolean(nextVisible);
      refreshVisibility();
    },
    dispose() {
      disposed = true;
      cancel();
      intersection?.disconnect();
      resize?.disconnect();
      root.removeEventListener('toggle', refreshVisibility);
      document.removeEventListener('visibilitychange', refreshVisibility);
    },
  };
}
