import test from 'node:test';
import assert from 'node:assert/strict';
import {CommandEditor} from './command_editor.js';
function source(commands,loop=0){const b=new Uint8Array(256+commands.length+8),v=new DataView(b.buffer);b.set([86,103,109,32]);v.setUint32(8,0x171,true);v.setUint32(0x34,0xcc,true);v.setUint32(4,b.length-4,true);if(loop)v.setUint32(0x1c,256+loop-0x1c,true);b.set(commands,256);b.fill(0xaa,256+commands.length);return b;}
test('register edits, undo and restore keep bytes, offsets and tail intact',async()=>{
 const b=source([0x52,0x22,8,0x61,20,0,0x66]),m=new CommandEditor(b);m.page(0);
 m.edit(256,31);const out=await m.build();assert.equal(out[258],31);assert.equal(b[258],8);out[258]=8;assert.deepEqual(out,b);
 assert.throws(()=>m.edit(257,1),/boundary/);assert.throws(()=>m.edit(256,256),/range/);assert.throws(()=>m.edit(262,1),/read only/);
 m.undo();assert.deepEqual(await m.build(),b);m.edit(256,32);m.reset();assert.deepEqual(await m.build(),b);
});
test('wait changes recompute total and loop samples without moving loop or metadata',async()=>{
 const b=source([0x61,10,0,0x61,20,0,0x62,0x63,0x70,0x83,0x66],3),m=new CommandEditor(b);m.page(0);m.edit(256,100);m.edit(259,200);
 const out=await m.build(),v=new DataView(out.buffer);assert.equal(v.getUint32(0x18,true),100+200+735+882+1+3);assert.equal(v.getUint32(0x20,true),200+735+882+1+3);assert.equal(v.getUint32(0x1c,true),new DataView(b.buffer).getUint32(0x1c,true));assert.deepEqual(out.slice(262),b.slice(262));
});
test('large data blocks are skipped, pages and history remain compact',async()=>{
 const payload=1024*1024,cmd=new Uint8Array(7+payload+600+1);cmd.set([0x67,0x66,0]);new DataView(cmd.buffer).setUint32(3,payload,true);for(let p=7+payload;p<cmd.length-1;p+=3)cmd.set([0x52,0x22,8],p);cmd[cmd.length-1]=0x66;
 const m=new CommandEditor(source(cmd)),page=m.page(0);assert.equal(page.rows.length,100);assert(page.rows[0].preview.length<100);assert.equal(page.rows[0].writable,false);assert.equal(m.starts.length,2);
 assert.equal(m.page(1).rows.length,100);const final=m.page(2);assert.equal(final.rows.length,2);assert.equal(final.more,false);
 const offset=263+payload;for(let i=0;i<1100;i++)m.edit(offset,i%256);assert.equal(m.edits.size,1);assert.equal(m.history.length,1000);
 assert.deepEqual((await m.build()).slice(263,263+payload),cmd.slice(7,7+payload));
});
test('truncated and unrecognized streams cannot be timed by guessing',async()=>{
 const b=source([0x61,20,0,0x64,0x66]),m=new CommandEditor(b);m.edit(256,30);await assert.rejects(m.build(),/Unsupported/);
 const truncated=source([0x67,0x66,0,255,255,255,127]);assert.throws(()=>new CommandEditor(truncated).page(0),/Truncated/);
});

test('editor UI pages, applies, undoes and restores without losing staged original',async()=>{
 const {mountCommandEditor}=await import('./command_editor.js');
 class Element {
  constructor(){this.style={};this.children=[];this.handlers={};this.textContent='';this.value='';this.disabled=false;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(){}
  addEventListener(name,fn){this.handlers[name]=fn;}
  reportValidity(){return this.value!==''&&Number.isInteger(Number(this.value))&&Number(this.value)>=0&&Number(this.value)<=Number(this.max);}
 }
 const nodes=Object.fromEntries(['prev','next','page','undo','reset','apply','save','state','tbody'].map(k=>[k,new Element()]));
 const root=new Element();root.querySelector=s=>s==='tbody'?nodes.tbody:nodes[s.slice(6,-1)];root.querySelectorAll=()=>['prev','next','undo','reset','apply','save'].map(k=>nodes[k]);
 const previous=globalThis.document,applied=[];globalThis.document={createElement:()=>new Element()};
 try{
  const ui=mountCommandEditor(root,{onApply:async bytes=>applied.push(bytes),setStatus(){}});
  assert(nodes.apply.disabled);
  const b=source([...Array.from({length:110},()=>[0x52,0x22,8]).flat(),0x66]);ui.load(b,'test.vgz');
  assert.equal(nodes.tbody.children.length,100);assert(nodes.prev.disabled);
  const input=nodes.tbody.children[0].children[3].children[0];input.value='24';input.handlers.change();
  await nodes.apply.onclick();assert.equal(applied[0][258],24);assert.equal(b[258],8);assert.match(nodes.state.textContent,/Applied/);
  nodes.next.onclick();assert.equal(nodes.tbody.children.length,11);assert(nodes.next.disabled);
  nodes.undo.onclick();await nodes.apply.onclick();assert.deepEqual(applied[1],b);
  nodes.prev.onclick();const edited=nodes.tbody.children[0].children[3].children[0];edited.value='42';edited.handlers.change();nodes.reset.onclick();await nodes.apply.onclick();assert.deepEqual(applied[2],b);
  ui.load(null);assert(nodes.apply.disabled);assert.equal(nodes.tbody.children.length,0);
 }finally{globalThis.document=previous;}
});
