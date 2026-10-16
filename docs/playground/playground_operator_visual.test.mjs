import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperatorEnvelopeView} from './playground_operator_visual.js';

function operators() {
  return Object.fromEntries([1, 2, 3, 4].map(operator => [operator, {
    ar: 31, d1r: 12, d2r: 6, sl: 5, rr: 8, tl: 24, dt: 0,
    multi: operator,
  }]));
}

function setup(t, {observers = true, open = true, width = 640} = {}) {
  const globalNames = ['document', 'requestAnimationFrame', 'cancelAnimationFrame', 'IntersectionObserver', 'ResizeObserver'];
  const saved = new Map(globalNames.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let view;
  t.after(() => {
    view?.dispose();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  function events() {
    const listeners = new Map();
    return {
      listeners,
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type, listener) {
        assert.equal(listeners.get(type), listener, 'remove the same registered listener');
        listeners.delete(type);
      },
      emit(type) { listeners.get(type)?.(); },
    };
  }
  const document = {...events(), hidden: false};
  globalThis.document = document;
  const frames = new Map();
  const cancellations = [];
  let requests = 0;
  globalThis.requestAnimationFrame = callback => {
    frames.set(++requests, callback);
    return requests;
  };
  globalThis.cancelAnimationFrame = id => {
    cancellations.push(id);
    frames.delete(id);
  };
  let intersection, resize;
  if (observers) {
    globalThis.IntersectionObserver = class {
      constructor(callback) { this.callback = callback; this.observed = []; intersection = this; }
      observe(target) { this.observed.push(target); }
      disconnect() { this.disconnected = true; }
    };
    globalThis.ResizeObserver = class {
      constructor(callback) { this.callback = callback; this.observed = []; resize = this; }
      observe(target) { this.observed.push(target); }
      disconnect() { this.disconnected = true; }
    };
  } else {
    delete globalThis.IntersectionObserver;
    delete globalThis.ResizeObserver;
  }
  const renders = [];
  let points;
  const context = {
    fillRect() { renders.push({strokes: [], texts: []}); },
    beginPath() { points = []; },
    moveTo(x, y) { points.push([x, y]); },
    lineTo(x, y) { points.push([x, y]); },
    stroke() { renders.at(-1).strokes.push({style: this.strokeStyle, points: [...points]}); },
    fillText(text) { renders.at(-1).texts.push(text); },
  };
  const canvas = {
    width: 700, height: 180,
    getContext(type) { assert.equal(type, '2d'); return context; },
    getBoundingClientRect() { return {width}; },
  };
  const root = {
    ...events(), open,
    querySelector(selector) { assert.equal(selector, '[data-operator-envelope]'); return canvas; },
  };
  let current = operators();
  let reads = 0;
  view = createOperatorEnvelopeView({root, getOperators() { reads++; return current; }});
  let disposed = false;
  return {
    view, root, canvas, document, frames, cancellations, renders,
    get requests() { return requests; },
    get reads() { return reads; },
    get current() { return current; },
    get intersection() { return intersection; },
    get resize() { return resize; },
    setOperators(next) { current = next; },
    setWidth(next) { width = next; },
    intersect(next) { intersection.callback([{isIntersecting: next}]); },
    resizeCanvas() { resize.callback([{target: canvas}]); },
    advance() {
      const batch = [...frames.values()];
      frames.clear();
      for (const callback of batch) callback();
    },
    start() {
      view.setVisible(true);
      if (intersection) intersection.callback([{isIntersecting: true}]);
      this.advance();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      view.dispose();
      view = undefined;
    },
  };
}

function operatorStroke(render, operator = 1) {
  return render.strokes[4 + operator];
}

test('YM2612 envelope starts hidden without reading operators, drawing or scheduling', t => {
  const f = setup(t);
  assert.deepEqual(f.intersection.observed, [f.canvas]);
  assert.deepEqual(f.resize.observed, [f.canvas]);
  f.intersect(true);
  f.view.invalidate();
  f.view.invalidate();
  f.advance();
  assert.equal(f.reads, 0);
  assert.equal(f.renders.length, 0);
  assert.equal(f.requests, 0);
  assert.equal(f.frames.size, 0);
});

test('visible and intersecting dirty guides render once without a continuous frame loop', t => {
  const f = setup(t);
  f.view.setVisible(true);
  assert.equal(f.requests, 0, 'wait for the observed canvas to enter the viewport');
  f.intersect(true);
  assert.equal(f.frames.size, 1);
  assert.equal(f.reads, 0, 'read the current patch at draw time');
  f.advance();
  assert.equal(f.renders.length, 1);
  assert.equal(f.reads, 1);
  assert.equal(f.frames.size, 0);
  assert.deepEqual(f.renders[0].texts, ['Level', 'Time →']);
  assert.equal(f.renders[0].strokes.length, 9, 'axes, four gridlines and four real renderer guides');
  for (const stroke of f.renders[0].strokes) {
    assert(stroke.points.flat().every(Number.isFinite));
  }
  f.advance();
  f.view.setVisible(true);
  f.intersect(true);
  assert.equal(f.requests, 1, 'a clean visible view has no periodic work');
  assert.equal(f.reads, 1);
});

test('multiple invalidations coalesce into one frame using the latest operator object', t => {
  const f = setup(t);
  f.start();
  f.view.invalidate();
  f.view.invalidate();
  const latest = operators();
  latest[1].ar = 0;
  latest[1].tl = 96;
  f.setOperators(latest);
  f.view.invalidate();
  assert.equal(f.frames.size, 1);
  assert.equal(f.requests, 2);
  assert.equal(f.reads, 1);
  f.advance();
  assert.equal(f.reads, 2);
  assert.equal(f.renders.length, 2);
  const attack = operatorStroke(f.renders[1]).points[1];
  assert.equal(attack[0], 22 + (640 - 40) * .28, 'the late AR edit reaches the real renderer');
  assert.notDeepEqual(operatorStroke(f.renders[1]), operatorStroke(f.renders[0]));
  assert.equal(f.frames.size, 0);
});

test('unchanged guide values and changes to unrelated patch fields skip redraw', t => {
  const f = setup(t);
  f.start();
  f.view.invalidate();
  f.advance();
  assert.equal(f.reads, 2);
  assert.equal(f.renders.length, 1);
  const sameGuides = operators();
  sameGuides[2].multi = 13;
  sameGuides[4].am = true;
  f.setOperators(sameGuides);
  f.view.invalidate();
  f.advance();
  assert.equal(f.renders.length, 1, 'only values used by the guide belong to its draw signature');
  assert.equal(f.frames.size, 0);
});

for (const [field, value] of [['ar', 0], ['d1r', 2], ['d2r', 25], ['sl', 14], ['rr', 1], ['tl', 110], ['dt', 7]]) {
  test(`a changed ${field} guide value redraws the current patch`, t => {
    const f = setup(t);
    f.start();
    f.current[3][field] = value;
    f.view.invalidate();
    f.advance();
    assert.equal(f.renders.length, 2);
    assert.notDeepEqual(operatorStroke(f.renders[1], 3), operatorStroke(f.renders[0], 3));
    assert.equal(f.frames.size, 0);
  });
}

const visibilityCases = [
  ['hidden tab', f => f.view.setVisible(false), f => f.view.setVisible(true)],
  ['hidden document', f => { f.document.hidden = true; f.document.emit('visibilitychange'); },
    f => { f.document.hidden = false; f.document.emit('visibilitychange'); }],
  ['offscreen canvas', f => f.intersect(false), f => f.intersect(true)],
  ['collapsed details', f => { f.root.open = false; f.root.emit('toggle'); },
    f => { f.root.open = true; f.root.emit('toggle'); }],
];

for (const [name, hide, show] of visibilityCases) {
  test(`${name} cancels pending work and catches up to the latest patch on return`, t => {
    const f = setup(t);
    f.start();
    f.current[1].ar = 20;
    f.view.invalidate();
    assert.equal(f.frames.size, 1);
    hide(f);
    assert.equal(f.frames.size, 0);
    assert.equal(f.cancellations.length, 1);
    f.current[1].ar = 0;
    f.view.invalidate();
    f.view.invalidate();
    f.advance();
    assert.equal(f.reads, 1);
    assert.equal(f.renders.length, 1);
    assert.equal(f.requests, 2, 'hidden updates do not schedule frames');
    show(f);
    assert.equal(f.frames.size, 1);
    f.advance();
    assert.equal(f.reads, 2);
    assert.equal(f.renders.length, 2);
    assert.equal(operatorStroke(f.renders[1]).points[1][0], 22 + 600 * .28);
    assert.equal(f.frames.size, 0);
  });

  test(`a clean view remains idle when ${name} is restored without a patch change`, t => {
    const f = setup(t);
    f.start();
    hide(f);
    show(f);
    assert.equal(f.requests, 1);
    assert.equal(f.frames.size, 0);
    assert.equal(f.renders.length, 1);
  });
}

test('initially collapsed details defer the first draw until opened', t => {
  const f = setup(t, {open: false});
  f.view.setVisible(true);
  f.intersect(true);
  assert.equal(f.requests, 0);
  f.root.open = true;
  f.root.emit('toggle');
  f.advance();
  assert.equal(f.renders.length, 1);
  assert.equal(f.frames.size, 0);
});

test('resize uses rounded CSS width, respects the minimum and skips identical widths', t => {
  const f = setup(t, {width: 639.6});
  f.start();
  assert.equal(f.canvas.width, 640);
  f.setWidth(512.4);
  f.resizeCanvas();
  f.resizeCanvas();
  assert.equal(f.frames.size, 1);
  f.advance();
  assert.equal(f.canvas.width, 512);
  assert.equal(f.renders.length, 2);
  assert.equal(operatorStroke(f.renders[1]).points.at(-1)[0], 494);
  f.setWidth(512.1);
  f.resizeCanvas();
  f.advance();
  assert.equal(f.renders.length, 2);
  f.setWidth(120);
  f.resizeCanvas();
  f.advance();
  assert.equal(f.canvas.width, 280);
  assert.equal(f.renders.length, 3);
  assert.equal(f.frames.size, 0);
});

test('a resize while hidden waits and draws at the latest width when shown', t => {
  const f = setup(t);
  f.start();
  f.view.setVisible(false);
  f.setWidth(320);
  f.resizeCanvas();
  f.setWidth(480);
  f.resizeCanvas();
  assert.equal(f.frames.size, 0);
  assert.equal(f.renders.length, 1);
  f.view.setVisible(true);
  f.advance();
  assert.equal(f.canvas.width, 480);
  assert.equal(f.renders.length, 2);
});

test('observer-free environments still draw once only when made visible', t => {
  const f = setup(t, {observers: false});
  assert.equal(f.requests, 0);
  f.start();
  assert.equal(f.renders.length, 1);
  assert.equal(f.frames.size, 0);
  f.current[2].tl = 80;
  f.view.invalidate();
  f.advance();
  assert.equal(f.renders.length, 2);
  assert.equal(f.frames.size, 0);
});

test('dispose cancels scheduled work, disconnects observers and removes listeners', t => {
  const f = setup(t);
  f.start();
  f.current[1].tl = 50;
  f.view.invalidate();
  assert.equal(f.frames.size, 1);
  const pending = [...f.frames.values()][0];
  f.dispose();
  assert.equal(f.frames.size, 0);
  assert.equal(f.intersection.disconnected, true);
  assert.equal(f.resize.disconnected, true);
  assert.equal(f.root.listeners.size, 0);
  assert.equal(f.document.listeners.size, 0);
  pending();
  f.view.invalidate();
  f.view.setVisible(true);
  f.intersect(true);
  f.resizeCanvas();
  f.advance();
  assert.equal(f.renders.length, 1, 'even already queued callbacks cannot draw a disposed view');
  assert.equal(f.reads, 1);
  assert.equal(f.frames.size, 0);
});
