import { registerMonacoCompletions } from "./playground_monaco_completion.js";

function registerMonacoHover(
  monaco
) {
  monaco.languages.registerHoverProvider(
    "javascript",
    {
      provideHover(
        model,
        position
      ) {
        const word =
          model.getWordAtPosition(
            position
          );

        if (!word) {
          return null;
        }

        const docs = {
          liveLoop:
            "Create a named repeating live loop.",
          livePrepare:
            "Prepare and reuse live state across runs.",
          beat:
            "Wait using the shared beat clock.",
          nextBeat:
            "Wait for the next beat boundary.",
          fx: "Create and connect master FX units.",
          fm: "Control raw YM2612Synth behavior.",
        };
        const message =
          docs[word.word];

        if (!message) {
          return null;
        }

        return {
          contents: [
            {
              value: `**${word.word}**\n\n${message}`,
            },
          ],
        };
      },
    }
  );
}

function registerMonacoSignatureHelp(
  monaco
) {
  const signatures = [
    {
      prefixes: ["setBpm("],
      label:
        "setBpm(bpm: number): void",
      parameters: [
        {
          label: "bpm: number",
          documentation:
            "Shared BPM for beat() and nextBeat().",
        },
      ],
    },
    {
      prefixes: ["play(", "pg.play("],
      label:
        "play(note: string, options?: PlaygroundPlayOptions): Promise<void>",
      parameters: [
        {
          label: "note: string",
          documentation:
            'Note name such as "E4" or "Bb3".',
        },
        {
          label:
            "options?: PlaygroundPlayOptions",
          documentation:
            "Optional channel, duration, and preset.",
        },
      ],
    },
    {
      prefixes: ["scale(", "pg.scale("],
      label:
        "scale(root: string, name: string, octaves?: number): string[]",
      parameters: [
        {
          label: "root: string",
          documentation:
            'Root note such as "E4".',
        },
        {
          label: "name: string",
          documentation:
            'Scale name such as "minorPentatonic".',
        },
        {
          label: "octaves?: number",
          documentation:
            "How many octave spans to include.",
        },
      ],
    },
    {
      prefixes: ["liveLoop(", "pg.liveLoop("],
      label:
        "liveLoop(name: string, fn: () => Promise<void> | void): void",
      parameters: [
        {
          label: "name: string",
          documentation:
            "Loop name used for replacement and stopping.",
        },
        {
          label:
            "fn: () => Promise<void> | void",
          documentation:
            "Loop body callback.",
        },
      ],
    },
    {
      prefixes: ["write("],
      label:
        "write(register: number, value: number): void",
      parameters: [
        {
          label: "register: number",
          documentation:
            "YM2612 register number on port 0, such as 0x22 or 0x28.",
        },
        {
          label: "value: number",
          documentation:
            "Value written to that register.",
        },
      ],
    },
    {
      prefixes: ["write("],
      label:
        "write(port: number, register: number, value: number): void",
      parameters: [
        {
          label: "port: number",
          documentation:
            "YM2612 port 0 or 1.",
        },
        {
          label: "register: number",
          documentation:
            "YM2612 register number such as 0x22 or 0x28.",
        },
        {
          label: "value: number",
          documentation:
            "Value written to that register.",
        },
      ],
    },
    {
      prefixes: ["sleepSamples(", "pg.sleepSamples("],
      label:
        "sleepSamples(samples: number, sampleRate?: number): Promise<void>",
      parameters: [
        {
          label: "samples: number",
          documentation:
            "Sample units to wait, defaulting to VGM-style 44.1kHz timing.",
        },
        {
          label: "sampleRate?: number",
          documentation:
            "Optional sample-rate basis. Defaults to 44100.",
        },
      ],
    },
    {
      prefixes: ["fm.write("],
      label:
        "fm.write(port: number, register: number, value: number): void",
      parameters: [
        {
          label: "port: number",
          documentation:
            "YM2612 port 0 or 1.",
        },
        {
          label: "register: number",
          documentation:
            "YM2612 register number such as 0x22 or 0x28.",
        },
        {
          label: "value: number",
          documentation:
            "Value written to that register.",
        },
      ],
    },
    {
      prefixes: ["fm.setOperator("],
      label:
        "fm.setOperator(channel: number, operator: number, params: YM2612OperatorParams): void",
      parameters: [
        {
          label: "channel: number",
          documentation:
            "YM2612 channel 0..5.",
        },
        {
          label: "operator: number",
          documentation:
            "Logical operator 0..3.",
        },
        {
          label:
            "params: YM2612OperatorParams",
          documentation:
            "Partial operator parameter update.",
        },
      ],
    },
  ];

  monaco.languages.registerSignatureHelpProvider(
    "javascript",
    {
      signatureHelpTriggerCharacters: [
        "(",
        ",",
      ],
      provideSignatureHelp(
        model,
        position
      ) {
        const linePrefix =
          model.getLineContent(
            position.lineNumber
          ).slice(
            0,
            position.column - 1
          );

        let bestMatch = null;
        for (const signature of signatures) {
          for (const prefix of signature.prefixes) {
            const index =
              linePrefix.lastIndexOf(
                prefix
              );
            if (
              index >= 0 &&
              (bestMatch === null ||
                index >
                  bestMatch.index)
            ) {
              bestMatch = {
                signature,
                index,
                prefix,
              };
            }
          }
        }

        if (!bestMatch) {
          return null;
        }

        const argsText =
          linePrefix.slice(
            bestMatch.index +
              bestMatch.prefix.length
          );

        let activeParameter = 0;
        let depth = 0;
        let inString = false;
        let stringQuote = "";
        for (let index = 0; index < argsText.length; index += 1) {
          const char = argsText[index];
          if (inString) {
            if (
              char === stringQuote &&
              argsText[index - 1] !== "\\"
            ) {
              inString = false;
              stringQuote = "";
            }
            continue;
          }
          if (
            char === '"' ||
            char === "'"
          ) {
            inString = true;
            stringQuote = char;
            continue;
          }
          if (
            char === "(" ||
            char === "[" ||
            char === "{"
          ) {
            depth += 1;
            continue;
          }
          if (
            char === ")" ||
            char === "]" ||
            char === "}"
          ) {
            if (depth > 0) {
              depth -= 1;
            }
            continue;
          }
          if (
            char === "," &&
            depth === 0
          ) {
            activeParameter += 1;
          }
        }

        activeParameter = Math.min(
          activeParameter,
          bestMatch.signature.parameters
            .length - 1
        );

        return {
          value: {
            signatures: [
              {
                label:
                  bestMatch.signature.label,
                parameters:
                  bestMatch.signature.parameters,
              },
            ],
            activeSignature: 0,
            activeParameter,
          },
          dispose() {},
        };
      },
    }
  );
}

async function registerMonacoPlaygroundGlobals(
  monaco,
  chip = "ym2612"
) {
  for (const name of ["tetorica-playground-globals", `tetorica-playground-${chip}`]) {
    const response = await fetch(new URL(`./${name}.d.ts`, import.meta.url));
    if (!response.ok) throw new Error(`Failed to load playground type declarations: ${response.status}`);
    let declarations = await response.text();
    if ((chip === "ym2203" || chip === "ym2610") && name === "tetorica-playground-globals") {
      // YM2203 has three channels; Neo Geo YM2610 exposes four.
      declarations = declarations.replace(chip === "ym2203" ? /declare const CH[456]: [345];\n/g : /declare const CH[56]: [45];\n/g, "");
    }
    monaco.languages.typescript.javascriptDefaults.addExtraLib(declarations, `file:///${name}.d.ts`);
  }
}

function loadMonacoLoader() {
  return new Promise(
    (resolve, reject) => {
      if (
        window.require?.config &&
        window.monaco
      ) {
        resolve(window.monaco);
        return;
      }

      const script =
        document.createElement(
          "script"
        );
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs/loader.min.js";
      script.onload = () => {
        resolve();
      };
      script.onerror = () => {
        reject(
          new Error(
            "Failed to load Monaco loader"
          )
        );
      };
      document.head.appendChild(
        script
      );
    }
  );
}

export async function initializePlaygroundMonaco(
  options
) {
  const {
    editor,
    editorHost,
    getEditorValue,
    setEditorNote,
    setEditorAdapter,
    onMonacoEditorReady,
  } = options;

  try {
    await loadMonacoLoader();
  } catch (error) {
    console.warn(error);
    setEditorNote(
      "Monaco editor could not load. Fallback textarea is active."
    );
    return;
  }

  try {
    await new Promise(
      (resolve, reject) => {
        window.MonacoEnvironment = {
          getWorkerUrl() {
            const workerSource =
              `
                self.MonacoEnvironment = { baseUrl: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/" };
                importScripts("https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs/base/worker/workerMain.js");
              `;
            return URL.createObjectURL(
              new Blob(
                [workerSource],
                {
                  type: "text/javascript",
                }
              )
            );
          },
        };

        window.require.config({
          paths: {
            vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs",
          },
        });

        window.require(
          [
            "vs/editor/editor.main",
          ],
          () => {
            resolve();
          },
          reject
        );
      }
    );

    const monaco =
      window.monaco;
    monaco.languages.typescript.javascriptDefaults.setEagerModelSync(
      true
    );
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions(
      {
        allowJs: true,
        allowNonTsExtensions: true,
        checkJs: true,
        noLib: false,
        lib: [
          "es2020",
        ],
        module:
          monaco.languages.typescript.ModuleKind.ESNext,
        moduleResolution:
          monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        moduleDetection:
          monaco.languages.typescript.ModuleDetectionKind?.Force ?? 3,
        target:
          monaco.languages.typescript.ScriptTarget.ES2020,
      }
    );
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(
      {
        noSemanticValidation: false,
        noSyntaxValidation: false,
        diagnosticCodesToIgnore: [
          1375,
          1378,
        ],
      }
    );
    registerMonacoCompletions(
      monaco
    );
    registerMonacoHover(monaco);
    registerMonacoSignatureHelp(
      monaco
    );
    await registerMonacoPlaygroundGlobals(monaco, options.chip);

    const modelUri =
      monaco.Uri.parse(
        "file:///project/index.js"
      );
    const existingModel =
      monaco.editor.getModel(
        modelUri
      );
    const monacoModel =
      existingModel ??
      monaco.editor.createModel(
        getEditorValue(),
        "javascript",
        modelUri
      );

    if (existingModel) {
      existingModel.setValue(
        getEditorValue()
      );
    }

    const monacoEditor =
      monaco.editor.create(
        editorHost,
        {
          model: monacoModel,
          theme: "vs-dark",
          automaticLayout: true,
          minimap: {
            enabled: false,
          },
          fontSize: 13,
          lineHeight: 21,
          padding: {
            top: 16,
            bottom: 12,
          },
          roundedSelection: false,
          scrollBeyondLastLine: false,
          tabSize: 2,
          wordWrap: "on",
          wordBasedSuggestions: "off",
          quickSuggestions: true,
          suggestOnTriggerCharacters: true,
          parameterHints: {
            enabled: true,
          },
          snippetSuggestions: "top",
          suggest: {
            showClasses: false,
            showColors: false,
            showConstants: true,
            showConstructors: false,
            showEnums: false,
            showEnumMembers: false,
            showEvents: false,
            showFields: true,
            showFiles: false,
            showFolders: false,
            showFunctions: true,
            showInterfaces: false,
            showIssues: false,
            showKeywords: false,
            showMethods: true,
            showModules: false,
            showOperators: false,
            showProperties: true,
            showReferences: false,
            showSnippets: true,
            showStructs: false,
            showTypeParameters: false,
            showUsers: false,
            showValues: true,
            showVariables: true,
            showWords: false,
          },
        }
      );
    let currentModel = monacoModel;

    function getModelForVirtualPath(path, source) {
      const uri = monaco.Uri.parse(
        `file:///project${path}`
      );
      const existing = monaco.editor.getModel(uri);
      if (existing) {
        return existing;
      }
      return monaco.editor.createModel(
        source,
        "javascript",
        uri
      );
    }

    function syncVirtualFiles(files) {
      for (const file of files) {
        if (
          file.type === "text" &&
          file.path.endsWith(".js")
        ) {
          getModelForVirtualPath(
            file.path,
            file.data
          );
        }
      }
    }

    syncVirtualFiles(options.listVirtualFiles?.() ?? []);

    const triggerParameterHints =
      () => {
        monacoEditor.trigger(
          "tetorica",
          "editor.action.triggerParameterHints",
          {}
        );
      };

    monacoEditor.onDidType(
      (text) => {
        if (
          text === "(" ||
          text === ","
        ) {
          triggerParameterHints();
        }
      }
    );
    monacoEditor.onKeyDown(
      (event) => {
        const e =
          event.browserEvent;
        const isShiftI =
          e.shiftKey &&
          (
            e.code === "KeyI" ||
            e.key === "I" ||
            e.key === "i"
          );
        const isSupportedModifier =
          e.ctrlKey ||
          e.metaKey;

        if (
          isShiftI &&
          isSupportedModifier
        ) {
          e.preventDefault();
          e.stopPropagation();
          triggerParameterHints();
        }
      }
    );

    editorHost.dataset.ready =
      "true";
    editor.style.display = "none";
    setEditorNote(
      "Monaco editor is active. Tetorica-specific completion is enabled."
    );

    setEditorAdapter({
      kind: "monaco",
      getValue() {
        return currentModel.getValue();
      },
      setValue(value) {
        currentModel.setValue(
          value
        );
      },
      openVirtualFile(path, source) {
        currentModel = getModelForVirtualPath(path, source);
        monacoEditor.setModel(currentModel);
      },
      setReadOnly(readOnly) {
        monacoEditor.updateOptions({ readOnly });
      },
      syncVirtualFiles,
      replaceAll(value) {
        // Keep example changes in Monaco's normal Ctrl/Cmd+Z history.
        monacoEditor.pushUndoStop();
        monacoEditor.executeEdits(
          "tetorica-load-example",
          [
            {
              range:
                currentModel.getFullModelRange(),
              text: value,
              forceMoveMarkers: true,
            },
          ]
        );
        monacoEditor.pushUndoStop();
        monacoEditor.setPosition({
          lineNumber: 1,
          column: 1,
        });
        monacoEditor.revealPositionInCenterIfOutsideViewport(
          monacoEditor.getPosition()
        );
        monacoEditor.focus();
      },
      getCursorOffset() {
        const selection =
          monacoEditor.getSelection();
        const position =
          selection?.getPosition() ??
          monacoEditor.getPosition();

        if (!position) {
          return currentModel.getValueLength();
        }

        return currentModel.getOffsetAt(
          position
        );
      },
      insertText(text) {
        const selection =
          monacoEditor.getSelection();
        const position =
          monacoEditor.getPosition() ??
          currentModel.getPositionAt(
            currentModel.getValueLength()
          );
        const range =
          selection ??
          new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column
          );

        monacoEditor.executeEdits(
          "tetorica",
          [
            {
              range,
              text,
              forceMoveMarkers: true,
            },
          ]
        );
        monacoEditor.revealPositionInCenterIfOutsideViewport(
          monacoEditor.getPosition() ??
            position
        );
        monacoEditor.focus();
      },
      focus() {
        monacoEditor.focus();
      },
    });

    onMonacoEditorReady?.({
      monaco,
      monacoEditor,
      monacoModel,
    });
  } catch (error) {
    console.warn(error);
    setEditorNote(
      "Monaco editor setup failed. Fallback textarea is active."
    );
  }
}
