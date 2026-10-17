import test from 'node:test';
import assert from 'node:assert/strict';
import {
  drawEnvelopeGuide,
  drawOperatorEnvelopeGuides,
  getOperatorEnvelopeGeometry,
  operatorEnvelopePatchFromPoint,
} from './synth_envelope.js';

const colors = ['#f2c078', '#ff93bc', '#9dff9b', '#89b7ff'];

function createFixture() {
  const strokes = [];
  const texts = [];
  const fills = [];
  const circles = [];
  let path = [];
  const context = {
    globalAlpha: 1,
    beginPath() { path = []; },
    moveTo(x, y) { path.push(['moveTo', x, y]); },
    lineTo(x, y) { path.push(['lineTo', x, y]); },
    stroke() {
      strokes.push({
        color: this.strokeStyle,
        width: this.lineWidth,
        alpha: this.globalAlpha,
        path: path.slice(),
      });
    },
    fillText(text, x, y) { texts.push({text, x, y}); },
    fillRect(x, y, width, height) {
      fills.push({color: this.fillStyle, x, y, width, height});
    },
    arc(x, y, radius, start, end) {
      circles.push({x, y, radius, start, end});
      path.push(['arc', x, y, radius, start, end]);
    },
    fill() { fills.push({color: this.fillStyle, path: path.slice()}); },
  };
  const operatorStates = Object.fromEntries([1, 2, 3, 4].map(operator => [operator, {
    ar: 31,
    d1r: 12,
    d2r: 7,
    sl: 8,
    rr: 5,
    tl: 32,
    dt: 3,
  }]));
  const options = {
    canvas: {width: 600, height: 220},
    context,
    operatorNumbers: [1, 2, 3, 4],
    operatorStates,
    outputEnvelopeHistory: [0.001, 0.1, 0.3, 1],
    outputEnvelopeBaseScale: 0.2,
    outputEnvelopeHeldVoicePeak: 4,
    outputEnvelopeSilenceFloor: 0.01,
  };
  return {
    options, context, strokes, texts, fills, circles,
    operatorGuides: () => strokes.filter(stroke => colors.includes(stroke.color)),
  };
}

test('Synth keeps its four colored guides, output envelope normalization and labels', () => {
  const fixture = createFixture();
  drawEnvelopeGuide(fixture.options);
  assert.deepEqual(fixture.fills, [{color: '#10191a', x: 0, y: 0, width: 600, height: 220}]);
  assert.deepEqual(fixture.operatorGuides().map(stroke => [stroke.color, stroke.width]), [
    ['#f2c078', 2.6], ['#ff93bc', 2], ['#9dff9b', 2], ['#89b7ff', 2],
  ]);
  const output = fixture.strokes.find(stroke => stroke.color === '#7be0d6');
  assert.equal(output.width, 3);
  assert.equal(output.alpha, 0.95);
  assert.equal(output.path.length, 4);
  const normalized = [0, 0.25, 0.75, 1];
  for (const [index, [, x, y]] of output.path.entries()) {
    assert.equal(x, 22 + 560 * index / 3);
    assert.ok(Math.abs(y - (200 - normalized[index] * 184 * 0.94)) < 1e-10);
  }
  assert.equal(fixture.context.globalAlpha, 1);
  assert.deepEqual(fixture.texts.map(({text}) => text), [
    'attack', 'hold', 'release',
    'Cyan: main envelope. Orange/Pink/Green/Blue: OP1-OP4 guides.',
  ]);
});

test('guide-only view shares the Synth operator curves without output data or cyan claims', () => {
  const synth = createFixture();
  const guide = createFixture();
  drawEnvelopeGuide(synth.options);
  // Even if the caller happens to have output history, guide-only never uses it.
  Object.defineProperty(guide.options, 'outputEnvelopeHistory', {
    get() { throw new Error('guide-only must not inspect audio data'); },
  });
  drawOperatorEnvelopeGuides(guide.options);
  assert.deepEqual(guide.operatorGuides(), synth.operatorGuides());
  assert.equal(guide.operatorGuides().length, 4);
  assert.ok(!guide.strokes.some(stroke => stroke.color === '#7be0d6'));
  assert.deepEqual(guide.texts.map(({text}) => text), ['Level', 'Time →']);
  assert.ok(!guide.texts.some(({text}) => /cyan|main envelope/i.test(text)));
  for (const stroke of guide.operatorGuides()) {
    assert.equal(stroke.path.length, 6);
    assert.ok(stroke.path.every(([, x, y]) => Number.isFinite(x) && Number.isFinite(y)));
  }
});

for (const [parameter, value, point, coordinate] of [
  ['ar', 0, 1, 1],
  ['d1r', 31, 2, 1],
  ['d2r', 31, 3, 1],
  ['sl', 15, 3, 2],
  ['rr', 15, 4, 1],
  ['tl', 100, 1, 2],
]) {
  test(`guide-only ${parameter} edit updates its operator curve without altering the other three`, () => {
    const before = createFixture();
    const after = createFixture();
    after.options.operatorStates[2][parameter] = value;
    drawOperatorEnvelopeGuides(before.options);
    drawOperatorEnvelopeGuides(after.options);
    const oldGuides = before.operatorGuides();
    const newGuides = after.operatorGuides();
    assert.notEqual(newGuides[1].path[point][coordinate], oldGuides[1].path[point][coordinate]);
    for (const index of [0, 2, 3]) {
      assert.deepEqual(newGuides[index], oldGuides[index]);
    }
  });
}

test('guide-only defaults to OP1–4, respects a chosen subset and leaves settings untouched', () => {
  const fixture = createFixture();
  const original = structuredClone(fixture.options.operatorStates);
  for (const settings of Object.values(fixture.options.operatorStates)) Object.freeze(settings);
  Object.freeze(fixture.options.operatorStates);
  delete fixture.options.operatorNumbers;
  drawOperatorEnvelopeGuides(fixture.options);
  assert.equal(fixture.operatorGuides().length, 4);
  assert.deepEqual(fixture.options.operatorStates, original);

  const subset = createFixture();
  subset.options.operatorNumbers = [2, 4];
  drawOperatorEnvelopeGuides(subset.options);
  assert.deepEqual(subset.operatorGuides().map(stroke => stroke.color), [colors[1], colors[3]]);
});

test('Synth can render its original guide without an output history snapshot yet', () => {
  const fixture = createFixture();
  delete fixture.options.outputEnvelopeHistory;
  drawEnvelopeGuide(fixture.options);
  assert.equal(fixture.operatorGuides().length, 4);
  assert.ok(!fixture.strokes.some(stroke => stroke.color === '#7be0d6'));
  assert.ok(fixture.texts.some(({text}) => text.startsWith('Cyan: main envelope.')));
});

const limits = {ar: 31, d1r: 31, d2r: 31, rr: 15, tl: 127, sl: 15};

function geometryFor(settings, dimensions = {}) {
  return getOperatorEnvelopeGeometry({width: 600, height: 220, settings, ...dimensions});
}

function patchAt(settings, handle, point, dimensions = {}) {
  return operatorEnvelopePatchFromPoint({
    width: 600, height: 220, settings, handle, ...point, ...dimensions,
  });
}

function assertGeometryAndRoundTrips(settings) {
  const geometry = geometryFor(settings);
  assert.ok(geometry);
  assert.deepEqual(geometry.handles.map(({id, params}) => ({id, params})), [
    {id: 'attack', params: ['ar', 'tl']},
    {id: 'decay', params: ['d1r', 'sl']},
    {id: 'sustain', params: ['d2r']},
    {id: 'release', params: ['rr']},
  ]);
  for (const [index, point] of geometry.points.entries()) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    assert.ok(point.x >= geometry.layout.left && point.x <= geometry.layout.right);
    assert.ok(point.y >= geometry.layout.top - 1e-12 && point.y <= geometry.layout.bottom + 1e-12);
    if (index > 0) assert.ok(point.x > geometry.points[index - 1].x);
  }
  for (const handle of geometry.handles) {
    const patch = patchAt(settings, handle.id, handle);
    assert.deepEqual(Object.keys(patch), handle.params);
    for (const parameter of handle.params) assert.equal(patch[parameter], settings[parameter]);
  }
}

test('editable guides round-trip every valid integer register value through its handle', () => {
  const base = createFixture().options.operatorStates[1];
  for (const [parameter, maximum] of Object.entries(limits)) {
    for (let value = 0; value <= maximum; value++) {
      assertGeometryAndRoundTrips({...base, [parameter]: value});
    }
  }
});

test('all zero/max register combinations stay finite with independently editable ordered stages', () => {
  const parameters = Object.keys(limits);
  for (let bits = 0; bits < 2 ** parameters.length; bits++) {
    const settings = Object.fromEntries(parameters.map((parameter, index) => [
      parameter, bits & (1 << index) ? limits[parameter] : 0,
    ]));
    assertGeometryAndRoundTrips(settings);
  }
});

test('dragging past the canvas clamps every editable parameter without adding unrelated fields', () => {
  const settings = createFixture().options.operatorStates[1];
  const negative = {x: -1000, y: -1000};
  const positive = {x: 2000, y: 2000};
  assert.deepEqual(patchAt(settings, 'attack', negative), {ar: 31, tl: 0});
  assert.deepEqual(patchAt(settings, 'attack', positive), {ar: 0, tl: 127});
  assert.deepEqual(patchAt(settings, 'decay', negative), {d1r: 31, sl: 0});
  assert.deepEqual(patchAt(settings, 'decay', positive), {d1r: 0, sl: 15});
  assert.deepEqual(patchAt(settings, 'sustain', negative), {d2r: 31});
  assert.deepEqual(patchAt(settings, 'sustain', positive), {d2r: 0});
  assert.deepEqual(patchAt(settings, 'release', negative), {rr: 15});
  assert.deepEqual(patchAt(settings, 'release', positive), {rr: 0});
});

test('fractional or out-of-range finite settings are quantized and clamped without mutating input', () => {
  const settings = {ar: 500, d1r: 11.7, d2r: -0.5, rr: -10, tl: 500, sl: 7.4};
  const original = {...settings};
  const geometry = geometryFor(Object.freeze(settings));
  const combined = Object.assign({}, ...geometry.handles.map(handle => patchAt(settings, handle.id, handle)));
  assert.deepEqual(combined, {ar: 31, tl: 127, d1r: 12, sl: 7, d2r: 0, rr: 0});
  assert.deepEqual(settings, original);
});

test('invalid dimensions, register values, coordinates or handle names produce no patch', () => {
  const base = createFixture().options.operatorStates[1];
  for (const dimensions of [
    {width: NaN}, {height: Infinity}, {width: -1}, {width: 40}, {height: 36},
  ]) {
    assert.equal(geometryFor(base, dimensions), null);
    assert.equal(patchAt(base, 'attack', {x: 100, y: 100}, dimensions), null);
  }
  for (const parameter of Object.keys(limits)) {
    for (const invalid of [NaN, Infinity, -Infinity, '7', undefined]) {
      const settings = {...base, [parameter]: invalid};
      assert.equal(geometryFor(settings), null);
      assert.equal(patchAt(settings, 'attack', {x: 100, y: 100}), null);
    }
  }
  for (const point of [{x: NaN, y: 100}, {x: 100, y: Infinity}]) {
    assert.equal(patchAt(base, 'attack', point), null);
  }
  for (const handle of ['', 'unknown', '__proto__', 'constructor']) {
    assert.equal(patchAt(base, handle, {x: 100, y: 100}), null);
  }
});

test('D2R zero holds the sustain level while a positive rate draws a descending sustain segment', () => {
  const base = createFixture().options.operatorStates[1];
  const held = geometryFor({...base, d2r: 0});
  const decaying = geometryFor({...base, d2r: 1});
  assert.equal(held.handles[2].y, held.handles[1].y);
  assert.ok(decaying.handles[2].y > decaying.handles[1].y);
  assert.ok(decaying.handles[2].x < held.handles[2].x);
});

test('editable view renders all operators with the selected curve and its four handles on top', () => {
  const fixture = createFixture();
  drawOperatorEnvelopeGuides({...fixture.options, editable: true, selectedOperator: 2});
  const guides = fixture.operatorGuides();
  assert.deepEqual(guides.map(({color}) => color), [colors[0], colors[2], colors[3], colors[1]]);
  assert.deepEqual(guides.map(({alpha}) => alpha), [0.4, 0.4, 0.4, 1]);
  assert.equal(guides[3].width, 2.6);
  const geometry = geometryFor(fixture.options.operatorStates[2]);
  assert.deepEqual(fixture.circles.map(({x, y}) => ({x, y})), geometry.handles.map(({x, y}) => ({x, y})));
  assert.ok(fixture.circles.every(({radius}) => radius === 5));
  assert.equal(fixture.context.globalAlpha, 1);
  assert.deepEqual(fixture.texts.map(({text}) => text), ['Level', 'Time →', 'AR / TL', 'D1R / SL', 'D2R', 'RR']);
  assert.ok(!fixture.strokes.some(stroke => stroke.color === '#7be0d6'));
});

test('changing the editable selected operator moves only its selection styling and handle coordinates', () => {
  const first = createFixture();
  const fourth = createFixture();
  for (const fixture of [first, fourth]) fixture.options.operatorStates[4].tl = 110;
  drawOperatorEnvelopeGuides({...first.options, editable: true, selectedOperator: 1});
  drawOperatorEnvelopeGuides({...fourth.options, editable: true, selectedOperator: 4});
  const byColor = fixture => Object.fromEntries(fixture.operatorGuides().map(stroke => [stroke.color, stroke.path]));
  assert.deepEqual(byColor(first), byColor(fourth));
  assert.notEqual(first.circles[0].y, fourth.circles[0].y);
  assert.equal(fourth.operatorGuides().at(-1).color, colors[3]);
});

test('editable envelopes overlay the live chip RMS with the existing scale and keep handles on top', () => {
  const original = createFixture();
  const editable = createFixture();
  const before = structuredClone(editable.options.operatorStates);
  drawEnvelopeGuide(original.options);
  drawOperatorEnvelopeGuides({
    ...editable.options,
    editable: true,
    selectedOperator: 2,
    outputEnvelope: {
      history: editable.options.outputEnvelopeHistory,
      heldVoicePeak: editable.options.outputEnvelopeHeldVoicePeak,
      silenceFloor: editable.options.outputEnvelopeSilenceFloor,
      baseScale: editable.options.outputEnvelopeBaseScale,
    },
  });
  const expectedTrace = original.strokes.find(stroke => stroke.color === '#7be0d6');
  const traceIndex = editable.strokes.findIndex(stroke => stroke.color === '#7be0d6');
  assert.ok(traceIndex >= 0);
  assert.deepEqual(editable.strokes[traceIndex], expectedTrace);
  const handleIndices = editable.strokes.flatMap((stroke, index) =>
    stroke.path.some(([kind]) => kind === 'arc') ? [index] : []);
  assert.equal(handleIndices.length, 4);
  assert.ok(handleIndices.every(index => index > traceIndex));
  assert.deepEqual(editable.options.operatorStates, before);
  assert.equal(editable.context.globalAlpha, 1);
});

test('live RMS changes redraw the trace without changing the editable operator geometry', () => {
  const quiet = createFixture();
  const loud = createFixture();
  for (const [fixture, history] of [[quiet, [0, 0.01, 0]], [loud, [0, 0.3, 0]]]) {
    drawOperatorEnvelopeGuides({
      ...fixture.options,
      editable: true,
      selectedOperator: 4,
      outputEnvelope: {history, heldVoicePeak: 1, silenceFloor: 0.01, baseScale: 0.2},
    });
  }
  const trace = fixture => fixture.strokes.find(stroke => stroke.color === '#7be0d6');
  assert.notDeepEqual(trace(quiet).path, trace(loud).path);
  assert.deepEqual(quiet.operatorGuides(), loud.operatorGuides());
  assert.deepEqual(quiet.circles, loud.circles);
});

test('guide-only mode does not inspect an optional live-output snapshot', () => {
  const fixture = createFixture();
  const outputEnvelope = {};
  Object.defineProperty(outputEnvelope, 'history', {
    get() { throw new Error('guide-only mode must not read output history'); },
  });
  drawOperatorEnvelopeGuides({...fixture.options, outputEnvelope});
  assert.ok(!fixture.strokes.some(stroke => stroke.color === '#7be0d6'));
});
