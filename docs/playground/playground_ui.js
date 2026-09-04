export function createPlaygroundUi(
  options
) {
  const {
    status,
    runtimeState,
    consoleOutput,
    codeTab,
    consoleTab,
    helpersTab,
    operatorTabButton,
    consolePanel,
    codePanel,
    helpersPanel,
    operatorPanel,
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
    {
      name: "console",
      button: consoleTab,
      panel: consolePanel,
    },
    {
      name: "operator",
      button: operatorTabButton,
      panel: operatorPanel,
    },
    {
      name: "helpers",
      button: helpersTab,
      panel: helpersPanel,
    },
  ];

  function setBottomTab(tabName) {
    for (const tab of bottomTabs) {
      const isSelected =
        tab.name === tabName;
      tab.button?.setAttribute(
        "aria-selected",
        isSelected ? "true" : "false"
      );
      if (tab.panel) {
        tab.panel.hidden =
          !isSelected;
      }
    }
  }

  function moveBottomTabFocus(
    activeTab,
    direction
  ) {
    const tabs = bottomTabs.filter(
      (tab) => Boolean(tab.button)
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
    moveBottomTabFocus,
    installBottomTabHandlers,
  };
}
