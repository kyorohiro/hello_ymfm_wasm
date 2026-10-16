import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperatorEnvelopeView} from './playground_operator_visual.js';

function operators() {
  return Object.fromEntries([1, 2, 3, 4].map(operator => [operator, {
    ar: 31, d1r: 12, d2r: 6, sl: 5, rr: 8, tl: 24, dt: 0,
    multi: operator,
  }]));
}

function setup(t, {observers = true, open = true, width = 640, editable = false} = {}) {
  const globalNames = ['document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame', 'IntersectionObserver', 'ResizeObserver'];
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
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(listener);
      },
      removeEventListener(type, listener) {
        assert(listeners.get(type)?.has(listener), 'remove the same registered listener');
        listeners.get(type).delete(listener);
        if (!listeners.get(type).size) listeners.delete(type);
      },
      emit(type, event) { for (const listener of listeners.get(type) ?? []) listener(event); },
    };
  }
  const document = {...events(), hidden: false};
  globalThis.document = document;
  const window = events();
  globalThis.window = window;
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
    arc(x, y, radius) { points.push([x, y, radius]); },
    fill() {},
  };
  const captures = [], releases = [], captured = new Set();
  const canvas = {
    ...events(),
    width: 700, height: 180,
    getContext(type) { assert.equal(type, '2d'); return context; },
    getBoundingClientRect() { return {width, height: 180, left: 20, top: 30}; },
    setPointerCapture(id) { captures.push(id); captured.add(id); },
    hasPointerCapture(id) { return captured.has(id); },
    releasePointerCapture(id) { releases.push(id); captured.delete(id); },
  };
  function button(dataset) {
    const classes = new Set();
    return {
      dataset, style: {}, attributes: new Map(),
      closest(selector) {
        return selector === '[data-envelope-handle]' && dataset.envelopeHandle !== undefined
          || selector === '[data-envelope-operator]' && dataset.envelopeOperator !== undefined ? this : null;
      },
      setAttribute(name, value) { this.attributes.set(name, value); },
      classList: {toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }},
      get selected() { return classes.has('is-selected'); },
    };
  }
  const operatorButtons = [1, 2, 3, 4].map(operator => button({envelopeOperator: String(operator)}));
  const handles = Object.fromEntries(['attack', 'decay', 'sustain', 'release'].map(handle => [handle, button({envelopeHandle: handle})]));
  const readout = {};
  const root = {
    ...events(), open,
    querySelector(selector) {
      if (selector === '[data-operator-envelope]') return canvas;
      assert.equal(selector, '[data-envelope-readout]');
      return readout;
    },
    querySelectorAll(selector) {
      if (selector === '[data-envelope-operator]') return operatorButtons;
      assert.equal(selector, '[data-envelope-handle]');
      return Object.values(handles);
    },
  };
  let current = operators();
  let reads = 0;
  let selectionKey = 'channel-1';
  const edits = [];
  view = createOperatorEnvelopeView({root, getOperators() { reads++; return current; },
    getSelectionKey: () => selectionKey,
    ...(editable ? {onEdit(operator, patch) {
      edits.push({operator, patch});
      Object.assign(current[operator], patch);
      view.invalidate(); // Production editor refreshes its guides after a register edit.
    }} : {}),
  });
  let disposed = false;
  return {
    view, root, canvas, document, window, frames, cancellations, renders,
    operatorButtons, handles, readout, edits, captures, releases, captured,
    get requests() { return requests; },
    get reads() { return reads; },
    get current() { return current; },
    get intersection() { return intersection; },
    get resize() { return resize; },
    setOperators(next) { current = next; },
    setSelectionKey(next) { selectionKey = next; },
    setWidth(next) { width = next; },
    intersect(next) { intersection.callback([{isIntersecting: next}]); },
    resizeCanvas() { resize.callback([{target: canvas}]); },
    event(target, properties = {}) {
      return {target, button: 0, pointerId: 1, clientX: 20, clientY: 30,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        ...properties,
      };
    },
    pointerDown(handle = 'attack', properties = {}) {
      const event = this.event(handles[handle], properties);
      root.emit('pointerdown', event);
      return event;
    },
    pointerMove(x, y, properties = {}) {
      const rect = canvas.getBoundingClientRect();
      const event = this.event(canvas, {clientX: rect.left + x * rect.width / canvas.width,
        clientY: rect.top + y * rect.height / canvas.height, ...properties});
      canvas.emit('pointermove', event);
      return event;
    },
    pointerEnd(type = 'pointerup', properties = {}) {
      const event = this.event(canvas, properties);
      canvas.emit(type, event);
      return event;
    },
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

test('editable guides select OP4 by default and expose parameter labels and handle locations', t => {
  const f = setup(t, {editable: true});
  f.start();
  assert.deepEqual(f.operatorButtons.map(button => button.attributes.get('aria-pressed')), ['false', 'false', 'false', 'true']);
  assert.deepEqual(f.operatorButtons.map(button => button.selected), [false, false, false, true]);
  assert.match(f.readout.textContent, /^OP4 · AR 31 · TL 24/);
  assert.equal(f.handles.attack.attributes.get('aria-label'), 'OP4 AR 31, TL 24');
  assert.equal(f.handles.decay.attributes.get('aria-label'), 'OP4 D1R 12, SL 5');
  for (const handle of Object.values(f.handles)) {
    assert(Number.isFinite(parseFloat(handle.style.left)));
    assert(Number.isFinite(parseFloat(handle.style.top)));
    assert.match(handle.title, /^OP4 /);
  }
  assert.equal(f.edits.length, 0);
  assert.equal(f.frames.size, 0);
});

test('only explicit handles start a primary-pointer drag and plain clicks do not edit', t => {
  const f = setup(t, {editable: true});
  f.start();
  f.root.emit('pointerdown', f.event(f.canvas));
  f.pointerDown('attack', {button: 2});
  f.pointerMove(0, 0);
  assert.deepEqual(f.captures, []);
  assert.deepEqual(f.edits, []);
  const down = f.pointerDown();
  assert.equal(down.defaultPrevented, true, 'dragging retains the audition keyboard focus');
  assert.deepEqual(f.captures, [1]);
  f.pointerEnd();
  f.advance();
  assert.deepEqual(f.edits, [], 'pressing and releasing a handle does not re-quantize a patch');
  assert.deepEqual(f.releases, [1]);
  assert.equal(f.frames.size, 0);
});

test('pointer moves coalesce to the latest point and write only the selected operator', t => {
  const f = setup(t, {editable: true});
  f.start();
  const untouched = structuredClone(f.current);
  f.pointerDown();
  f.pointerMove(200, 60);
  f.pointerMove(150, 80);
  f.pointerMove(-1000, -1000);
  assert.equal(f.frames.size, 1);
  assert.deepEqual(f.edits, [], 'pointer events do not each issue a register update');
  f.advance();
  assert.deepEqual(f.edits, [{operator: 4, patch: {tl: 0}}], 'unchanged AR is omitted from the patch');
  assert.equal(f.requests, 2, 'the edit callback invalidation does not schedule a nested frame');
  assert.equal(f.frames.size, 0);
  assert.deepEqual(f.current[1], untouched[1]);
  assert.deepEqual(f.current[2], untouched[2]);
  assert.deepEqual(f.current[3], untouched[3]);
  assert.match(f.readout.textContent, /^OP4 · AR 31 · TL 0/);
  f.pointerMove(-1000, -1000);
  f.advance();
  assert.equal(f.edits.length, 1, 'unchanged quantized values never issue redundant writes');
  f.pointerEnd();
  assert.equal(f.frames.size, 0);
});

test('pointerup commits the latest pending move once even before its scheduled frame', t => {
  const f = setup(t, {editable: true});
  f.start();
  f.pointerDown();
  f.pointerMove(2000, 2000);
  assert.equal(f.edits.length, 0);
  f.pointerEnd();
  assert.deepEqual(f.edits, [{operator: 4, patch: {ar: 0, tl: 127}}]);
  assert.equal(f.captured.size, 0);
  f.advance();
  assert.equal(f.edits.length, 1);
  assert.equal(f.frames.size, 0);
});

test('secondary pointers cannot move, end or replace the active drag', t => {
  const f = setup(t, {editable: true});
  f.start();
  f.pointerDown('attack', {pointerId: 7});
  f.pointerDown('release', {pointerId: 8});
  f.pointerMove(2000, 2000, {pointerId: 8});
  f.pointerEnd('pointerup', {pointerId: 8});
  assert.deepEqual(f.captures, [7]);
  assert.equal(f.captured.has(7), true);
  assert.equal(f.frames.size, 0);
  f.pointerMove(2000, 2000, {pointerId: 7});
  f.advance();
  assert.deepEqual(f.edits, [{operator: 4, patch: {ar: 0, tl: 127}}]);
  f.pointerEnd('pointerup', {pointerId: 7});
  assert.deepEqual(f.releases, [7]);
});

for (const [handle, values] of [
  ['attack', {ar: 0, tl: 127}],
  ['decay', {d1r: 0, sl: 15}],
  ['sustain', {d2r: 0}],
  ['release', {rr: 0}],
]) {
  test(`${handle} dragging clamps edits to finite integer register values`, t => {
    const f = setup(t, {editable: true});
    f.start();
    f.pointerDown(handle);
    f.pointerMove(1e6, 1e6);
    f.advance();
    assert.deepEqual(f.edits, [{operator: 4, patch: values}]);
    assert(Object.values(f.edits[0].patch).every(value => Number.isInteger(value) && Number.isFinite(value)));
    f.pointerEnd();
  });
}

for (const invalid of [NaN, Infinity, -Infinity]) {
  test(`nonfinite pointer coordinate ${String(invalid)} produces no edits`, t => {
    const f = setup(t, {editable: true});
    f.start();
    f.pointerDown();
    f.pointerMove(0, 0, {clientX: invalid});
    f.advance();
    f.pointerEnd();
    assert.deepEqual(f.edits, []);
    assert.equal(f.frames.size, 0);
  });
}

test('operator selection changes the highlighted guide and directs subsequent edits', t => {
  const f = setup(t, {editable: true});
  f.start();
  const button = f.operatorButtons[1];
  const down = f.event(button);
  f.root.emit('pointerdown', down);
  assert.equal(down.defaultPrevented, true, 'operator selection keeps the audition keyboard focus');
  f.root.emit('click', f.event(button));
  f.advance();
  assert.deepEqual(f.operatorButtons.map(item => item.selected), [false, true, false, false]);
  assert.match(f.readout.textContent, /^OP2 /);
  assert.equal(f.handles.attack.attributes.get('aria-label'), 'OP2 AR 31, TL 24');
  f.pointerDown();
  f.pointerMove(2000, 2000);
  f.advance();
  assert.deepEqual(f.edits, [{operator: 2, patch: {ar: 0, tl: 127}}]);
  assert.equal(f.current[4].tl, 24);
  f.pointerEnd();
});

for (const type of ['pointercancel', 'lostpointercapture']) {
  test(`${type} drops pending edits and stops the drag`, t => {
    const f = setup(t, {editable: true});
    f.start();
    f.pointerDown();
    f.pointerMove(2000, 2000);
    f.pointerEnd(type);
    f.advance();
    f.pointerMove(-1000, -1000);
    f.pointerEnd();
    f.advance();
    assert.deepEqual(f.edits, []);
    assert.equal(f.captured.size, 0);
    assert.equal(f.frames.size, 0);
  });
}

test('losing window focus drops pending edits and releases pointer capture', t => {
  const f = setup(t, {editable: true});
  f.start();
  f.pointerDown();
  f.pointerMove(2000, 2000);
  f.window.emit('blur');
  f.advance();
  assert.deepEqual(f.edits, []);
  assert.deepEqual(f.releases, [1]);
  assert.equal(f.frames.size, 0);
});

for (const [name, hide, show] of visibilityCases) {
  test(`${name} cancels a pending drag and prevents pointer and keyboard edits`, t => {
    const f = setup(t, {editable: true});
    f.start();
    f.pointerDown();
    f.pointerMove(2000, 2000);
    hide(f);
    assert.equal(f.frames.size, 0);
    assert.equal(f.captured.size, 0);
    f.pointerDown();
    f.pointerMove(-1000, -1000);
    f.pointerEnd();
    f.root.emit('keydown', f.event(f.handles.attack, {key: 'ArrowRight'}));
    f.advance();
    assert.deepEqual(f.edits, []);
    show(f);
    f.advance();
    assert.deepEqual(f.edits, [], 'restoring visibility never commits a cancelled drag');
    assert.equal(f.frames.size, 0);
  });
}

test('changing operator while dragging cancels the old pointer transaction', t => {
  const f = setup(t, {editable: true});
  f.start();
  f.pointerDown();
  f.pointerMove(2000, 2000);
  f.root.emit('click', f.event(f.operatorButtons[0]));
  f.advance();
  f.pointerMove(-1000, -1000);
  f.pointerEnd();
  assert.deepEqual(f.edits, []);
  assert.deepEqual(f.releases, [1]);
  assert.match(f.readout.textContent, /^OP1 /);
});

for (const changePoint of ['invalidate', 'move', 'release']) {
  test(`changing channel, file or preset identity before ${changePoint} cancels stale edits`, t => {
    const f = setup(t, {editable: true});
    f.start();
    f.pointerDown();
    f.pointerMove(2000, 2000);
    f.setSelectionKey('channel-2-file-or-preset-epoch-1');
    f.setOperators(operators());
    if (changePoint === 'invalidate') f.view.invalidate();
    else if (changePoint === 'move') f.pointerMove(-1000, -1000);
    else f.pointerEnd();
    f.advance();
    assert.deepEqual(f.edits, []);
    assert.equal(f.captured.size, 0);
    assert.equal(f.current[4].tl, 24);
    assert.equal(f.frames.size, 0);
  });
}

test('arrow keys edit their labelled register values without duplicate writes at limits', t => {
  const f = setup(t, {editable: true});
  f.start();
  const press = (handle, key, properties = {}) => {
    const event = f.event(f.handles[handle], {key, ...properties});
    f.root.emit('keydown', event);
    return event;
  };
  const event = press('attack', 'ArrowRight');
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.deepEqual(f.edits.at(-1), {operator: 4, patch: {ar: 30}});
  press('attack', 'ArrowDown');
  assert.deepEqual(f.edits.at(-1), {operator: 4, patch: {tl: 25}});
  press('decay', 'ArrowDown');
  assert.deepEqual(f.edits.at(-1), {operator: 4, patch: {sl: 6}});
  press('sustain', 'ArrowRight');
  assert.deepEqual(f.edits.at(-1), {operator: 4, patch: {d2r: 5}});
  press('release', 'ArrowLeft');
  assert.deepEqual(f.edits.at(-1), {operator: 4, patch: {rr: 9}});
  f.current[4].ar = 31;
  const count = f.edits.length;
  press('attack', 'ArrowLeft');
  press('attack', 'Enter');
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) press('attack', 'ArrowRight', {[modifier]: true});
  assert.equal(f.edits.length, count);
  f.advance();
  assert.equal(f.frames.size, 0);
});

test('disposing during a drag drops pending edits and removes every interaction listener', t => {
  const f = setup(t, {editable: true});
  f.start();
  f.pointerDown();
  f.pointerMove(2000, 2000);
  const pending = [...f.frames.values()][0];
  f.dispose();
  assert.equal(f.captured.size, 0);
  assert.deepEqual(f.releases, [1]);
  assert.equal(f.root.listeners.size, 0);
  assert.equal(f.canvas.listeners.size, 0);
  assert.equal(f.window.listeners.size, 0);
  assert.equal(f.document.listeners.size, 0);
  pending();
  f.pointerMove(-1000, -1000);
  f.pointerEnd();
  f.advance();
  assert.deepEqual(f.edits, []);
  assert.equal(f.frames.size, 0);
});

test('a view without an edit callback remains read-only when interaction controls are present', t => {
  const f = setup(t);
  f.start();
  f.pointerDown();
  f.pointerMove(2000, 2000);
  f.pointerEnd();
  f.root.emit('keydown', f.event(f.handles.attack, {key: 'ArrowRight'}));
  f.advance();
  assert.deepEqual(f.captures, []);
  assert.deepEqual(f.edits, []);
  assert.equal(f.requests, 1);
  assert.equal(f.renders.length, 1);
});
