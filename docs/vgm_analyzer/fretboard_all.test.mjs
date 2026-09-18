import test from 'node:test';
import assert from 'node:assert/strict';
import {renderAllFretboard} from './fretboard_all.js';
const position={stringIndex:4,fret:5};
const layer=(label,note=64)=>({label,note,keyOn:true,history:[],activePositions:new Map([[note,position]])});
test('all channels share one board with distinct sectors for a unison',()=>{
 const svg=renderAllFretboard([layer('CH2'),layer('CH3'),layer('SSG 1')],6);
 assert.equal((svg.match(/<svg /g)||[]).length,1);
 assert.equal((svg.match(/data-all-note=/g)||[]).length,1);
 assert.equal((svg.match(/data-all-source=/g)||[]).length,3);
 for(const label of ['CH2','CH3','SSG 1'])assert.ok(svg.includes(label));
});
test('all-board retains fading released notes, drops expired ghosts, reports range',()=>{
 const layers=[
 {...layer('CH2'),keyOn:false,activePositions:new Map(),history:[
  {note:64,position,ageMs:1000},{note:65,position:{stringIndex:4,fret:6},ageMs:2600}]},
 {...layer('CH6',110),activePositions:new Map()},
 ];
 const svg=renderAllFretboard(layers,6);
 assert.equal((svg.match(/data-all-ghost=/g)||[]).length,1);
 assert.match(svg,/Outside range: CH6/);
 assert.doesNotMatch(svg,/NaN|undefined/);
});
test('all-board distinguishes the same pitch at different positions and escapes labels',()=>{
 const a=layer('<CH2>'),b=layer('CH3');
 b.activePositions=new Map([[64,{stringIndex:5,fret:0}]]);
 const svg=renderAllFretboard([a,b],6);
 assert.equal((svg.match(/data-all-note=/g)||[]).length,2);
 assert.match(svg,/&lt;CH2&gt;/);assert.doesNotMatch(svg,/<CH2>/);
});
test('a layer on the "9" fallback string grows the shared board so its mark lands on a real row',()=>{
 const fallback={...layer('Bass',27),activePositions:new Map([[27,{stringIndex:-1,fret:2}]])};
 const svg=renderAllFretboard([fallback,layer('Lead')],8);
 assert.match(svg,/9 C#1\*/);
 const rowY=svg.match(/9 C#1\*<\/text>\s*<line[^>]*y1="(\d+)"/)?.[1];
 const noteMatch=svg.match(/data-all-note="27">[\s\S]*?cy="(\d+)"/);
 assert.ok(rowY && noteMatch, 'expected both the "9" row and the note mark to be present');
 assert.equal(noteMatch[1], rowY, 'the note must sit exactly on the "9" row, not off-board');
});
