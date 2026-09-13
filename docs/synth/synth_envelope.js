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

export function drawEnvelopeGuide({
  canvas,
  context,
  operatorNumbers,
  operatorStates,
  outputEnvelopeHistory,
  outputEnvelopeHeldVoicePeak,
  outputEnvelopeSilenceFloor,
  outputEnvelopeBaseScale,
}) {
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
