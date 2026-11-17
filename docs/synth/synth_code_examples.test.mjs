import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthProject} from './synth_project.js';
import {addFmCodeExamples, FM_CODE_EXAMPLES} from './synth_code_examples.js';

test('missing timed example is editable project data, without changing selection or saved source', () => {
  const project = createSynthProject();
  project.fs.writeText('/index.js', 'saved melody');
  project.select('/index.js');
  assert.deepEqual(addFmCodeExamples(project), ['/examples/timed-operators.js']);
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
  assert.deepEqual(addFmCodeExamples(occupied), []);
  const parent = createSynthProject();
  parent.fs.writeText('/Examples', 'my file');
  assert.deepEqual(addFmCodeExamples(parent), []);
  assert.equal(parent.fs.get('/Examples').data, 'my file');
});
