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
            "Logical operator 1..4.",
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
  monaco
) {
  const declarationsUrl =
    new URL(
      "./tetorica-playground-globals.d.ts",
      import.meta.url
    );
  const response =
    await fetch(
      declarationsUrl
    );

  if (!response.ok) {
    throw new Error(
      `Failed to load playground type declarations: ${response.status}`
    );
  }

  const declarations =
    await response.text();

  monaco.languages.typescript.javascriptDefaults.addExtraLib(
    declarations,
    "file:///tetorica-playground-globals.d.ts"
  );
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
        target:
          monaco.languages.typescript.ScriptTarget.ES2020,
      }
    );
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(
      {
        noSemanticValidation: false,
        noSyntaxValidation: false,
      }
    );
    registerMonacoCompletions(
      monaco
    );
    registerMonacoHover(monaco);
    registerMonacoSignatureHelp(
      monaco
    );
    await registerMonacoPlaygroundGlobals(
      monaco
    );

    const monacoEditor =
      monaco.editor.create(
        editorHost,
        {
          value: getEditorValue(),
          language: "javascript",
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
            showConstants: false,
            showConstructors: false,
            showEnums: false,
            showEnumMembers: false,
            showEvents: false,
            showFields: false,
            showFiles: false,
            showFolders: false,
            showInterfaces: false,
            showIssues: false,
            showKeywords: false,
            showModules: false,
            showOperators: false,
            showProperties: true,
            showReferences: false,
            showStructs: false,
            showTypeParameters: false,
            showUsers: false,
            showVariables: true,
            showWords: false,
          },
        }
      );

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
        return monacoEditor.getValue();
      },
      setValue(value) {
        monacoEditor.setValue(
          value
        );
      },
      focus() {
        monacoEditor.focus();
      },
    });
  } catch (error) {
    console.warn(error);
    setEditorNote(
      "Monaco editor setup failed. Fallback textarea is active."
    );
  }
}
