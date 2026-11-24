// SPDX-License-Identifier: BSD-3-Clause
import { initializePlaygroundMonaco } from '../playground/playground_monaco.js?v=fm2610-code-monaco-1';
import { selectFm2610CodeDeclarations } from './code_declarations.js';

/** Keep the same source in Files, Run and the fallback textarea. */
export function setupFm2610CodeEditor({
  textarea, editorHost, editorNote, whenReady, getPath, listFiles, openFile, onEdit, run, visible,
  initialize = initializePlaygroundMonaco,
}) {
  let loading, adapter, editor, modelPath, selection;
  let syncing = false, disposed = false;

  function setNote(message) {
    editorNote.textContent = message;
    editorNote.hidden = !message;
  }

  function setSource(source, path = getPath()) {
    textarea.value = source;
    if (!adapter) return;
    syncing = true;
    try {
      if (path !== modelPath) {
        adapter.openVirtualFile(path, source);
        modelPath = path;
      } else {
        adapter.syncVirtualFiles(listFiles());
      }
      if (adapter.getValue() !== source) adapter.setValue(source);
    } finally {
      syncing = false;
    }
  }

  function onKeyDown(event) {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return;
    event.preventDefault();
    if (!event.repeat) run(event.shiftKey);
  }
  textarea.addEventListener('keydown', onKeyDown);
  textarea.addEventListener('input', onEdit);

  function load() {
    if (disposed || !visible()) return Promise.resolve();
    if (loading) return loading;
    loading = Promise.resolve().then(whenReady).then(() => {
      if (disposed) return;
      return initialize({
        chip: 'ym2610b',
        editor: textarea,
        editorHost,
        playgroundHints: false,
        requireJavaScriptWorker: true,
        declarationFiles: ['tetorica-playground-globals'],
        transformDeclarations: selectFm2610CodeDeclarations,
        definitionRuntimeFile: 'playground_code_runtime.js',
        getEditorValue() {
          selection = textarea.ownerDocument.activeElement === textarea
            ? [textarea.selectionStart, textarea.selectionEnd] : null;
          return textarea.value;
        },
        getActiveVirtualPath: getPath,
        listVirtualFiles: listFiles,
        openVirtualFile: openFile,
        setEditorNote: setNote,
        setEditorAdapter(value) { adapter = value; },
        onMonacoEditorReady({monaco, monacoEditor, monacoModel}) {
          if (disposed) {
            monacoEditor.dispose();
            return;
          }
          editor = monacoEditor;
          modelPath = getPath();
          setNote('');
          editor.updateOptions({ariaLabel: 'JavaScript', occurrencesHighlight: 'off'});
          editor.onDidChangeModelContent(() => {
            if (!syncing) {
              textarea.value = adapter.getValue();
              onEdit();
            }
          });
          const runKeys = monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter;
          editor.addCommand(runKeys, () => run(false));
          editor.addCommand(runKeys | monaco.KeyMod.Shift, () => run(true));
          if (visible()) {
            editor.layout();
            if (selection) {
              const [start, end] = selection.map(offset => monacoModel.getPositionAt(offset));
              editor.setSelection(new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column));
              editor.focus();
            }
          }
        },
      });
    }).catch(error => {
      console.warn(error);
      setNote('Monaco editor setup failed. Fallback textarea is active.');
    });
    return loading;
  }

  return {
    load,
    setSource,
    layout() { editor?.layout(); },
    focus() {
      if (editor) editor.focus();
      else textarea.focus({preventScroll: true});
    },
    dispose() {
      disposed = true;
      textarea.removeEventListener('keydown', onKeyDown);
      textarea.removeEventListener('input', onEdit);
      editor?.dispose();
      editor = adapter = null;
    },
  };
}
