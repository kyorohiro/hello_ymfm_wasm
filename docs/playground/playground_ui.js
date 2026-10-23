/** Use the full editor layout; keep the compact lesson iframe mode intact. */
export function applyPlaygroundLayout({
  body,
  mainMenu,
  toolbar,
  statusBar,
  simpleMode = false,
}) {
  body.classList.toggle("mode-expanded", !simpleMode);
  if (simpleMode) return;
  if (toolbar && mainMenu) toolbar.prepend(mainMenu);
  if (toolbar && statusBar) toolbar.after(statusBar);
}

export function createPlaygroundUi(
  options
) {
  const {
    status,
    runtimeState,
    consoleOutput,
    codeTab,
    fxMonitorTab,
    fxMonitorPanel,
    audioMonitorTab,
    audioMonitorPanel,
    consoleTab,
    shellTab,
    shellPanel,
    helpersTab,
    operatorTabButton,
    keyboardTab,
    consolePanel,
    codePanel,
    helpersPanel,
    operatorPanel,
    keyboardPanel,
  } = options;

  function setStatus(message) {
    status.textContent = message;
  }

  function setRuntimeState(message) {
    runtimeState.textContent = message;
  }

  function logLine(message) {
    consoleOutput.textContent += `${message}\n`;
    consoleOutput.scrollTop =
      consoleOutput.scrollHeight;
  }

  function clearConsole() {
    consoleOutput.textContent = "";
  }

  function formatLogArgs(args) {
    return args
      .map((value) => formatLogValue(value))
      .join(" ");
  }

  function formatLogValue(value) {
    if (typeof value === "string") {
      return value;
    }
    if (value instanceof ArrayBuffer) {
      return formatBinaryLogValue(
        new Uint8Array(value),
        "ArrayBuffer"
      );
    }
    if (ArrayBuffer.isView(value)) {
      return formatBinaryLogValue(
        new Uint8Array(
          value.buffer,
          value.byteOffset,
          value.byteLength
        ),
        value.constructor.name
      );
    }
    return JSON.stringify(value);
  }

  function formatBinaryLogValue(bytes, label) {
    const preview = Array.from(
      bytes.subarray(0, 16),
      (value) => value.toString(16).padStart(2, "0")
    ).join(" ");
    const suffix = bytes.byteLength > 16 ? " ..." : "";
    return `${label}(${bytes.byteLength}) [${preview}${suffix}]`;
  }

  const bottomTabs = [
    {
      name: "code",
      button: codeTab,
      panel: codePanel,
    },
    {name: "audio", button: audioMonitorTab, panel: audioMonitorPanel},
    {
      name: "fxMonitor",
      button: fxMonitorTab,
      panel: fxMonitorPanel,
    },
    {name: 'mixer', button: options.mixerTab, panel: options.mixerPanel},
    {
      name: "console",
      button: consoleTab,
      panel: consolePanel,
    },
    {name: "shell", button: shellTab, panel: shellPanel},
    {
      name: "operator",
      button: operatorTabButton,
      panel: operatorPanel,
    },
    ...['segapsg', 'rf5c164', 'pwm', 'gameboy', 'nes', 'ym2151', 'okim6258', 'huc6280', 'dx7', 'ym3812', 'ym3526', 'y8950', 'ymf262', 'ym2413', 'ay8910'].map(name => ({name, button: options[`${name}Tab`], panel: options[`${name}Panel`]})),
    {
      name: "keyboard",
      button: keyboardTab,
      panel: keyboardPanel,
    },
    {
      name: "helpers",
      button: helpersTab,
      panel: helpersPanel,
    },
  ];

  const chipTabNames = new Set(['operator', 'segapsg', 'rf5c164', 'pwm', 'gameboy', 'nes', 'ym2151', 'okim6258', 'huc6280', 'dx7', 'ym3812', 'ym3526', 'y8950', 'ymf262', 'ym2413', 'ay8910']);
  const auditionTabNames = new Set([...chipTabNames].filter(name => name !== 'pwm'));
  const visibleChipTabs = new Set(options.chipTabs ?? chipTabNames);
  for (const tab of bottomTabs) {
    tab.available = (!chipTabNames.has(tab.name) || visibleChipTabs.has(tab.name)) &&
      !(tab.name === 'keyboard' && options.fmKeyboard === false);
    if ((chipTabNames.has(tab.name) || tab.name === 'keyboard') && tab.button) tab.button.hidden = !tab.available;
    if (!tab.available && tab.panel) tab.panel.hidden = true;
  }

  const auxiliaryTabs = new Set(["audio", "fxMonitor", "console", "shell", "keyboard", "helpers", "mixer"]);
  let primaryTab = "code";
  let bottomTab = bottomTabs.some(tab => tab.name === options.initialBottomTab && tab.available)
    ? options.initialBottomTab : "console";
  let dockOpen = options.initialDockOpen ?? true;

  function setBottomTab(tabName) {
    if (bottomTabs.find(tab => tab.name === tabName)?.available === false) return;
    if (options.dockedPanels) {
      if (auxiliaryTabs.has(tabName)) { bottomTab = tabName; dockOpen = true; }
      else primaryTab = tabName;
    } else bottomTab = tabName;
    const auditionTab = options.dockedPanels ? primaryTab : tabName;
    const dockKeyboard = options.dockedPanels && dockOpen && bottomTab === 'keyboard';
    const floatingKeyboard = options.fmKeyboard !== false && auditionTabNames.has(auditionTab) && !dockKeyboard;
    const keyboardVisible = options.fmKeyboard !== false &&
      (floatingKeyboard || dockKeyboard || (!options.dockedPanels && tabName === 'keyboard'));
    // The full workbench places the shared controls in the dock or overlay.
    // Compact layouts keep their existing DOM and only change its placement.
    if (!options.dockedPanels) {
      keyboardPanel?.classList?.toggle('is-floating-keyboard', floatingKeyboard);
      for (const tab of bottomTabs) {
        if (chipTabNames.has(tab.name)) tab.panel?.classList?.toggle('has-floating-keyboard', floatingKeyboard && tab.name === auditionTab);
      }
    }
    for (const tab of bottomTabs) {
      const isSelected = tab.available && (
        options.dockedPanels
          ? tab.name === (auxiliaryTabs.has(tab.name) ? bottomTab : primaryTab)
          : tab.name === tabName);
      tab.button?.setAttribute(
        "aria-selected",
        isSelected ? "true" : "false"
      );
      if (tab.panel) {
        tab.panel.hidden = tab.name === "keyboard"
          ? !keyboardVisible
          : (options.dockedPanels && auxiliaryTabs.has(tab.name) && !dockOpen) || !isSelected;
      }
    }
    options.onBottomTabChange?.(tabName, options.dockedPanels ? {primaryTab, bottomTab, dockOpen} : null);
  }

  function setDockVisible(value) {
    dockOpen = Boolean(value);
    setBottomTab(primaryTab);
  }

  function moveBottomTabFocus(
    activeTab,
    direction
  ) {
    const activeName = bottomTabs.find(tab => tab.button === activeTab)?.name;
    const tabs = bottomTabs.filter(
      (tab) => tab.available && Boolean(tab.button) && !tab.button.hidden &&
        (!options.dockedPanels || auxiliaryTabs.has(tab.name) === auxiliaryTabs.has(activeName))
    );
    const currentIndex = tabs.findIndex(
      (tab) => tab.button === activeTab
    );

    if (currentIndex === -1) {
      return;
    }

    const nextIndex =
      (currentIndex +
        direction +
        tabs.length) %
      tabs.length;
    tabs[nextIndex]?.button?.focus();
    setBottomTab(tabs[nextIndex].name);
  }

  function installBottomTabHandlers() {
    // Include initially unavailable chip tabs: added sources can reveal them.
    for (const { name, button } of bottomTabs) {
      const tabButton = button;
      tabButton?.addEventListener(
        "click",
        () => {
          setBottomTab(name);
        }
      );
      tabButton?.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            moveBottomTabFocus(
              tabButton,
              1
            );
          }

          if (event.key === "ArrowLeft") {
            event.preventDefault();
            moveBottomTabFocus(
              tabButton,
              -1
            );
          }
        }
      );
    }
  }

  return {
    setStatus,
    setRuntimeState,
    logLine,
    clearConsole,
    formatLogArgs,
    setBottomTab,
    setDockVisible,
    moveBottomTabFocus,
    installBottomTabHandlers,
    setChipTabAvailable(name, available) {
      const tab = bottomTabs.find(tab => tab.name === name);
      if (!tab || !chipTabNames.has(name) || tab.available === Boolean(available)) return;
      tab.available = Boolean(available);
      if (tab.button) tab.button.hidden = !tab.available;
      if (!tab.available && tab.panel) tab.panel.hidden = true;
      if (!tab.available && (primaryTab === name || !options.dockedPanels && bottomTab === name)) setBottomTab('code');
    },
  };
}
