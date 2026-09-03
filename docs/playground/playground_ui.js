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
      .map((value) =>
        typeof value === "string"
          ? value
          : JSON.stringify(value)
      )
      .join(" ");
  }

  function setBottomTab(tabName) {
    const tabs = [
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
        name: "helpers",
        button: helpersTab,
        panel: helpersPanel,
      },
      {
        name: "operator",
        button: operatorTabButton,
        panel: operatorPanel,
      },
    ];

    for (const tab of tabs) {
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
    const tabs = [
      codeTab,
      consoleTab,
      operatorTabButton,
      helpersTab,
    ].filter(Boolean);
    const currentIndex =
      tabs.indexOf(activeTab);

    if (currentIndex === -1) {
      return;
    }

    const nextIndex =
      (currentIndex +
        direction +
        tabs.length) %
      tabs.length;
    tabs[nextIndex]?.focus();
    setBottomTab(
      tabs[nextIndex] === codeTab
        ? "code"
        : tabs[nextIndex] ===
        consoleTab
        ? "console"
        : tabs[nextIndex] ===
            operatorTabButton
          ? "operator"
          : "helpers"
    );
  }

  function installBottomTabHandlers() {
    codeTab?.addEventListener(
      "click",
      () => {
        setBottomTab("code");
      }
    );

    consoleTab?.addEventListener(
      "click",
      () => {
        setBottomTab("console");
      }
    );

    helpersTab?.addEventListener(
      "click",
      () => {
        setBottomTab("helpers");
      }
    );

    operatorTabButton?.addEventListener(
      "click",
      () => {
        setBottomTab("operator");
      }
    );

    for (const tabButton of [
      codeTab,
      consoleTab,
      operatorTabButton,
      helpersTab,
    ]) {
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
