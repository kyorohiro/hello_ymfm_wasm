function clearCanvas(
  context,
  canvas
) {
  context.fillStyle = "#10191a";
  context.fillRect(
    0,
    0,
    canvas.width,
    canvas.height
  );
}

function buildNormalizedHistory(
  history,
  scale,
  silenceFloor
) {
  if (history.length < 2) {
    return [];
  }

  return history.map((value) => {
    if (value < silenceFloor) {
      return 0;
    }

    return Math.min(
      1,
      value / scale
    );
  });
}

function currentEnvelopeScale(
  baseScale,
  heldVoicePeak
) {
  if (heldVoicePeak <= 1) {
    return baseScale;
  }

  // Hold the largest simultaneous voice count seen in the current run.
  // Do not shrink the scale again just because some notes were released.
  return (
    baseScale *
    Math.sqrt(heldVoicePeak)
  );
}

function drawOutputEnvelopeOverlay(
  context,
  points,
  layout,
  style = {}
) {
  if (!points || points.length < 2) {
    return;
  }

  context.strokeStyle =
    style.color ??
    "#7be0d6";
  context.lineWidth =
    style.lineWidth ?? 2;
  if (style.alpha !== undefined) {
    context.globalAlpha =
      style.alpha;
  }
  context.beginPath();

  for (
    let index = 0;
    index < points.length;
    index += 1
  ) {
    const x =
      layout.left +
      (layout.innerWidth * index) /
        (points.length - 1);
    const y =
      layout.bottom -
      points[index] *
        layout.innerHeight *
        0.94;

    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }

  context.stroke();
  context.globalAlpha = 1;
}

function drawOperatorGuide(
  context,
  layout,
  settings,
  style
) {
  const attackPortion =
    0.06 +
    ((31 - settings.ar) / 31) * 0.22;
  const decayPortion =
    0.08 +
    ((31 - settings.d1r) / 31) * 0.16;
  const sustainPortion =
    0.16 +
    ((31 - settings.d2r) / 31) * 0.18;
  const releasePortion =
    0.10 +
    ((15 - settings.rr) / 15) * 0.20;
  const tailPortion = Math.max(
    0.08,
    1 -
      (attackPortion +
        decayPortion +
        sustainPortion +
        releasePortion)
  );

  const x0 = layout.left;
  const x1 =
    layout.left +
    layout.innerWidth * attackPortion;
  const x2 =
    x1 +
    layout.innerWidth * decayPortion;
  const x3 =
    x2 +
    layout.innerWidth * sustainPortion;
  const x4 =
    x3 +
    layout.innerWidth * tailPortion;
  const x5 = layout.right;

  const intensity =
    1 -
    (settings.tl / 127) * 0.75 -
    (settings.dt / 7) * 0.04;
  const peakLevel =
    0.08 +
    (1 - intensity) * 0.12 +
    style.verticalBias;
  const decayLevel = Math.min(
    0.90,
    peakLevel +
      0.12 +
      (settings.d1r / 31) * 0.18 +
      style.verticalBias
  );
  const sustainLevel = Math.max(
    decayLevel,
    0.10 +
      (settings.sl / 15) * 0.70 +
      (settings.d2r / 31) * 0.04 +
      style.verticalBias
  );
  const tailLevel = Math.min(
    0.94,
    sustainLevel +
      0.04 +
      (settings.rr / 15) * 0.04
  );
  const peakY =
    layout.top +
    layout.innerHeight * peakLevel;
  const decayY =
    layout.top +
    layout.innerHeight * decayLevel;
  const sustainY =
    layout.top +
    layout.innerHeight * sustainLevel;
  const tailY =
    layout.top +
    layout.innerHeight * tailLevel;

  context.strokeStyle =
    style.color;
  context.lineWidth =
    style.lineWidth;
  context.beginPath();
  context.moveTo(
    x0,
    layout.bottom
  );
  context.lineTo(x1, peakY);
  context.lineTo(x2, decayY);
  context.lineTo(x3, sustainY);
  context.lineTo(x4, tailY);
  context.lineTo(
    x5,
    layout.bottom
  );
  context.stroke();
}

function drawEnvelopeGuideCanvas({
  canvas,
  context,
  operatorNumbers,
  operatorStates,
  outputEnvelopeHistory = [],
  outputEnvelopeHeldVoicePeak,
  outputEnvelopeSilenceFloor,
  outputEnvelopeBaseScale,
}, showOutputEnvelope) {
  clearCanvas(context, canvas);

  const width = canvas.width;
  const height = canvas.height;
  const left = 22;
  const right = width - 18;
  const top = 16;
  const bottom = height - 20;
  const innerWidth = right - left;
  const innerHeight = bottom - top;
  const layout = {
    left,
    right,
    top,
    bottom,
    innerWidth,
    innerHeight,
  };

  context.strokeStyle =
    "#514233";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(left, bottom);
  context.lineTo(right, bottom);
  context.moveTo(left, top);
  context.lineTo(left, bottom);
  context.stroke();

  for (let index = 1; index <= 4; index += 1) {
    const x =
      left +
      (innerWidth * index) / 5;
    context.strokeStyle =
      "rgba(214, 177, 132, 0.18)";
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, bottom);
    context.stroke();
  }

  const guideStyles = [
    {
      color: "#f2c078",
      lineWidth: 2.6,
      verticalBias: 0,
    },
    {
      color: "#ff93bc",
      lineWidth: 2,
      verticalBias: -0.015,
    },
    {
      color: "#9dff9b",
      lineWidth: 2,
      verticalBias: 0.015,
    },
    {
      color: "#89b7ff",
      lineWidth: 2,
      verticalBias: -0.03,
    },
  ];

  for (const operator of operatorNumbers) {
    drawOperatorGuide(
      context,
      layout,
      operatorStates[operator],
      guideStyles[operator - 1]
    );
  }

  if (showOutputEnvelope) {
    const normalizedHistory =
      buildNormalizedHistory(
        outputEnvelopeHistory,
        currentEnvelopeScale(
          outputEnvelopeBaseScale,
          outputEnvelopeHeldVoicePeak
        ),
        outputEnvelopeSilenceFloor
      );

    drawOutputEnvelopeOverlay(
      context,
      normalizedHistory,
      layout,
      {
        color: "#7be0d6",
        lineWidth: 3,
        alpha: 0.95,
      }
    );
  }

  if (!showOutputEnvelope) {
    context.fillStyle = "#b8cac6";
    context.font = "12px sans-serif";
    context.fillText("Level", left + 6, top + 12);
    context.fillText("Time →", right - 44, bottom - 8);
    return;
  }

  context.fillStyle =
    "#f6ead7";
  context.font =
    "13px sans-serif";
  context.fillText(
    "attack",
    left + 6,
    bottom - 8
  );
  context.fillText(
    "hold",
    left + innerWidth * 0.28,
    top + 18
  );
  context.fillText(
    "release",
    left + innerWidth * 0.72,
    top + 18
  );

  context.fillStyle =
    "#b8cac6";
  context.fillText(
    "Cyan: main envelope. Orange/Pink/Green/Blue: OP1-OP4 guides.",
    18,
    28
  );
}

export function drawEnvelopeGuide(options) {
  drawEnvelopeGuideCanvas(options, true);
}

const EDITABLE_GUIDE_STAGES = {
  attack: {min: 0.04, max: 0.24, rate: 'ar', maxRate: 31, params: ['ar', 'tl'], label: 'AR / TL'},
  decay: {min: 0.30, max: 0.48, rate: 'd1r', maxRate: 31, params: ['d1r', 'sl'], label: 'D1R / SL'},
  sustain: {min: 0.54, max: 0.72, rate: 'd2r', maxRate: 31, params: ['d2r'], label: 'D2R'},
  release: {min: 0.78, max: 0.96, rate: 'rr', maxRate: 15, params: ['rr'], label: 'RR'},
};
const EDITABLE_GUIDE_LIMITS = {ar: 31, d1r: 31, d2r: 31, rr: 15, tl: 127, sl: 15};
const EDITABLE_GUIDE_COLORS = ['#f2c078', '#ff93bc', '#9dff9b', '#89b7ff'];
const MINIMUM_GUIDE_PEAK = 0.08;

function quantizeGuideValue(value, maximum) {
  return Math.round(Math.max(0, Math.min(maximum, value)));
}

function normalizedGuideSettings(settings) {
  if (!settings) return null;
  const result = {};
  for (const [name, maximum] of Object.entries(EDITABLE_GUIDE_LIMITS)) {
    if (!Number.isFinite(settings[name])) return null;
    result[name] = quantizeGuideValue(settings[name], maximum);
  }
  return result;
}

function editableGuideLayout(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 40 || height <= 36) return null;
  return {
    left: 22,
    right: width - 18,
    top: 16,
    bottom: height - 20,
    innerWidth: width - 40,
    innerHeight: height - 36,
  };
}

// These are relative editing guides, not a simulation of chip EG timing or dB.
// Separate stage bands keep every rate editable, including its zero setting.
export function getOperatorEnvelopeGeometry({width, height, settings}) {
  const layout = editableGuideLayout(width, height);
  const values = normalizedGuideSettings(settings);
  if (!layout || !values) return null;
  const peak = 1 - (1 - MINIMUM_GUIDE_PEAK) * values.tl / 127;
  const sustain = peak * (1 - values.sl / 15);
  const tail = sustain * (1 - 0.8 * values.d2r / 31);
  const stageX = stage => layout.left + layout.innerWidth * (
    stage.min + (stage.max - stage.min) * (1 - values[stage.rate] / stage.maxRate)
  );
  const levelY = level => layout.bottom - layout.innerHeight * level;
  const levels = {attack: peak, decay: sustain, sustain: tail, release: 0};
  const handles = Object.entries(EDITABLE_GUIDE_STAGES).map(([id, stage]) => ({
    id,
    x: stageX(stage),
    y: levelY(levels[id]),
    params: stage.params.slice(),
  }));
  const points = [
    {x: layout.left, y: layout.bottom},
    ...handles.map(({x, y}) => ({x, y})),
    {x: layout.right, y: layout.bottom},
  ];
  return {layout, points, handles};
}

export function operatorEnvelopePatchFromPoint({width, height, settings, handle, x, y}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const geometry = getOperatorEnvelopeGeometry({width, height, settings});
  const stage = Object.hasOwn(EDITABLE_GUIDE_STAGES, handle) ? EDITABLE_GUIDE_STAGES[handle] : null;
  if (!geometry || !stage) return null;
  const {layout} = geometry;
  const position = ((x - layout.left) / layout.innerWidth - stage.min) / (stage.max - stage.min);
  const patch = {[stage.rate]: quantizeGuideValue((1 - position) * stage.maxRate, stage.maxRate)};
  if (handle === 'attack') {
    patch.tl = quantizeGuideValue((y - layout.top) / layout.innerHeight / (1 - MINIMUM_GUIDE_PEAK) * 127, 127);
  } else if (handle === 'decay') {
    const values = normalizedGuideSettings(settings);
    const peak = 1 - (1 - MINIMUM_GUIDE_PEAK) * values.tl / 127;
    const level = (layout.bottom - y) / layout.innerHeight;
    patch.sl = quantizeGuideValue((1 - level / peak) * 15, 15);
  }
  return patch;
}

function drawEditableOperatorEnvelopeGuides({canvas, context, operatorStates, operatorNumbers, selectedOperator, outputEnvelope}) {
  clearCanvas(context, canvas);
  const layout = editableGuideLayout(canvas.width, canvas.height);
  if (!layout) return;
  const {left, right, top, bottom, innerWidth} = layout;
  context.strokeStyle = '#514233';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(left, top);
  context.lineTo(left, bottom);
  context.lineTo(right, bottom);
  context.stroke();
  for (const position of [0.27, 0.51, 0.75]) {
    const x = left + innerWidth * position;
    context.strokeStyle = 'rgba(214, 177, 132, 0.18)';
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, bottom);
    context.stroke();
  }

  // Render the selected operator last so other guides never cover its handles.
  const order = operatorNumbers.filter(operator => operator !== selectedOperator);
  if (operatorNumbers.includes(selectedOperator)) order.push(selectedOperator);
  let selectedGeometry = null;
  for (const operator of order) {
    const geometry = getOperatorEnvelopeGeometry({
      width: canvas.width,
      height: canvas.height,
      settings: operatorStates[operator],
    });
    if (!geometry) continue;
    const selected = operator === selectedOperator;
    context.strokeStyle = EDITABLE_GUIDE_COLORS[operator - 1];
    context.lineWidth = selected ? 2.6 : 1.5;
    context.globalAlpha = selected ? 1 : 0.4;
    context.beginPath();
    geometry.points.forEach(({x, y}, index) => {
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    if (selected) selectedGeometry = geometry;
  }
  context.globalAlpha = 1;
  if (outputEnvelope) {
    const {
      history = [],
      heldVoicePeak,
      silenceFloor,
      baseScale,
    } = outputEnvelope;
    drawOutputEnvelopeOverlay(
      context,
      buildNormalizedHistory(history, currentEnvelopeScale(baseScale, heldVoicePeak), silenceFloor),
      layout,
      {color: '#7be0d6', lineWidth: 3, alpha: 0.95}
    );
  }
  // Keep the selected points above the live trace so they remain easy to find.
  if (selectedGeometry) {
    for (const {x, y} of selectedGeometry.handles) {
      context.beginPath();
      context.arc(x, y, 5, 0, Math.PI * 2);
      context.fillStyle = EDITABLE_GUIDE_COLORS[selectedOperator - 1];
      context.fill();
      context.strokeStyle = '#10191a';
      context.lineWidth = 2;
      context.stroke();
    }
  }
  context.fillStyle = '#b8cac6';
  context.font = '11px sans-serif';
  context.fillText('Level', left, top - 5);
  context.fillText('Time →', right - 44, top - 5);
  context.textAlign = 'center';
  for (const stage of Object.values(EDITABLE_GUIDE_STAGES)) {
    context.fillText(stage.label, left + innerWidth * (stage.min + stage.max) / 2, bottom + 15);
  }
  context.textAlign = 'start';
}

// Operator curves are conceptual register-value guides, not measured chip EG.
// An explicitly supplied output snapshot adds the measured chip RMS trace.
export function drawOperatorEnvelopeGuides({
  canvas,
  context,
  operatorStates,
  operatorNumbers = [1, 2, 3, 4],
  editable = false,
  selectedOperator = 1,
  outputEnvelope = null,
}) {
  if (editable) {
    drawEditableOperatorEnvelopeGuides({canvas, context, operatorStates, operatorNumbers, selectedOperator, outputEnvelope});
    return;
  }
  drawEnvelopeGuideCanvas({
    canvas,
    context,
    operatorStates,
    operatorNumbers,
  }, false);
}
