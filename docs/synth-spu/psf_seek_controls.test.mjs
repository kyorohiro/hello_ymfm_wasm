import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePsfTagTime,psfSeekRange,setupPsfSeekControls} from './psf_seek_controls.js';

test('PSF time hints parse complete seconds, minute and hour forms without accepting ambiguous tags',()=>{
  for(const [text,seconds]of [['62.125',62.125],['1:02.125',62.125],['00:01:05.5',65.5],[' 0:00 ',0]])assert.equal(parsePsfTagTime(text),seconds);
  for(const text of [null,'','1:60','1:60:00','1:2x','1e3','-1','1:02\n2:03','1:02\n','Infinity','0x10','2::03','1:2:3:4'])assert.equal(parsePsfTagTime(text),null,String(text));
});
test('length and fade are range hints and unknown duration never becomes a fabricated song length',()=>{
  assert.deepEqual(psfSeekRange(new Map([['length','2:30'],['fade','0:10']])),{maxSeconds:160,hintSeconds:160,kind:'tags'});
  assert.deepEqual(psfSeekRange(new Map([['length','2:30'],['fade','10\n20']])),{maxSeconds:150,hintSeconds:150,kind:'tags'});
  assert.deepEqual(psfSeekRange(new Map()),{maxSeconds:300,hintSeconds:null,kind:'window'});
  assert.deepEqual(psfSeekRange(new Map(),301),{maxSeconds:360,hintSeconds:null,kind:'window'});
});
test('the seek limit bounds tag hints and unknown windows, including beyond a declared tag duration',()=>{
  assert.deepEqual(psfSeekRange(new Map([['length','60:00']]),0,1800),{maxSeconds:1800,hintSeconds:3600,kind:'limit'});
  assert.equal(psfSeekRange(new Map(),2000,1800).maxSeconds,1800);
  assert.equal(psfSeekRange(new Map([['length','0:10']]),15).maxSeconds,10);
});

function controls(t) {
  const nodes=new Map();
  for(const id of ['psfSongSeek','psfSongPosition','psfSeekProgress','psfSeekCancel','psfSongPlayer']) {
    const events=new Map();nodes.set(id,{id,value:'0',dataset:{},setAttribute(){},blur(){},
      addEventListener(type,fn){events.set(type,fn);},removeEventListener(type){events.delete(type);},
      fire(type,event={}){events.get(type)?.({preventDefault(){},stopPropagation(){},...event});}});
  }
  let state={selection:{entry:'song.psf'},canSeek:true,positionSeconds:0,seekMaxSeconds:1800};const seeks=[];
  const ui=setupPsfSeekControls({document:{getElementById:id=>nodes.get(id)},read:()=>state,
    async seek(target){seeks.push(target);state={...state,positionSeconds:target};},cancelSeek:async()=>true});
  t.after(()=>ui.dispose());
  return {ui,seeks,range:nodes.get('psfSongSeek'),position:nodes.get('psfSongPosition'),
    update(positionSeconds){state={...state,positionSeconds};ui.update(state);}};
}
test('a thumb click without movement does not seek or pin the unknown-duration window',async t=>{
  const f=controls(t);assert.equal(f.range.max,'300');
  f.range.fire('pointerdown',{button:0});f.range.fire('pointerup');f.update(301);
  assert.equal(f.range.max,'360');assert.deepEqual(f.seeks,[]);
  f.range.fire('pointerdown',{button:0});f.range.fire('blur');f.update(601);
  assert.equal(f.range.max,'660');assert.deepEqual(f.seeks,[]);
});
test('drag input keeps the real cursor, cancel discards the draft, and release commits only once',async t=>{
  const f=controls(t);f.range.fire('pointerdown',{button:0});f.range.value='4.25';f.range.fire('input');
  assert.equal(f.position.dataset.seconds,'0');assert.deepEqual(f.seeks,[]);
  f.update(1);assert.equal(f.range.value,'4.25');f.range.fire('pointercancel');assert.equal(f.range.value,'1');
  f.range.value='3.5';f.range.fire('input');f.range.fire('change');f.range.fire('pointerup');
  await Promise.resolve();await Promise.resolve();assert.deepEqual(f.seeks,[3.5]);assert.equal(f.position.dataset.seconds,'3.5');
});
test('Escape discards a keyboard draft and arrow release alone commits a new position',async t=>{
  const f=controls(t);f.range.fire('keydown',{key:'ArrowRight',shiftKey:true});assert.equal(f.range.value,'10');
  assert.deepEqual(f.seeks,[]);f.range.fire('keydown',{key:'Escape'});f.range.fire('keyup',{key:'ArrowRight'});
  assert.deepEqual(f.seeks,[]);assert.equal(f.range.value,'0');
  f.range.fire('keydown',{key:'ArrowRight'});f.range.fire('keyup',{key:'ArrowRight'});
  await Promise.resolve();await Promise.resolve();assert.deepEqual(f.seeks,[1]);
});
