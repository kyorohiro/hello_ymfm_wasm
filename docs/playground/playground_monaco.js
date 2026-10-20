import {createDefinitionViewer} from './playground_monaco_definitions.js?v=opn-modes-1';
import { registerMonacoCompletions } from "./playground_monaco_completion.js?v=msx-modes-2";
import {selectPlaygroundDeclarations} from './playground_declarations.js?v=msx-modes-2';

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
          createTimeline:
            "Start an elapsed-seconds timeline after loading resources. waitUntil(seconds) uses positions from this start; late waits catch up. Independent of BPM; not sample-accurate audio reservation.",
          beat:
            "Wait using the shared beat clock.",
          nextBeat:
            "Wait for the next integer position on the shared beat clock. BPM changes preserve the current beat position.",
          beat:
            "Wait for elapsed beats on the shared clock. Waiting loops follow BPM changes without rounding to a beat boundary.",
          setBpm:
            "Change the shared tempo immediately while preserving beat position. Beat waits, beat-length notes and beat tweens follow; seconds and samples do not.",
          tween:
            "Animate over {seconds} or {beats}. Progress goes from 0 to 1. Beat durations follow shared setBpm changes; seconds ignore tempo.",
          fx: "Create and connect master FX units.",
          fm: "Control the selected mode's primary FM sound chip.",
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
      prefixes: ["tween("],
      label: "tween(duration: {seconds: number} | {beats: number}, onUpdate: (progress: number) => void | Promise<void>): Promise<void>",
      parameters: [
        {
          label: "duration: {seconds: number} | {beats: number}",
          documentation: "Choose exactly one of {seconds: n} or {beats: n}. Beat durations follow tempo changes; seconds do not.",
        },
        {
          label: "onUpdate: (progress: number) => void | Promise<void>",
          documentation: "Progress = 0 at the start and 1 at the end, measured in the selected unit. Half the beats is 0.5 even when BPM changes. This is not elapsed seconds.",
        },
      ],
    },
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
  const libraryModels = new Map();
  for (const name of ["tetorica-playground-globals", `tetorica-playground-${chip}`, "tetorica-shell"]) {
    const response = await fetch(new URL(`./${name}.d.ts?v=native-modes-1`, import.meta.url), { cache: "no-cache" });
    if (!response.ok) throw new Error(`Failed to load playground type declarations: ${response.status}`);
    let declarations = await response.text();
    if (name === 'tetorica-playground-globals') declarations = selectPlaygroundDeclarations(declarations, chip);
    const uri = monaco.Uri.parse(`file:///${name}.d.ts`);
    monaco.languages.typescript.javascriptDefaults.addExtraLib(declarations, uri.toString());
    const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(declarations, 'typescript', uri);
    libraryModels.set(uri.toString(), model);
  }
  return libraryModels;
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
      monaco,
      { listVirtualFiles: options.listVirtualFiles, chip:options.chip }
    );
    registerMonacoHover(monaco);
    registerMonacoSignatureHelp(
      monaco
    );
    const libraryModels = await registerMonacoPlaygroundGlobals(monaco, options.chip);

    const modelUri =
      monaco.Uri.parse(
        `file:///project${options.getActiveVirtualPath?.() ?? '/index.js'}`
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

    // Monaco's widget colors are scoped to .monaco-editor and the theme class.
    // Preserve that scope when rendering widgets outside the editor pane.
    const overflowHost = document.createElement("div");
    overflowHost.className = "monaco-editor vs-dark playground-monaco-overflow";
    document.body.append(overflowHost);

    const monacoEditor =
      monaco.editor.create(
        editorHost,
        {
          model: monacoModel,
          theme: "vs-dark",
          automaticLayout: true,
          // Keep hover and completion widgets outside the clipped editor pane.
          fixedOverflowWidgets: true,
          overflowWidgetsDomNode: overflowHost,
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
            showFiles: true,
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
    monacoEditor.onDidDispose(() => overflowHost.remove());
    const definitionViewer = createDefinitionViewer(monaco, monacoEditor, libraryModels, {
      chip: options.chip, openVirtualFile: options.openVirtualFile,
    });
    monacoEditor.onDidDispose(() => {definitionViewer.dispose();for (const model of libraryModels.values()) model.dispose();});
    let currentModel = monacoModel;

    function getModelForVirtualPath(path, source) {
      const uri = monaco.Uri.parse(
        `file:///project${path}`
      );
      const existing = monaco.editor.getModel(uri);
      if (existing) {
        const language = path.endsWith(".json")
          ? "json"
          : "javascript";
        if (existing.getLanguageId() !== language) {
          monaco.editor.setModelLanguage(
            existing,
            language
          );
        }
        return existing;
      }
      return monaco.editor.createModel(
        source,
        path.endsWith(".json")
          ? "json"
          : "javascript",
        uri
      );
    }

    function syncVirtualFiles(files) {
      const paths = new Set();
      for (const file of files) {
        if (
          file.type === "text" &&
          (
            file.path.endsWith(".js") ||
            file.path.endsWith(".json")
          )
        ) {
          paths.add(file.path);
          const model = getModelForVirtualPath(
            file.path,
            file.data
          );
          if (model !== currentModel && model.getValue() !== file.data) {
            model.setValue(file.data);
          }
        }
      }
      // Keep the attached model alive until openVirtualFile switches the editor.
      for (const model of monaco.editor.getModels()) {
        if (model === currentModel || model.uri.scheme !== "file" ||
            !model.uri.path.startsWith("/project/")) continue;
        if (!paths.has(model.uri.path.slice("/project".length))) model.dispose();
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
        syncVirtualFiles(options.listVirtualFiles?.() ?? []);
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
