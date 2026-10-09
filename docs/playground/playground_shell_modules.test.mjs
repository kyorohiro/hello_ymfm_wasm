import test from 'node:test';
import assert from 'node:assert/strict';
import {rewriteShellImports,createShellModuleLoader} from './playground_shell_modules.js';

test('imports are parsed without rewriting comments, strings, regexes or object methods',()=>{
  const source=`// import('./comment.js')\nconst text="import('./string.js')";\nconst re=/import\\('x'\\)/;\nconst obj={import(x){return x}};obj.import('x');\nconst value=await import(/* comment */ './real.js');\nconst nested=\`value: \${await import('./nested.js')}\`;`;
  const rewritten=rewriteShellImports(source,'/scripts/main.js');
  assert.ok(rewritten.includes(`// import('./comment.js')`));assert.ok(rewritten.includes(`"import('./string.js')"`));
  assert.ok(rewritten.includes(`obj.import('x')`));
  assert.ok(rewritten.includes(`globalThis.__tetoricaShellImport("./real.js","/scripts/main.js")`));
  assert.ok(rewritten.includes(`globalThis.__tetoricaShellImport("./nested.js","/scripts/main.js")`));
  assert.throws(()=>rewriteShellImports(`import {x} from './dep.js';`,'/main.js'),/static/);
  assert.throws(()=>rewriteShellImports(`await import(variable);`,'/main.js'),/string literal/);
  assert.throws(()=>rewriteShellImports(`await import('https://example.com/x.js');`,'/main.js'),/unsupported/);
});
test('module sources are cached within a run, refreshed next run and dynamic cycles fail',()=>{
  let source=`export const value=1;`;
  const read=path=>({type:'text',path,data:source});
  const first=createShellModuleLoader(read);
  assert.equal(first('./dep.js','/scripts/main.js').path,'/scripts/dep.js');
  source=`export const value=2;`;
  assert.equal(first('./dep.js','/scripts/main.js').source,'export const value=1;');
  assert.equal(createShellModuleLoader(read)('./dep.js','/scripts/main.js').source,source);
  assert.throws(()=>first('./main.js','/scripts/dep.js'),/Circular/);
});
