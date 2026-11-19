import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthProject} from './synth_project.js';
import {addFmCodeExamples, FM_CODE_EXAMPLES} from './synth_code_examples.js';
import {parseCddaWav} from '../js/cdda_source.js';

test('missing timed example is editable project data, without changing selection or saved source', () => {
  const project = createSynthProject();
  project.fs.writeText('/index.js', 'saved melody');
  project.select('/index.js');
  assert.deepEqual(addFmCodeExamples(project), ['/examples/cdda.js','/examples/timed-operators.js']);
  assert.equal(project.selectedPath, '/index.js');
  assert.equal(project.fs.get('/index.js').data, 'saved melody');
  const path = '/examples/timed-operators.js';
  assert.equal(project.fs.get(path).data, FM_CODE_EXAMPLES[path]);
  project.fs.writeText(path, 'my operator motion');
  assert.deepEqual(addFmCodeExamples(project), []);
  assert.equal(project.fs.get(path).data, 'my operator motion');
});

test('case variants and occupied parent paths are kept', () => {
  const occupied = createSynthProject();
  occupied.fs.writeText('/EXAMPLES/Timed-Operators.js', 'saved');
  occupied.fs.writeText('/EXAMPLES/CDDA.js', 'saved CD audio');
  assert.deepEqual(addFmCodeExamples(occupied), []);
  const parent = createSynthProject();
  parent.fs.writeText('/Examples', 'my file');
  assert.deepEqual(addFmCodeExamples(parent), []);
  assert.equal(parent.fs.get('/Examples').data, 'my file');
});

test('CD-DA example generates original valid stereo PCM16 WAV and yields between track starts',async()=>{
  const loads=[],plays=[],waits=[],loops=[];
  const cd={async load(bytes){loads.push(bytes);},async play(track){plays.push(track);}};
  const run=Object.getPrototypeOf(async function(){}).constructor;
  await new run('useSoundChip','setBpm','liveLoop','beat',FM_CODE_EXAMPLES['/examples/cdda.js'])(
    async name=>{assert.equal(name,'cdda');return cd;},bpm=>assert.equal(bpm,120),
    (name,callback)=>loops.push({name,callback}),async beats=>waits.push(beats));
  assert.equal(loads.length,1);const parsed=parseCddaWav(loads[0]);assert.equal(parsed.sampleRate,44100);assert.equal(parsed.frames,88200);
  assert(parsed.pcm.some(value=>value!==0));assert.equal(plays.length,0,'loading the example does not implicitly start its track');
  await loops[0].callback();assert.deepEqual(plays,[1]);assert.deepEqual(waits,[4]);
});
