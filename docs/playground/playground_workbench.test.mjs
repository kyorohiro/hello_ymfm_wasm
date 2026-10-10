import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaygroundUi} from './playground_ui.js';

function setup() {
  const makeButton = () => ({attributes: {}, setAttribute(k,v) {this.attributes[k] = v;},focus() {this.focused = true;}});
  const options = {dockedPanels: true,initialDockOpen: true,initialBottomTab: 'console'};
  for (const name of ['code','console','shell','audioMonitor','fxMonitor','operator','keyboard','helpers']) {
    options[`${name}Panel`] = {};
    options[name === 'operator' ? 'operatorTabButton' : `${name}Tab`] = makeButton();
  }
  const events = [];
  options.onBottomTabChange = (_,state) => events.push(state);
  return {options,events,ui:createPlaygroundUi(options)};
}

test('bottom tools keep the editor visible and select independently of editor tabs', () => {
  const {ui,options,events} = setup();
  ui.setBottomTab('code');
  ui.setBottomTab('shell');
  assert.equal(options.codePanel.hidden,false);
  assert.equal(options.shellPanel.hidden,false);
  assert.equal(options.consolePanel.hidden,true);
  assert.equal(options.codeTab.attributes['aria-selected'],'true');
  ui.setBottomTab('audio');
  assert.equal(options.codePanel.hidden,false);
  assert.equal(options.audioMonitorPanel.hidden,false);
  assert.equal(options.shellPanel.hidden,true);
  ui.setBottomTab('operator');
  assert.equal(options.operatorPanel.hidden,false);
  assert.equal(options.keyboardPanel.hidden,false);
  assert.equal(options.audioMonitorPanel.hidden,false);
  assert.deepEqual(events.at(-1),{primaryTab:'operator',bottomTab:'audio',dockOpen:true});
  ui.setBottomTab('code');
  assert.equal(options.codePanel.hidden,false);
  assert.equal(options.audioMonitorPanel.hidden,false);
});

test('closing and reopening the dock preserves both selected tabs', () => {
  const {ui,options,events} = setup();
  ui.setBottomTab('code'); ui.setBottomTab('shell');
  ui.setDockVisible(false);
  assert.equal(options.codePanel.hidden,false);
  assert.equal(options.shellPanel.hidden,true);
  assert.equal(events.at(-1).dockOpen,false);
  ui.setDockVisible(true);
  assert.equal(options.shellPanel.hidden,false);
  ui.setDockVisible(false); ui.setBottomTab('console');
  assert.equal(options.consolePanel.hidden,false);
  assert.equal(options.codePanel.hidden,false);
});

test('arrow-key navigation stays within the top or bottom tab group', () => {
  const {ui,options,events} = setup();
  ui.setBottomTab('code');
  ui.moveBottomTabFocus(options.codeTab,1);
  assert.equal(options.operatorTabButton.focused,true);
  assert.equal(events.at(-1).primaryTab,'operator');
  ui.moveBottomTabFocus(options.consoleTab,1);
  assert.equal(options.shellTab.focused,true);
  assert.equal(events.at(-1).primaryTab,'operator');
  assert.equal(events.at(-1).bottomTab,'shell');
});
