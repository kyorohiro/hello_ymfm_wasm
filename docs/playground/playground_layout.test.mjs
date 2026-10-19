import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPlaygroundLayout} from './playground_ui.js';
import {isSimplePlaygroundLayout} from './playground_mode.js';

function setup(search) {
  const classes = new Set();
  const mainMenu = {id: 'menu'};
  const pin = {id: 'pin'};
  const run = {id: 'run'};
  const stop = {id: 'stop'};
  const reset = {id: 'reset'};
  const utilities = {id: 'utilities', children: [pin, reset]};
  const statusBar = {id: 'status'};
  const toolbar = {
    children: [run, stop, utilities],
    prepend(child) { this.children = [child, ...this.children.filter(node => node !== child)]; },
    after(child) { this.sibling = child; },
  };
  classes.add('mode-expanded'); // Initial HTML also reserves the full layout before boot.
  const body = {classList: {toggle(value, enabled) { enabled ? classes.add(value) : classes.delete(value); }}};
  const simpleMode = isSimplePlaygroundLayout(search);
  return {classes, mainMenu, pin, run, stop, reset, utilities, statusBar, toolbar, body, simpleMode};
}

for (const search of ['', '?expanded=0', '?expanded=1', '?mode=full&monitor=1']) {
  test(`full editor layout is the only standard mode (${search || 'no query'})`, () => {
    const state = setup(search);
    applyPlaygroundLayout(state);
    assert.equal(state.classes.has('mode-expanded'), true);
    assert.deepEqual(state.toolbar.children, [state.mainMenu, state.run, state.stop, state.utilities]);
    assert.deepEqual(state.utilities.children, [state.pin, state.reset]);
    assert.equal(state.toolbar.sibling, state.statusBar);
    applyPlaygroundLayout(state);
    assert.deepEqual(state.toolbar.children, [state.mainMenu, state.run, state.stop, state.utilities]);
  });
}

for (const search of ['?mode=simple&expanded=1', '?mode=pc98&layout=simple']) test(`compact lesson iframes keep their overlay controls and inline status (${search})`, () => {
  const state = setup(search);
  applyPlaygroundLayout(state);
  assert.equal(state.classes.has('mode-expanded'), false);
  assert.deepEqual(state.toolbar.children, [state.run, state.stop, state.utilities]);
  assert.equal(state.toolbar.sibling, undefined);
});
