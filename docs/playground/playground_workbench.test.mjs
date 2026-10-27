import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaygroundUi} from './playground_ui.js';
import {installPlaygroundWorkbench} from './playground_workbench.js';

function classes() {
  const values = new Set();
  return {add:name => values.add(name),remove:name => values.delete(name),contains:name => values.has(name),
    toggle(name, value) {if (value ?? !values.has(name)) values.add(name); else values.delete(name);}};
}

function setup() {
  const makeButton = () => ({attributes: {}, setAttribute(k,v) {this.attributes[k] = v;},focus() {this.focused = true;}});
  const options = {dockedPanels: true,initialDockOpen: true,initialBottomTab: 'console'};
  for (const name of ['code','console','shell','audioMonitor','fxMonitor','operator','keyboard','helpers']) {
    options[`${name}Panel`] = {classList:classes()};
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
  assert.equal(options.keyboardPanel.hidden, false, 'the PSG editor keeps compact audition beside Mixer');
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

for (const kind of ['gameboy','nes','snes','ym2151','okim6258','huc6280','wonderswan','pokey','dx7','ym3812','ym3526','y8950','ymf262','ym2413','ay8910']) test(`${kind} voice editor coexists with Guitar Keyboard and keeps mode-specific navigation`,()=>{
  const {options,events}=setup();
  for(const name of ['segapsg','rf5c164','pwm','gameboy','nes','snes','ym2151','okim6258','huc6280','wonderswan','pokey','dx7','ym3812','ym3526','y8950','ymf262','ym2413','ay8910']) {
    options[`${name}Panel`]={};options[`${name}Tab`]={setAttribute(){},focus(){this.focused=true;}};
  }
  const ui=createPlaygroundUi({...options,chipTabs:[kind]});
  ui.setBottomTab(kind);
  assert.equal(options.keyboardPanel.hidden,false,'voice editors show compact audition before selecting the lower Keyboard');
  ui.setDockVisible(false);
  assert.equal(options.keyboardPanel.hidden,false,'compact audition remains available with the dock closed');
  ui.setBottomTab('code');
  assert.equal(options.keyboardPanel.hidden,true,'leaving the editor hides compact audition');
  ui.setBottomTab(kind);ui.setBottomTab('keyboard');
  assert.equal(options[`${kind}Panel`].hidden,false);assert.equal(options.keyboardPanel.hidden,false);
  assert.equal(options.operatorTabButton.hidden,true);assert.equal(options[`${kind==='nes'?'gameboy':'nes'}Tab`].hidden,true);
  ui.moveBottomTabFocus(options.codeTab,1);assert.equal(options[`${kind}Tab`].focused,true);
  ui.moveBottomTabFocus(options[`${kind}Tab`],1);assert.equal(options.codeTab.focused,true);
  assert.equal(events.at(-1).primaryTab,'code');
});

test('compact layouts float Keyboard for the selected playable chip and exclude streamed PWM', () => {
  const {options} = setup();
  for (const name of ['gameboy','ym2151','pokey','pwm']) {
    options[`${name}Panel`] = {classList:classes()};
    options[`${name}Tab`] = {setAttribute() {}};
  }
  const ui = createPlaygroundUi({...options,dockedPanels:false,chipTabs:['operator','gameboy','ym2151','pokey','pwm']});
  for (const name of ['operator','gameboy','ym2151','pokey']) {
    ui.setBottomTab(name);
    assert.equal(options.keyboardPanel.hidden,false);
    assert.equal(options.keyboardPanel.classList.contains('is-floating-keyboard'),true);
    for (const other of ['operator','gameboy','ym2151','pokey']) {
      assert.equal(options[`${other}Panel`].classList.contains('has-floating-keyboard'),other === name);
    }
  }
  ui.setBottomTab('pwm');
  assert.equal(options.keyboardPanel.hidden,true);
  assert.equal(options.keyboardPanel.classList.contains('is-floating-keyboard'),false);
  ui.setBottomTab('keyboard');
  assert.equal(options.keyboardPanel.hidden,false);
  assert.equal(options.keyboardPanel.classList.contains('is-floating-keyboard'),false,'the full Keyboard uses its normal placement');
});

test('workbench moves one shared Keyboard between chip overlays and the selected lower dock', () => {
  const nodes = new Map();
  const makeNode = () => ({className:'',classList:classes(),children:[],attributes:{},clientHeight:1000,hidden:false,
    style:{setProperty() {}},setAttribute(name,value) {this.attributes[name] = value;},addEventListener() {},
    appendChild(child) {
      if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(node => node !== child);
      this.children.push(child); child.parentElement = this; return child;
    },
    append(...children) {for (const child of children) this.appendChild(child);},
    prepend(child) {this.appendChild(child); this.children = [child,...this.children.filter(node => node !== child)];},
  });
  for (const name of ['fileExplorer','fileExplorerDivider','shellActions',
    ...['audioMonitor','fxMonitor','mixer','console','shell','keyboard','helpers'].flatMap(name => [`${name}Tab`,`${name}Panel`]),
    ...['code','operator','segapsg','rf5c164','pwm','gameboy','nes','snes','ym2151','okim6258','huc6280','wonderswan','pokey','dx7','ym3812','ym3526','y8950','ymf262','ym2413','ay8910'].map(name => `${name}Panel`)]) nodes.set(name,makeNode());
  const tabbar = makeNode(), root = makeNode(); root.querySelector = () => tabbar;
  const previousDocument = globalThis.document, previousResizeObserver = globalThis.ResizeObserver;
  globalThis.document = {createElement:makeNode,getElementById:name => nodes.get(name)};
  globalThis.ResizeObserver = class {observe() {} disconnect() {}};
  let workbench;
  try {
    workbench = installPlaygroundWorkbench(root,{storage:null,search:'?mode=gameboy'});
    const keyboard = nodes.get('keyboardPanel'), dock = keyboard.parentElement;
    for (const name of ['operator','segapsg','rf5c164','gameboy','nes','snes','ym2151','okim6258','huc6280','wonderswan','pokey','dx7','ym3812','ym3526','y8950','ymf262','ym2413','ay8910']) {
      workbench.sync({primaryTab:name,bottomTab:'console',dockOpen:true});
      assert.notEqual(keyboard.parentElement,dock,`${name}: compact controls belong outside the dock`);
      assert.equal(keyboard.classList.contains('is-floating-keyboard'),true);
      assert.equal(nodes.get(`${name}Panel`).classList.contains('has-floating-keyboard'),true);
      workbench.sync({primaryTab:name,bottomTab:'console',dockOpen:false});
      assert.equal(keyboard.parentElement.hidden,false,`${name}: closing the dock cannot hide the floating host`);
      workbench.sync({primaryTab:name,bottomTab:'keyboard',dockOpen:true});
      assert.equal(keyboard.parentElement,dock,`${name}: the full lower Keyboard takes precedence`);
      assert.equal(keyboard.classList.contains('is-floating-keyboard'),false);
      assert.equal(nodes.get(`${name}Panel`).classList.contains('has-floating-keyboard'),false);
      workbench.sync({primaryTab:name,bottomTab:'console',dockOpen:true});
      workbench.sync({primaryTab:'code',bottomTab:'console',dockOpen:true});
      assert.equal(keyboard.parentElement,dock,`${name}: returning to Code restores the normal host`);
      assert.equal(keyboard.classList.contains('is-floating-keyboard'),false);
      assert.equal(nodes.get(`${name}Panel`).classList.contains('has-floating-keyboard'),false);
    }
    workbench.sync({primaryTab:'pwm',bottomTab:'console',dockOpen:true});
    assert.equal(keyboard.parentElement,dock,'PWM streaming has no automatic pitched overlay');
    assert.equal(keyboard.classList.contains('is-floating-keyboard'),false);
    assert.equal(nodes.get('pwmPanel').classList.contains('has-floating-keyboard'),false);
  } finally {
    workbench?.dispose(); globalThis.document = previousDocument; globalThis.ResizeObserver = previousResizeObserver;
  }
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
