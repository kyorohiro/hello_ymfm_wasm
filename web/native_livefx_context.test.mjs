import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {encodeNativeLiveFxContext as encode,decodeNativeLiveFxContext as decode} from './native_livefx_context.js';
const roundtrip=value=>decode(JSON.parse(JSON.stringify(encode(value))));

test('context graph preserves cycles, aliases, collections, sparse arrays and special primitive values',()=>{
  const key={name:'key'},array=new Array(4);array[2]=undefined;array.label='sparse';
  const context={array,key,alias:key,undef:undefined,big:-(2n**70n),negativeZero:-0,nan:NaN,pos:Infinity,neg:-Infinity,
    date:new Date('2026-10-21T00:00:00Z'),invalidDate:new Date(NaN),regexp:/a+b/gi};
  context.self=context;context.map=new Map([[key,context],[context,array]]);context.set=new Set([key,context]);
  const result=roundtrip(context);
  assert.deepEqual(result,structuredClone(context));
  assert.equal(result.self,result);assert.equal(result.key,result.alias);assert.equal(result.map.get(result.key),result);
  assert(result.set.has(result));assert(!Object.hasOwn(result.array,0));assert(Object.hasOwn(result.array,2));
  assert(Object.is(result.negativeZero,-0));
});

test('typed views preserve shared buffers, byte offsets, precision, signed and BigInt samples',()=>{
  const buffer=new ArrayBuffer(64),context={buffer};
  const constructors=[Int8Array,Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,BigInt64Array,BigUint64Array];
  for(const Type of constructors)context[Type.name]=new Type(buffer,8,2);
  context.view=new DataView(buffer,3,20);context.same=context.Float32Array;
  new Uint8Array(buffer).set(Array.from({length:64},(_,i)=>i*3));
  const result=roundtrip(context);assert.deepEqual(result,structuredClone(context));
  for(const Type of constructors)assert.equal(result[Type.name].buffer,result.buffer);
  assert.equal(result.view.buffer,result.buffer);assert.equal(result.same,result.Float32Array);
  result.view.setUint8(5,99);assert.equal(new Uint8Array(result.buffer)[8],99);
});

test('encoding snapshots caller context and uses structured-clone semantics for class instances',()=>{
  class Settings{constructor(){this.gain=.5;this.values=new Float32Array([1,2]);}}
  const original=new Settings(),wire=encode(original);original.gain=0;original.values[0]=9;
  const result=decode(wire);assert.equal(result.gain,.5);assert.deepEqual(result.values,new Float32Array([1,2]));
  assert.equal(Object.getPrototypeOf(result),Object.prototype);
});

test('an own __proto__ key stays a data property without modifying any prototype',()=>{
  const context=JSON.parse('{"__proto__":{"nativeLiveFxPolluted":true},"gain":0.5}');
  const result=roundtrip(context);
  assert(Object.hasOwn(result,'__proto__'));assert.equal(result.__proto__.nativeLiveFxPolluted,true);
  assert.equal(Object.getPrototypeOf(result),Object.prototype);assert.equal({}.nativeLiveFxPolluted,undefined);
});

test('unsupported cloned values fail explicitly instead of becoming empty JSON objects',()=>{
  for(const context of [null,[],1,{fn(){}},{value:Symbol('x')},{weak:new WeakMap()},{error:new Error('x')}])assert.throws(()=>encode(context));
  if(typeof SharedArrayBuffer!=='undefined')assert.throws(()=>encode({buffer:new SharedArrayBuffer(4)}),/Unsupported/);
  if(typeof Blob!=='undefined')assert.throws(()=>encode({blob:new Blob(['x'])}),/Unsupported/);
});

test('byte, node, nesting and sparse-array bounds are enforced before decoding allocations',()=>{
  assert.throws(()=>encode({x:'a'.repeat(1000)},{maxBytes:512}),/limit/);
  assert.throws(()=>encode({a:{},b:{}},{maxNodes:2}),/node limit/);
  assert.throws(()=>encode({array:new Array(2**24)}),/byte limit/);
  const root={};let cursor=root;for(let i=0;i<520;i++)cursor=cursor.next={};
  assert.throws(()=>encode(root),/nesting limit/);
  const wire=encode({array:[]});wire.nodes[1].length=2**30;
  assert.throws(()=>decode(wire),/Invalid/);
  for(const maxBytes of [0,-1,Infinity])assert.throws(()=>encode({},{maxBytes}),/limits/);
});

test('malformed references, buffers and object entries cannot be decoded',()=>{
  const invalid=[
    {version:2,root:{ref:0},nodes:[{type:'Object',entries:[]}]},
    {version:1,root:{ref:1},nodes:[]},
    {version:1,root:{ref:0},nodes:[{type:'Unknown'}]},
    {version:1,root:{ref:0},nodes:[{type:'Object',entries:[['x',{ref:-1}]]}]},
    {version:1,root:{ref:0},nodes:[{type:'Object',entries:[['x',1],['x',2]]}]},
    {version:1,root:{ref:0},nodes:[{type:'ArrayBuffer',bytes:[256]}]},
    {version:1,root:{ref:0},nodes:[{type:'ArrayBuffer',bytes:[-1]}]},
    {version:1,root:{ref:0},nodes:[{type:'Float32Array',buffer:{ref:1},offset:1,length:2},{type:'ArrayBuffer',bytes:[0,0,0,0]}]},
    {version:1,root:{ref:0},nodes:[{type:'Object',entries:[['x',{number:'bad'}]]}]},
    {version:1,root:{ref:0},nodes:[{type:'Object',entries:[['x',{bigint:'not bigint'}]]}]},
    {version:1,root:{ref:0},nodes:[{type:'Object',entries:[['x',{ref:0,other:true}]]}]},
  ];
  for(const graph of invalid)assert.throws(()=>decode(graph),/Invalid/);
});

test('the exact decoder function runs in a separate JS realm without imports or host globals',()=>{
  const context={samples:new Float32Array([.25,.5]),gain:.75,map:new Map([['value',2n]])};context.self=context;
  const standalone=vm.runInNewContext(`(${decode.toString()})`),result=standalone(encode(context));
  assert.equal(result.self,result);assert.equal(result.samples[1],.5);assert.equal(result.map.get('value'),2n);
  assert.equal(result.samples.constructor.name,'Float32Array');
});
