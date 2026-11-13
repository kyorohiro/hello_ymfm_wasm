import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthFmEdits} from './synth_fm_edits.js';
import {YM2612Synth} from '../js/ym2612synth.js';

function host(objectProtocol=false){
  const writes=[],transport={write:objectProtocol?function(command){writes.push([command.port,command.register,command.value]);}
    :function(port,register,value){writes.push([port,register,value]);},reset(){writes.push('reset');}};
  const synth=new YM2612Synth({transport});writes.length=0;
  const observer=createSynthFmEdits(synth);return {synth,observer,writes,transport};
}

for(const objectProtocol of [false,true])test(`Code raw writes keep packed companions on sparse editor changes (${objectProtocol?'object':'three-argument'} transport)`,()=>{
  const {synth,observer,writes}=host(objectProtocol);
  try{
    synth.rawWrite(1,0x31,0x72);synth.write(1,0x51,0xa1);synth.write(1,0x61,0x9b);synth.write(1,0x81,0xc6);
    synth.write(1,0xb1,0x15);synth.write(1,0xb5,0x95);synth.write(0,0x22,0x0d);
    const count=writes.length;
    observer.apply(4,{'operators.1.multi':3,'operators.1.ar':12,'operators.1.d1r':2,'operators.1.rr':7,feedback:7,pms:2,'lfo.frequency':1});
    assert.deepEqual(writes.slice(count),[[1,0x31,0x73],[1,0x51,0x8c],[1,0x61,0x82],[1,0x81,0xc7],[1,0xb1,0x3d],[1,0xb5,0x92],[0,0x22,9]]);
    assert.equal(synth.channels[4].operators[0].dt,7);assert.equal(synth.channels[4].algorithm,5);assert.equal(synth.channels[4].left,true);
    assert.equal(synth.lfo.enabled,true);assert.equal(observer.read().channels[4].preset.pms,2);
  }finally{observer.dispose();}
});

test('high-level Code changes and raw writeAddress/writeData use the same observation',()=>{
  const {synth,observer,writes}=host();try{
    synth.setAlgo(0,4,2);synth.setPan(0,false,true,3,5);synth.setLfo(true,6);
    observer.apply(0,{feedback:7,pms:2,'lfo.enabled':false});
    assert.deepEqual(writes.slice(-3),[[0,0xb0,0x3c],[0,0xb4,0x72],[0,0x22,6]]);
    synth.writeAddress(0,0x38);synth.writeData(0x51);
    observer.apply(0,{'operators.2.multi':4});assert.deepEqual(writes.at(-1),[0,0x38,0x54]);
  }finally{observer.dispose();}
});

test('one knob never resets, rewrites frequencies or replaces other OPs',()=>{
  const {synth,observer,writes}=host();try{
    assert.deepEqual(writes,[],'install has no physical side effects');
    synth.setFrequency(2,4,1000);const count=writes.length;
    observer.apply(2,{'operators.3.tl':25});assert.deepEqual(writes.slice(count),[[0,0x46,25]]);
    assert.equal(synth.channels[2].fnum,1000);
  }finally{observer.dispose();}
});

test('invalid compound edits fail before any write, and key controls retain their own interface',()=>{
  const {observer,writes}=host();try{
    for(const changes of [{feedback:2,'operators.4.ar':32},{algorithm:2,'pan.left':1},{keyMask:4},{'gates.1':true}]){
      assert.throws(()=>observer.apply(0,changes));assert.deepEqual(writes,[]);
    }
    assert.equal(observer.apply(0,{}),false);
  }finally{observer.dispose();}
});

test('transport reset clears shadow; disposal restores both protocols without a reset',()=>{
  const {synth,observer,writes,transport}=host(true);const wrapped=transport.write;
  synth.write(0,0x30,0x71);synth.reset();observer.apply(0,{'operators.1.multi':2});
  assert.deepEqual(writes.at(-1),[0,0x30,2]);const count=writes.length;
  observer.dispose();observer.dispose();assert.notEqual(transport.write,wrapped);assert.equal(writes.length,count);
  synth.write(0,0x30,5);assert.deepEqual(writes.at(-1),[0,0x30,5]);assert.throws(()=>observer.apply(0,{feedback:1}),/disposed/);
});
