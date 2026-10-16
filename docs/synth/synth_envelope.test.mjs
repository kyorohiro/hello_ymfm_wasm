import test from 'node:test';
import assert from 'node:assert/strict';
import {
  drawEnvelopeGuide,
  drawOperatorEnvelopeGuides,
} from './synth_envelope.js';

const colors = ['#f2c078', '#ff93bc', '#9dff9b', '#89b7ff'];

function createFixture() {
  const strokes = [];
  const texts = [];
  const fills = [];
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
    options, context, strokes, texts, fills,
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
