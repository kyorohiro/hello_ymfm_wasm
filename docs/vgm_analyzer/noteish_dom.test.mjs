import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {updateNoteishGraph,updateNoteishHtml} from './noteish_dom.js';
function node(){return {writes:0,attrs:0,value:'',set innerHTML(v){this.writes++;this.value=v;},get innerHTML(){return this.value;},setAttribute(k,v){this.attrs++;this[k]=v;}};}
test('graph retains viewport, static SVG and history node; identical layers do not rewrite',()=>{
 const viewport=node(),range=node(),current=node(),history=node();viewport.querySelector=s=>s.includes('range')?range:s.includes('current')?current:history;
 Object.defineProperty(viewport,'scrollLeft',{get:()=>123,set(){assert.fail('scroll changed');}});
 let calls=[];let parts={range:'range',current:'note',history:'M1,2L2,3'};
 const render=dynamic=>{calls.push(dynamic);return dynamic?parts:'static keys';};
 updateNoteishGraph(viewport,'pitch',render);updateNoteishGraph(viewport,'pitch',render);updateNoteishGraph(viewport,'pitch',render);
 assert.deepEqual(calls,[false,true,true]);assert.equal(viewport.writes,1);assert.equal(range.writes,1);assert.equal(current.writes,1);assert.equal(history.attrs,1);
 parts={...parts,history:'M2,2L3,3'};updateNoteishGraph(viewport,'pitch',render);assert.equal(history.attrs,2);assert.equal(range.writes,1);assert.equal(viewport.scrollLeft,123);
 updateNoteishGraph(viewport,'keyboard',render);assert.equal(viewport.writes,2);
 updateNoteishGraph(viewport,'fretboard',()=> 'board A');updateNoteishGraph(viewport,'fretboard',()=> 'board B');
 updateNoteishGraph(viewport,'keyboard',render);updateNoteishGraph(viewport,'fretboard',()=> 'board A');updateNoteishGraph(viewport,'fretboard',()=> 'board B');assert.equal(viewport.innerHTML,'board B');
});
test('metadata only reparses when its content changes',()=>{const n=node();updateNoteishHtml(n,'same');updateNoteishHtml(n,'same');assert.equal(n.writes,1);updateNoteishHtml(n,'new');assert.equal(n.writes,2);});
const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
const fn=name=>{const a=source.indexOf(`function ${name}(`);return source.slice(a,source.indexOf('\n}',a)+2);};
test('keyboard dynamic updates skip all 73 keys and preserve range, key-off color and out-of-range behavior',()=>{
 let labels=0;const c=vm.createContext({NOTEISH_GRAPH_MIN_MIDI:24,NOTEISH_GRAPH_MAX_MIDI:96,midiToNoteName:n=>{labels++;return String(n);},clamp:(v,l,h)=>Math.max(l,Math.min(h,v))});
 vm.runInContext(fn('renderNoteishKeyboard'),c);
 const channel={keyOn:true,noteMinMidi:20,noteMaxMidi:110},note={midiFloat:60,note:'C4'};
 const full=c.renderNoteishKeyboard(channel,note);assert.equal(labels,73);assert.equal((full.match(/<rect /g)||[]).length,73);
 const parts=c.renderNoteishKeyboard(channel,note,true);assert.equal(labels,73);assert.match(parts.current,/#007c91/);assert(full.includes(parts.range));
 channel.keyOn=false;assert.match(c.renderNoteishKeyboard(channel,note,true).current,/#777/);
 assert.equal(c.renderNoteishKeyboard(channel,{midiFloat:120,note:'high'},true).current,'');
 assert.equal(c.renderNoteishKeyboard(channel,{midiFloat:null,note:'off'},true).current,'');
});
