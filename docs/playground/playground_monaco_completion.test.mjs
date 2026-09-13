import test from 'node:test';
import assert from 'node:assert/strict';
import { registerMonacoCompletions } from './playground_monaco_completion.js';

let provider;
let files = [];
registerMonacoCompletions({ languages: {
  CompletionItemKind: {}, CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
  registerCompletionItemProvider(language, value) { if (language === 'javascript') provider = value; },
} }, { listVirtualFiles: () => files });

function complete(line) {
  const column = line.length + 1;
  const word = line.match(/\w*$/)[0];
  const model = {
    getValue: () => line, getLineContent: () => line, getValueInRange: () => line,
    getWordUntilPosition: () => ({ startColumn: column - word.length, endColumn: column, word }),
  };
  return provider.provideCompletionItems(model, { lineNumber: 1, column })?.suggestions.find(item => item.label === 'await import');
}

test('dynamic import completes partial keywords and replaces an existing await once', () => {
  for (const text of ['a', 'aw', 'await', 'await ', 'await im', 'import', 'const module = await im']) {
    const item = complete(text);
    assert.ok(item, text);
    const result = text.slice(0, item.range.startColumn - 1) + item.insertText;
    assert.equal(result, (text.startsWith('const') ? 'const module = ' : '') + 'await import("${1:./module.js}")');
  }
});

test('dynamic import snippet does not appear for members, comments or string input', () => {
  for (const text of ['fm.im', '// await im', '"await im', 'const text = "await im']) {
    assert.equal(complete(text), undefined, text);
  }
});

test('dynamic import preserves destructuring declarations when completing the expression', () => {
  for (const declaration of [
    'const {} = ',
    'const { foo } = ',
    'const { foo: bar, baz, ...rest } = ',
    'let { default: module } = ',
    '  const [first, second] = ',
  ]) {
    const text = declaration + 'await im';
    const item = complete(text);
    assert.ok(item, text);
    assert.equal(
      text.slice(0, item.range.startColumn - 1) + item.insertText,
      declaration + 'await import("${1:./module.js}")',
    );
  }
});

test('import paths use current project files and replace quoted contents without duplication', () => {
  files = [
    { path: '/lib/new-file.js', type: 'text' },
    { path: '/index.js', type: 'text' },
    { path: '/tone.tfi', type: 'binary' },
    { path: '/metadata.json', type: 'text' },
  ];
  function paths(line, currentPath, column = line.length + 1) {
    return provider.provideCompletionItems({
      uri: { path: `/project${currentPath}` }, getValue: () => line,
      getLineContent: () => line, getValueInRange: () => line.slice(0, column - 1),
      getWordUntilPosition: () => ({ startColumn: column, endColumn: column, word: '' }),
    }, { lineNumber: 1, column }).suggestions;
  }
  const line = 'const { hello } = await import("./lib/new-file.js");';
  const column = line.indexOf('./lib') + 3;
  const [item] = paths(line, '/index.js', column);
  assert.equal(item.label, './lib/new-file.js');
  assert.equal(line.slice(0, item.range.startColumn - 1) + item.insertText + line.slice(item.range.endColumn - 1), line);
  assert.deepEqual(paths("await import('", '/lib/new-file.js').map(item => item.label), ['../index.js']);
  assert.deepEqual(paths('await import("/', '/index.js').map(item => item.label), ['/lib/new-file.js']);
  files = files.filter(file => file.path !== '/lib/new-file.js');
  assert.deepEqual(paths('await import("', '/index.js'), []);
});
