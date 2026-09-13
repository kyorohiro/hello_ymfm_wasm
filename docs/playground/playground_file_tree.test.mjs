import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFileTree, renderFileTree } from './playground_file_tree.js';

test('groups nested folders and sorts folders first and filenames numerically', () => {
  const tree = buildFileTree([
    { path: '/index.js' }, { path: '/presets/song/ch10.tfi' },
    { path: '/lib/helper.js' }, { path: '/presets/song/ch2.tfi' },
  ]);
  assert.deepEqual(tree.map(n => n.name), ['lib', 'presets', 'index.js']);
  const song = tree[1].children[0];
  assert.equal(song.path, '/presets/song');
  assert.deepEqual(song.children.map(n => n.name), ['ch2.tfi', 'ch10.tfi']);
  assert.equal(song.children[0].file.path, '/presets/song/ch2.tfi');
});

test('folder state survives rendering and file buttons open full paths', () => {
  class Element {
    children = []; attrs = {}; listeners = {};
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(key, value) { this.listeners[key] = value; }
    blur() { this.blurred = true; }
  }
  const previous = globalThis.document;
  globalThis.document = { createElement: () => new Element() };
  try {
    const root = new Element();
    const expanded = new Map();
    let opened;
    const files = [{ path: '/presets/test.tfi' }];
    const options = { selectedPath: files[0].path, expanded, onOpen: path => { opened = path; } };
    renderFileTree(root, files, options);
    const folder = root.children[0].children[0].children[0];
    assert.equal(folder.open, true);
    const button = folder.children[1].children[0].children[0];
    assert.equal(button.attrs['aria-current'], 'true');
    button.listeners.click();
    assert.equal(opened, '/presets/test.tfi');
    assert.equal(button.blurred, true);
    folder.open = false;
    folder.listeners.toggle();
    renderFileTree(root, files, options);
    assert.equal(root.children[0].children[0].children[0].open, false);
  } finally { globalThis.document = previous; }
});
