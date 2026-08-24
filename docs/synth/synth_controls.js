function clampValue(value, min, max) {
  return Math.min(
    max,
    Math.max(min, value)
  );
}

export function createParamControl(config) {
  const {
    label,
    min,
    max,
    step,
    value,
    onChange,
    showLabel = true,
    booleanMode = false,
  } = config;

  const wrapper =
    document.createElement("div");
  wrapper.className = "param-control";
  if (!showLabel) {
    wrapper.classList.add("no-label");
  }

  const labelElement =
    document.createElement("div");
  labelElement.className = "param-label";
  labelElement.textContent = label;

  const minusButton =
    document.createElement("button");
  minusButton.type = "button";
  minusButton.className = "param-button";
  minusButton.textContent = "-";

  const valueElement =
    document.createElement("button");
  valueElement.type = "button";
  valueElement.className = "param-value";
  valueElement.setAttribute(
    "aria-label",
    label
  );

  const plusButton =
    document.createElement("button");
  plusButton.type = "button";
  plusButton.className = "param-button";
  plusButton.textContent = "+";

  const updateVisual =
    (nextValue) => {
      if (booleanMode) {
        valueElement.textContent =
          nextValue ? "1" : "0";
        return;
      }
      valueElement.textContent =
        String(nextValue);
    };

  let currentValue = value;
  let dragStartX = 0;
  let dragStartValue = value;
  const valueRange =
    Math.max(step, max - min);
  const dragPixelsForFullRange = 160;

  const applyValue =
    (nextValue) => {
      currentValue = booleanMode
        ? Boolean(nextValue)
        : clampValue(
            nextValue,
            min,
            max
          );
      updateVisual(currentValue);
      onChange(currentValue);
    };

  minusButton.addEventListener(
    "click",
    () => {
      if (booleanMode) {
        applyValue(false);
        return;
      }
      applyValue(currentValue - step);
    }
  );

  plusButton.addEventListener(
    "click",
    () => {
      if (booleanMode) {
        applyValue(true);
        return;
      }
      applyValue(currentValue + step);
    }
  );

  valueElement.addEventListener(
    "pointerdown",
    (event) => {
      if (booleanMode) {
        applyValue(!currentValue);
        return;
      }
      dragStartX = event.clientX;
      dragStartValue = currentValue;
      valueElement.classList.add(
        "is-dragging"
      );
      valueElement.setPointerCapture(
        event.pointerId
      );
    }
  );

  valueElement.addEventListener(
    "pointermove",
    (event) => {
      if (booleanMode) {
        return;
      }
      if (
        valueElement.hasPointerCapture(
          event.pointerId
        ) === false
      ) {
        return;
      }

      const deltaX =
        event.clientX - dragStartX;
      const deltaSteps =
        Math.round(
          (deltaX / dragPixelsForFullRange) *
          (valueRange / step)
        );

      applyValue(
        dragStartValue +
        deltaSteps * step
      );
    }
  );

  const endDrag =
    (event) => {
      if (
        valueElement.hasPointerCapture(
          event.pointerId
        )
      ) {
        valueElement.releasePointerCapture(
          event.pointerId
        );
      }
      valueElement.classList.remove(
        "is-dragging"
      );
    };

  valueElement.addEventListener(
    "pointerup",
    endDrag
  );
  valueElement.addEventListener(
    "pointercancel",
    endDrag
  );

  wrapper.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (booleanMode) {
        applyValue(event.deltaY < 0);
        return;
      }
      const direction =
        event.deltaY < 0
          ? step
          : -step;
      applyValue(currentValue + direction);
    },
    { passive: false }
  );

  if (showLabel) {
    wrapper.appendChild(labelElement);
  }
  wrapper.appendChild(minusButton);
  wrapper.appendChild(valueElement);
  wrapper.appendChild(plusButton);

  updateVisual(value);

  return {
    element: wrapper,
    updateVisual,
  };
}

export function buildHeader(
  root,
  defs
) {
  if (!root) {
    return;
  }

  root.innerHTML = "";
  root.style.display = "grid";
  root.style.gridTemplateColumns = `repeat(${defs.length}, minmax(0, 1fr))`;

  for (const config of defs) {
    const cell =
      document.createElement("div");
    cell.className =
      "operator-header-cell";
    cell.textContent =
      config.label;
    root.appendChild(cell);
  }
}

export function buildCommonControls({
  root,
  defs,
  state,
  controlsMap,
  onChange,
  stackedLabels = false,
  referenceColumnCount = defs.length,
  gapPx = 4,
}) {
  root.innerHTML = "";
  root.style.display = "grid";
  root.style.gridTemplateColumns = `repeat(${referenceColumnCount}, minmax(0, 1fr))`;
  root.style.gap = `${gapPx}px`;
  root.style.justifyContent = "";
  root.style.width = "";

  for (let index = 0; index < defs.length; index += 1) {
    const config = defs[index];
    const control =
      createParamControl({
        ...config,
        showLabel: false,
        value: state[config.id],
        onChange: (nextValue) => {
          onChange(config.id, nextValue);
        },
      });

    controlsMap.set(
      config.id,
      control
    );

    if (!stackedLabels) {
      root.appendChild(
        control.element
      );
      continue;
    }

    const cell =
      document.createElement("div");
    cell.className =
      "common-control-cell";

    const label =
      document.createElement("div");
    label.className =
      "common-control-label";
    label.textContent =
      config.label;

    cell.appendChild(label);
    cell.appendChild(control.element);
    cell.style.gridColumn = String(index + 1);
    root.appendChild(cell);
  }
}

export function buildOperatorControls({
  root,
  operatorNumbers,
  defs,
  operatorStates,
  controlsMap,
  onChange,
}) {
  root.innerHTML = "";

  for (const operator of operatorNumbers) {
    const row =
      document.createElement("div");
    row.className =
      "operator-row";

    const name =
      document.createElement("div");
    name.className =
      `operator-name op-color-${operator}`;
    name.textContent =
      `OP${operator}`;

    const strip =
      document.createElement("div");
    strip.className = "param-strip";
    strip.style.display = "grid";
    strip.style.gridTemplateColumns = `repeat(${defs.length}, minmax(0, 1fr))`;
    strip.style.gap = "4px";

    const rowControls =
      new Map();

    for (const config of defs) {
      const control =
        createParamControl({
          ...config,
          showLabel: false,
          value:
            operatorStates[operator][
              config.id
            ],
          onChange: (nextValue) => {
            onChange(
              operator,
              config.id,
              nextValue
            );
          },
        });

      rowControls.set(
        config.id,
        control
      );

      strip.appendChild(
        control.element
      );
    }

    controlsMap.set(
      operator,
      rowControls
    );

    row.appendChild(name);
    row.appendChild(strip);
    root.appendChild(row);
  }
}
