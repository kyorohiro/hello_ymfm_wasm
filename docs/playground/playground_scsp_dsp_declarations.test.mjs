import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {selectPlaygroundDeclarations} from './playground_declarations.js';
import {definitionSource, globalDefinition, sourcePosition} from './playground_monaco_definitions.js';

const declarations = await readFile(new URL('./tetorica-playground-globals.d.ts', import.meta.url), 'utf8');
const publicModule = fileURLToPath(new URL('../../tetorica_src/runtime/scsp_dsp_assembler.js', import.meta.url));
const usage = `import type {assembleScspDsp as assemblePublic, disassembleScspDsp as disassemblePublic} from ${JSON.stringify(publicModule)};
type IsAny<T> = 0 extends (1 & T) ? true : false;
type Assert<T extends true> = T;
type AssemblyIsTyped = Assert<IsAny<ReturnType<typeof assembleScspDsp>> extends false ? true : false>;
type DisassemblyIsTyped = Assert<IsAny<ReturnType<typeof disassembleScspDsp>> extends false ? true : false>;
const globalAssembler:typeof assemblePublic = assembleScspDsp;
const pgAssembler:typeof assemblePublic = pg.assembleScspDsp;
const globalDisassembler:typeof disassemblePublic = disassembleScspDsp;
const pgDisassembler:typeof disassemblePublic = pg.disassembleScspDsp;
const sameAssembler:typeof assembleScspDsp = pg.assembleScspDsp;
const sameDisassembler:typeof disassembleScspDsp = pg.disassembleScspDsp;
const words:Uint16Array = assembleScspDsp('003: EWT=1 COEF=1');
const pgWords:Uint16Array = pg.assembleScspDsp('000:');
const readonlyWords:readonly number[] = Array.from(words);
const compact:string = disassembleScspDsp(words);
const full:string = pg.disassembleScspDsp(readonlyWords, {includeTrailingZeros:true});
const optional:string = disassembleScspDsp(words, {});
void [globalAssembler, pgAssembler, globalDisassembler, pgDisassembler, sameAssembler, sameDisassembler, pgWords, compact, full, optional];
// @ts-expect-error Source is text.
assembleScspDsp(12);
// @ts-expect-error Word data is passed to disassembly.
pg.assembleScspDsp(words);
// @ts-expect-error The local assembler returns its word image synchronously.
const pending:Promise<Uint16Array> = assembleScspDsp('000:');
// @ts-expect-error Logical MPRO words require a 16-bit typed array or numeric array.
disassembleScspDsp(new Uint8Array(1024));
// @ts-expect-error Decode a byte buffer before providing logical words.
pg.disassembleScspDsp(new ArrayBuffer(1024));
// @ts-expect-error The trailing-zero option has a boolean value.
disassembleScspDsp(words, {includeTrailingZeros:128});
// @ts-expect-error Public option spelling is retained.
pg.disassembleScspDsp(words, {trailingZeros:true});
// @ts-expect-error Disassembly options are optional objects.
disassembleScspDsp(words, null);
// @ts-expect-error The recovered source is text.
const numericSource:number = pg.disassembleScspDsp(words);
void [pending, numericSource];
`;

test('DSP globals and pg aliases retain published signatures in all modes and strict module resolutions', async () => {
  const work = await mkdtemp(join(tmpdir(), 'playground-scsp-dsp-types-'));
  const compiler = fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url));
  try {
    for (const chip of ['scsp', 'ym2612', 'ps1']) {
      await writeFile(join(work, 'globals.d.ts'), selectPlaygroundDeclarations(declarations, chip));
      await writeFile(join(work, 'selected.d.ts'), `type TetoricaSelectedChip='${chip}';\n`);
      await writeFile(join(work, 'entry.mts'), usage);
      for (const resolution of ['NodeNext', 'Bundler']) {
        await writeFile(join(work, 'tsconfig.json'), JSON.stringify({
          compilerOptions: {
            strict: true, noEmit: true, skipLibCheck: false, target: 'ES2022',
            module: resolution === 'NodeNext' ? 'NodeNext' : 'ESNext',
            moduleResolution: resolution, lib: ['ES2022', 'DOM'], types: [],
          },
          files: ['globals.d.ts', 'selected.d.ts', 'entry.mts'],
        }));
        try {
          execFileSync(process.execPath, [compiler, '-p', join(work, 'tsconfig.json')], {stdio:'pipe'});
        } catch (error) {
          assert.fail(`${chip} / ${resolution}: ${error.stdout?.toString() || error.message}`);
        }
      }
    }
  } finally {
    await rm(work, {recursive:true, force:true});
  }
});

test('DSP declaration help retains word layout, local execution and practical examples', () => {
  const help = symbol => {
    const end = declarations.indexOf(`declare function ${symbol}(`);
    assert(end >= 0);
    return declarations.slice(declarations.lastIndexOf('/**', end), end);
  };
  const assembly = help('assembleScspDsp');
  const disassembly = help('disassembleScspDsp');
  assert(assembly);
  assert(disassembly);
  assert.match(assembly, /512 logical MPRO words/);
  assert.match(assembly, /Pure synchronous helper/);
  assert.match(assembly, /without WASM loading, audio setup or chip mutation/);
  assert.match(assembly, /Synth execution\s+\* uses a guarded profile/);
  assert.match(assembly, /@example[^]*assembleScspDsp\('003: EWT=1 COEF=1'\)/);
  assert.match(disassembly, /128 physical positions/);
  assert.match(disassembly, /RAW fields/);
  assert.match(disassembly, /without WASM loading, audio setup or chip mutation/);
  assert.match(disassembly, /@example[^]*includeTrailingZeros:true/);
});

test('DSP global and pg source navigation opens the real codec in Playground and Code hosts', async () => {
  const source = await readFile(new URL('../../tetorica_src/runtime/scsp_dsp_assembler.js', import.meta.url), 'utf8');
  const library = {
    uri: 'file:///tetorica-playground-globals.d.ts',
    getValue: () => declarations,
    getPositionAt: offset => ({
      lineNumber: declarations.slice(0, offset).split('\n').length,
      column: offset - declarations.lastIndexOf('\n', offset - 1),
    }),
  };
  for (const symbol of ['assembleScspDsp', 'disassembleScspDsp']) {
    for (const prefix of ['', 'pg.', 'other.']) {
      const code = `${prefix}${symbol}(value)`, startColumn = prefix.length + 1;
      const model = {
        getWordAtPosition: () => ({word:symbol, startColumn}),
        getLineContent: () => code,
      };
      const target = globalDefinition(model, {lineNumber:1, column:startColumn}, new Map([['library', library]]));
      if (prefix === 'other.') {
        assert.equal(target, null);
        continue;
      }
      assert.equal(target.uri, library.uri);
      for (const options of [{}, {runtimeFile:'playground_code_runtime.js'}]) {
        assert.deepEqual(definitionSource(declarations, target.range, 'scsp', options), {file:'scsp_dsp_assembler.js', symbol});
      }
    }
    const lines = declarations.split('\n');
    const member = lines.findIndex(line => line.trimStart().startsWith(`${symbol}: typeof`));
    assert(member >= 0);
    assert.deepEqual(definitionSource(declarations, {
      lineNumber:member + 1, column:lines[member].indexOf(symbol) + 1,
    }, 'scsp'), {file:'scsp_dsp_assembler.js', symbol});
    const position = sourcePosition(source, symbol);
    assert(position.lineNumber > 1);
    assert.match(source.split('\n')[position.lineNumber - 1], new RegExp(`export function ${symbol}\\(`));
  }
});
