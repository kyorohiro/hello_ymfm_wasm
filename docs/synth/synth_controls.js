function clampValue(value, min, max) {
  return Math.min(
    max,
    Math.max(min, value)
  );
}

/**
 * Convert a display operator number (1..4) to the synth API's
 * logical operator number (0..3).
 */
export function displayOperatorToApiOperator(
  operator
) {
  return operator - 1;
}

/**
 * Convert the synth API's logical operator number (0..3) to a
 * display operator number (1..4).
 */
export function apiOperatorToDisplayOperator(
  operator
) {
  return operator + 1;
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
    category = "",
  } = config;

  const wrapper =
    document.createElement("div");
  wrapper.className = "param-control";
  if (category) {
    wrapper.classList.add(
      `param-category-${category}`
    );
  }
  if (!showLabel) {
    wrapper.classList.add("no-label");
  }
  if (booleanMode) {
    wrapper.classList.add("is-boolean");
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
          nextValue ? "ON" : "OFF";
        valueElement.classList.toggle(
          "is-on",
          Boolean(nextValue)
        );
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

  if (!booleanMode) {
    minusButton.addEventListener(
      "click",
      () => {
        applyValue(currentValue - step);
      }
    );

    plusButton.addEventListener(
      "click",
      () => {
        applyValue(currentValue + step);
      }
    );
  }

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
        applyValue(!currentValue);
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
  if (!booleanMode) {
    wrapper.appendChild(minusButton);
  }
  wrapper.appendChild(valueElement);
  if (!booleanMode) {
    wrapper.appendChild(plusButton);
  }

  updateVisual(value);

  return {
    element: wrapper,
    updateVisual,
  };
}

export function buildHeader(
  root,
  defs,
  options = {}
) {
  const { onHelpToggle } = options;
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
    if (config.category) {
      cell.classList.add(
        `param-label-category-${config.category}`
      );
    }
    const labelText =
      document.createElement("span");
    labelText.textContent =
      config.label;
    cell.appendChild(labelText);

    if (
      typeof onHelpToggle ===
        "function" &&
      config.help
    ) {
      cell.classList.add("param-helpable");
      cell.tabIndex = 0;
      cell.setAttribute(
        "role",
        "button"
      );
      cell.setAttribute(
        "aria-label",
        `Show help for ${config.label}`
      );
      cell.addEventListener(
        "click",
        () => {
          onHelpToggle(config);
        }
      );
      cell.addEventListener(
        "keydown",
        (event) => {
          if (
            event.key === "Enter" ||
            event.key === " "
          ) {
            event.preventDefault();
            onHelpToggle(config);
          }
        }
      );
    }

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
  onHelpToggle = null,
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
    if (config.category) {
      label.classList.add(
        `param-label-category-${config.category}`
      );
    }
    const labelText =
      document.createElement("span");
    labelText.textContent =
      config.label;
    label.appendChild(labelText);

    if (
      typeof onHelpToggle ===
        "function" &&
      config.help
    ) {
      label.classList.add("param-helpable");
      label.tabIndex = 0;
      label.setAttribute(
        "role",
        "button"
      );
      label.setAttribute(
        "aria-label",
        `Show help for ${config.label}`
      );
      label.addEventListener(
        "click",
        () => {
          onHelpToggle(config);
        }
      );
      label.addEventListener(
        "keydown",
        (event) => {
          if (
            event.key === "Enter" ||
            event.key === " "
          ) {
            event.preventDefault();
            onHelpToggle(config);
          }
        }
      );
    }

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
      String(operator);

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
