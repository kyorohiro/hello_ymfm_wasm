import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./vgm_analyzer.js', import.meta.url), 'utf8');
function monitor(kind, clock = 0x80000000) {
  const history = [], sequence = [];
  const state = () => ({fnum:0, block:0, keyOn:true, changedAt:{},
    specialFrequencies:{1:{changedAt:{}},2:{changedAt:{}},3:{changedAt:{}}}});
  const context = vm.createContext({
    settleNoteishOnset(){}, beginNoteishOnset(){},
    currentChipKind:kind, noteishHeader:{ym2610Clock:clock},
    channelMonitor:Array.from({length:6}, state), monitorFrequencyHigh:[0,0],
    performance:{now:()=>0},
    updateChannelObservedRange(){}, requestChannelMonitorRender(){}, requestNoteishRender(){},
    estimateChannelNoteish:s=>({midiFloat:[s.block,s.fnum]}),
    recordChannelNoteHistory:(ch,pitch)=>history.push([ch,...pitch]),
    appendChannelNoteSequence:(ch,pitch)=>sequence.push([ch,...pitch]),
  });
  for (const name of ['applyYm2203WriteToMonitor','applyYm2612WriteToMonitor','decodeKeyOnChannel']) {
    const start = source.indexOf('function '+name+'(');
    const end = source.indexOf('\n}',start)+2;
    vm.runInContext(source.slice(start,end),context);
  }
  return {context,history,sequence,
    write:(reg,value,port=0)=>kind==='ym2203'
      ? context.applyYm2203WriteToMonitor(reg,value)
      : context.applyYm2612WriteToMonitor(port,reg,value)};
}

for (const kind of ['ym2203','ym2608','ym2610','ym2612']) {
  test(kind+' monitor adds history only at low commits, retaining real short pitches',()=>{
    for (const low of [0x21,0xb6]) {
      const m=monitor(kind);
      m.write(0xa5,0x23); m.write(0xa1,low);
      m.write(0xa5,0x2b);
      assert.deepEqual(m.history,[[1,4,0x300|low]]);
      m.write(0xa1,0xc6);
      assert.deepEqual(m.history,[[1,4,0x300|low],[1,5,966]]);
      m.write(0xa1,low); m.write(0xa1,0xc6);
      assert.deepEqual(m.history.slice(2),[[1,5,0x300|low],[1,5,966]]);
      assert.deepEqual(m.sequence,m.history);
    }
  });
}

test('monitor shares high across channels/ports and isolates the special latch',()=>{
  const m=monitor('ym2612');
  m.write(0xa4,0x23);
  m.write(0xa5,0x2b,1);
  m.write(0xac,0x12);
  m.write(0xa1,0xc6);
  m.write(0xa8,0x45);
  assert.deepEqual(m.history,[[1,5,966]]);
  assert.equal(m.context.channelMonitor[2].specialFrequencies[3].fnum,0x245);
  assert.equal(m.context.channelMonitor[2].specialFrequencies[3].block,2);
});

test('YM2610 high on a disabled FM channel still supplies the shared latch',()=>{
  const m=monitor('ym2610',8000000);
  m.write(0xa4,0x2b); m.write(0xa1,0xc6);
  assert.deepEqual(m.history,[[1,5,966]]);
});

test('overview labels retain hardware channels after unavailable channels are removed',()=>{
  for (const indices of [[1,2,4,5],[0,1,2,3,4,5]]) {
    const channels=indices.map(channel=>({channel,noteHistory:[{time:0,midiFloat:60+channel}]}));
    channels.push({channel:0,label:'YM2610 SSG 1',noteHistory:[]});
    const context=vm.createContext({
      noteishMode:{value:'compact'}, performance:{now:()=>0},
      noteishChannels:()=>channels,pruneChannelNoteHistory(){},
      noteishOverviewY:n=>n,clamp:(n,min,max)=>Math.max(min,Math.min(max,n)),
      NOTEISH_HISTORY_WINDOW_MS:8000,noteishOverview:{innerHTML:''},
    });
    const start=source.indexOf('function renderNoteishOverviewGraph()');
    vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);
    context.renderNoteishOverviewGraph();
    const html=context.noteishOverview.innerHTML;
    assert.deepEqual([...html.matchAll(/>CH(\d)<\/text>/g)].map(m=>Number(m[1])),indices.map(i=>i+1));
    assert.match(html,/>YM2610 SSG 1<\/text>/);
    assert.equal((html.match(/<circle /g)??[]).length,indices.length*2);
  }
});

function onsetMonitor() {
  const m=monitor('ym2610');
  const c=m.context;
  c.player={processedWaitSamples:0};
  c.NOTEISH_HISTORY_WINDOW_MS=8000;
  c.midiToNoteName=n=>String(n);
  for(const ch of c.channelMonitor) Object.assign(ch,{
    keyOn:false,noteHistory:[],noteSequence:[],lastSequenceNote:null,
    noteMinMidi:null,noteMaxMidi:null,
  });
  c.estimateChannelNoteish=s=>({midiFloat:s.fnum || null});
  c.updateChannelObservedRange=i=>{
    const ch=c.channelMonitor[i];
    ch.noteMinMidi=Math.min(ch.noteMinMidi??Infinity,ch.fnum);
    ch.noteMaxMidi=Math.max(ch.noteMaxMidi??-Infinity,ch.fnum);
  };
  for(const name of ['beginNoteishOnset','settleNoteishOnset','pruneChannelNoteHistory',
      'recordChannelNoteHistory','noteNameFromMidiFloat','appendChannelNoteSequence']) {
    const start=source.indexOf('function '+name+'(');
    vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),c);
  }
  return m;
}

test('Note-ish shared graph/fretboard history omits only the short stale onset pitch',()=>{
  for(const gap of [0,4,5,8,9,100]) {
    const m=onsetMonitor(),ch=m.context.channelMonitor[1];
    m.write(0xa5,0x2b);m.write(0xa1,0x9e); // old FNUM 926
    m.write(0x28,0xf1);
    m.context.player.processedWaitSamples=gap;
    m.write(0xa5,0x2b);m.write(0xa1,0x0b); // new FNUM 779
    assert.deepEqual(Array.from(ch.noteHistory,p=>p.midiFloat),gap<=8?[779]:[926,779]);
    assert.deepEqual(Array.from(ch.noteSequence),gap<=8?['779']:['926','779']);
    // A second real low commit is retained even one sample later.
    m.context.player.processedWaitSamples++;
    m.write(0xa1,0xc6);
    assert.equal(ch.noteHistory.at(-2).midiFloat,779);
    assert.equal(ch.noteHistory.at(-1).midiFloat,966);
  }
});

test('Note-ish keeps onset when no pitch follows and keeps held-key retriggers',()=>{
  const m=onsetMonitor(),ch=m.context.channelMonitor[1];
  m.write(0xa5,0x2b);m.write(0xa1,0x9e);m.write(0x28,0xf1);
  assert.deepEqual(Array.from(ch.noteHistory,p=>p.midiFloat),[926]);
  m.write(0x28,0xf1);
  m.context.player.processedWaitSamples=5;
  m.write(0xa1,0x0b);
  assert.deepEqual(Array.from(ch.noteHistory,p=>p.midiFloat),[926,779]);
});

test('onset cleanup stays dense when old history expires during KEY ON or before commit',()=>{
  for(const scenario of ['at-key-on','partial','all']) {
    const m=onsetMonitor(),c=m.context,ch=c.channelMonitor[1];
    let now=scenario==='at-key-on'?10000:7000;
    c.performance.now=()=>now;
    ch.noteHistory=[{time:0,midiFloat:600},{time:1000,midiFloat:null},{time:6500,midiFloat:700}];
    m.write(0xa5,0x2b);m.write(0xa1,0x9e);m.write(0x28,0xf1);
    if(scenario!=='at-key-on') {
      now=scenario==='all'?20000:10000;
      c.pruneChannelNoteHistory(ch);
    }
    c.player.processedWaitSamples=5;
    assert.doesNotThrow(()=>m.write(0xa1,0x0b));
    assert.doesNotThrow(()=>c.pruneChannelNoteHistory(ch));
    assert.deepEqual(Array.from(ch.noteHistory,p=>p.midiFloat),scenario==='all'?[779]:[700,779]);
    assert.ok(Array.from(ch.noteHistory).every(p=>p && p.time>=now-8000));
    m.write(0x28,1);
    assert.equal(ch.noteHistory.at(-1).midiFloat,null);
  }
});
