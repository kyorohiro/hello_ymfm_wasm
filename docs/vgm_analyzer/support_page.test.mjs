import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('published support page matches the Analyzer support dialog',()=>{
 const script=fileURLToPath(new URL('../../scripts/build_analyzer_support.mjs',import.meta.url));
 const result=spawnSync(process.execPath,[script,'--check'],{encoding:'utf8'});
 assert.equal(result.status,0,result.error?.message ?? result.stderr);
});
