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
  ui.moveBottomTabFocus(options.operatorTabButton,1);
  assert.equal(options.codeTab.focused,true);
  assert.equal(events.at(-1).primaryTab,'code', 'only Code and Operator belong to the upper group');
  ui.moveBottomTabFocus(options.shellTab,1);
  assert.equal(options.keyboardTab.focused,true);
  assert.equal(events.at(-1).bottomTab,'keyboard');
  ui.moveBottomTabFocus(options.keyboardTab,1);
  assert.equal(options.helpersTab.focused,true);
  assert.equal(events.at(-1).bottomTab,'helpers');
  ui.moveBottomTabFocus(options.helpersTab,1);
  assert.equal(options.audioMonitorTab.focused,true);
  assert.equal(events.at(-1).bottomTab,'audio');
  assert.equal(events.at(-1).primaryTab,'code');
});

test('Keyboard and Helper are independent lower tools beside the visible Code editor', () => {
  const {ui,options,events} = setup();
  ui.setBottomTab('code');
  ui.setBottomTab('keyboard');
  assert.equal(options.codePanel.hidden,false);
  assert.equal(options.keyboardPanel.hidden,false);
  assert.equal(options.operatorPanel.hidden,true);
  assert.equal(options.helpersPanel.hidden,true);
  assert.equal(options.consolePanel.hidden,true);
  assert.equal(options.codeTab.attributes['aria-selected'],'true');
  assert.equal(options.keyboardTab.attributes['aria-selected'],'true');
  assert.deepEqual(events.at(-1),{primaryTab:'code',bottomTab:'keyboard',dockOpen:true});
  ui.setBottomTab('helpers');
  assert.equal(options.codePanel.hidden,false);
  assert.equal(options.helpersPanel.hidden,false);
  assert.equal(options.keyboardPanel.hidden,true);
  assert.equal(options.keyboardTab.attributes['aria-selected'],'false');
  assert.equal(options.helpersTab.attributes['aria-selected'],'true');
  assert.deepEqual(events.at(-1),{primaryTab:'code',bottomTab:'helpers',dockOpen:true});
});

for (const name of ['keyboard','helpers']) test(`closing and reopening lower ${name} retains Code and the selected tool`, () => {
  const {ui,options,events} = setup();
  ui.setBottomTab('code');
  ui.setBottomTab(name);
  ui.setDockVisible(false);
  assert.equal(options.codePanel.hidden,false);
  assert.equal(options[`${name}Panel`].hidden,true);
  assert.deepEqual(events.at(-1),{primaryTab:'code',bottomTab:name,dockOpen:false});
  ui.setDockVisible(true);
  assert.equal(options.codePanel.hidden,false);
  assert.equal(options[`${name}Panel`].hidden,false);
  assert.deepEqual(events.at(-1),{primaryTab:'code',bottomTab:name,dockOpen:true});
});

test('Operator retains compact audition when the lower panel is another tool or closed', () => {
  const {ui,options,events} = setup();
  ui.setBottomTab('operator');
  ui.setBottomTab('helpers');
  assert.equal(options.operatorPanel.hidden,false);
  assert.equal(options.helpersPanel.hidden,false);
  assert.equal(options.keyboardPanel.hidden,false, 'Operator keeps its compact audition available');
  ui.setDockVisible(false);
  assert.equal(options.operatorPanel.hidden,false);
  assert.equal(options.helpersPanel.hidden,true);
  assert.equal(options.keyboardPanel.hidden,false, 'the floating audition is independent of a closed dock');
  ui.setBottomTab('keyboard');
  assert.equal(options.operatorPanel.hidden,false);
  assert.equal(options.keyboardPanel.hidden,false);
  assert.deepEqual(events.at(-1),{primaryTab:'operator',bottomTab:'keyboard',dockOpen:true});
  ui.setBottomTab('code');
  assert.equal(options.codePanel.hidden,false);
  assert.equal(options.keyboardPanel.hidden,false, 'the full lower keyboard stays open when returning to Code');
});

test('chip editors remain above a separately selected Mixer and navigate in visual order', () => {
  const {options} = setup();
  for (const name of ['segapsg', 'rf5c164', 'pwm', 'mixer']) {
    options[`${name}Panel`] = {};
    options[`${name}Tab`] = {setAttribute() {}, focus() {this.focused = true;}};
  }
  const events = [];
  options.onBottomTabChange = (_, state) => events.push(state);
  const ui = createPlaygroundUi(options);
  ui.setBottomTab('segapsg'); ui.setBottomTab('mixer');
  assert.equal(options.segapsgPanel.hidden, false);
  assert.equal(options.mixerPanel.hidden, false);
  assert.equal(options.codePanel.hidden, true);
  assert.equal(options.keyboardPanel.hidden, true);
  assert.deepEqual(events.at(-1), {primaryTab: 'segapsg', bottomTab: 'mixer', dockOpen: true});
  ui.moveBottomTabFocus(options.operatorTabButton, 1);
  assert.equal(options.segapsgTab.focused, true);
  ui.moveBottomTabFocus(options.segapsgTab, 1);
  assert.equal(options.rf5c164Tab.focused, true);
  ui.moveBottomTabFocus(options.pwmTab, 1);
  assert.equal(options.codeTab.focused, true);
  ui.moveBottomTabFocus(options.fxMonitorTab, 1);
  assert.equal(options.mixerTab.focused, true);
  ui.moveBottomTabFocus(options.mixerTab, 1);
  assert.equal(options.consoleTab.focused, true);
  ui.setDockVisible(false);
  assert.equal(options.mixerPanel.hidden, true);
  ui.setBottomTab('mixer');
  assert.equal(options.mixerPanel.hidden, false);
});

for (const kind of ['gameboy','nes','ym2151','okim6258']) test(`${kind} voice editor coexists with Guitar Keyboard and keeps mode-specific navigation`,()=>{
  const {options,events}=setup();
  for(const name of ['segapsg','rf5c164','pwm','gameboy','nes','ym2151','okim6258']) {
    options[`${name}Panel`]={};options[`${name}Tab`]={setAttribute(){},focus(){this.focused=true;}};
  }
  const ui=createPlaygroundUi({...options,chipTabs:[kind]});
  ui.setBottomTab(kind);ui.setBottomTab('keyboard');
  assert.equal(options[`${kind}Panel`].hidden,false);assert.equal(options.keyboardPanel.hidden,false);
  assert.equal(options.operatorTabButton.hidden,true);assert.equal(options[`${kind==='nes'?'gameboy':'nes'}Tab`].hidden,true);
  ui.moveBottomTabFocus(options.codeTab,1);assert.equal(options[`${kind}Tab`].focused,true);
  ui.moveBottomTabFocus(options[`${kind}Tab`],1);assert.equal(options.codeTab.focused,true);
  assert.equal(events.at(-1).primaryTab,'code');
});

test('a mode without FM keeps Code and common tools available and rejects FM keyboard selection', () => {
  const {options,events}=setup();
  const ui=createPlaygroundUi({...options,chipTabs:[],fmKeyboard:false,initialBottomTab:'keyboard'});
  ui.setBottomTab('code');
  assert.equal(options.operatorTabButton.hidden,true);
  assert.equal(options.keyboardTab.hidden,true);
  assert.equal(options.operatorPanel.hidden,true);
  assert.equal(options.keyboardPanel.hidden,true);
  assert.equal(options.codePanel.hidden,false);
  assert.equal(options.consolePanel.hidden,false,'an unavailable saved tool falls back to Console');
  const before=events.length;
  ui.setBottomTab('keyboard');ui.setBottomTab('operator');
  assert.equal(events.length,before,'unavailable FM panels cannot be activated');
  ui.setBottomTab('helpers');
  assert.equal(options.helpersPanel.hidden,false);
  assert.equal(options.codePanel.hidden,false);
  ui.moveBottomTabFocus(options.codeTab,1);
  assert.equal(events.at(-1).primaryTab,'code','the only primary tab cycles to itself');
});

for (const chipTabs of [['operator'], ['operator','segapsg'], ['operator','segapsg','rf5c164','pwm']]) {
  test(`mode tabs stay hidden and navigation visits only available editors (${chipTabs.join(', ')})`, () => {
    const {options, events} = setup();
    for (const name of ['segapsg', 'rf5c164', 'pwm']) {
      options[`${name}Panel`] = {};
      options[`${name}Tab`] = {setAttribute() {}, focus() {this.focused = true;}};
    }
    const ui = createPlaygroundUi({...options, chipTabs});
    ui.setBottomTab('operator');
    const all = ['operator','segapsg','rf5c164','pwm'];
    for (const name of all) {
      const button = options[name === 'operator' ? 'operatorTabButton' : `${name}Tab`];
      assert.equal(button.hidden, !chipTabs.includes(name));
      if (!chipTabs.includes(name)) {
        const before = events.length;
        ui.setBottomTab(name);
        assert.equal(events.length, before, 'hidden tabs cannot select a panel');
        assert.equal(options[`${name}Panel`].hidden, true);
        assert.equal(options.operatorPanel.hidden, false);
      }
    }
    for (let index = 0; index < chipTabs.length; index++) {
      const current = chipTabs[index], next = chipTabs[index + 1] ?? 'code';
      ui.moveBottomTabFocus(options[current === 'operator' ? 'operatorTabButton' : `${current}Tab`], 1);
      assert.equal(events.at(-1).primaryTab, next);
      assert.equal(options[next === 'operator' ? 'operatorTabButton' : `${next}Tab`].focused, true);
    }
    ui.moveBottomTabFocus(options.codeTab, -1);
    assert.equal(events.at(-1).primaryTab, chipTabs.at(-1), 'reverse navigation skips hidden tabs too');
    ui.setBottomTab('helpers');
    assert.equal(options.helpersPanel.hidden, false, 'common tools remain available');
  });
}
