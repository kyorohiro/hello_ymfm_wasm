#!/usr/bin/env node
// Reproducible conservative upper bound for RF manual-sample RAM protection.
// Extract the production word-search function; no duplicated DSP/guard logic.
import {readFile, writeFile, mkdtemp, rm, mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir, arch, platform, cpus} from 'node:os';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  if (!/^--(out|iterations)=/.test(arg)) throw new Error(`Unknown option: ${arg}`);
  const split = arg.indexOf('='); return [arg.slice(2, split), arg.slice(split + 1)];
}));
const iterations = Number(args.iterations ?? 2000);
if (!Number.isSafeInteger(iterations) || iterations < 10 || iterations > 100000) throw new Error('iterations must be 10–100000');
const sourcePath = 'w/tetorica-fm2612-playground-tauri/src-tauri/src/native_genesis_extra_rf5c164.rs';
const source = await readFile(resolve(root, sourcePath), 'utf8');
const start = source.indexOf('    fn guarded_end(');
if (start < 0) throw new Error('Production guarded_end function not found');
const opening = source.indexOf('{', start);
let end = opening + 1, depth = 1;
for (; depth && end < source.length; end++) {
  if (source[end] === '{') depth++;
  else if (source[end] === '}') depth--;
}
if (depth) throw new Error('Production guard function has unbalanced braces');
const method = source.slice(start, end);
const temp = await mkdtemp(resolve(tmpdir(), 'tetorica-rf-guard-'));
try {
  const input = resolve(temp, 'rf_guard_benchmark.rs'), binary = resolve(temp, platform() === 'win32' ? 'rf_guard_benchmark.exe' : 'rf_guard_benchmark');
  const rust = `use std::hint::black_box; use std::time::Instant;
const RAM: usize = 65536;
struct GuardBench { markers: [u64; 1024] }
impl GuardBench { ${method} }
fn main() {
 let g = GuardBench { markers: [0x5555_5555_5555_5555; 1024] };
 let mut times = Vec::with_capacity(${iterations}); let mut checksum = 0usize;
 for _ in 0..${iterations} {
  let start = Instant::now();
  for ch in 0..8 { for path in 0..3 {
   checksum ^= black_box(g.guarded_end(black_box((ch*4096+path*257)%RAM), black_box(32)));
  }}
  times.push(start.elapsed().as_nanos() as u64);
 }
 times.sort_unstable();
 println!(r#"{{\"medianUs\":{},\"p99Us\":{},\"maxUs\":{},\"checksum\":{}}}"#,
  times[times.len()/2] as f64/1000., times[times.len()*99/100] as f64/1000., times[times.len()-1] as f64/1000., checksum);
}`;
  await writeFile(input, rust);
  execFileSync('rustc', ['--edition=2021', '-O', input, '-o', binary], {stdio: 'pipe'});
  const timing = JSON.parse(execFileSync(binary, [], {encoding: 'utf8'}));
  const report = {
    sourcePath, sourceFunctionSha256: createHash('sha256').update(method).digest('hex'),
    compiler: execFileSync('rustc', ['--version'], {encoding: 'utf8'}).trim(), platform: platform(), architecture: arch(), cpu: cpus()[0]?.model,
    iterations, voices: 8, pathsPerVoice: 3, markerRunLength: 32, maxWordScansPerPath: 1025,
    note: 'Conservative forced-search upper bound: all 24 paths recompute. Production caches guards until a path edit; a full-RAM result stops after its first path. Excludes upload copy, DSP, IPC and device work.',
    ...timing,
  };
  if (args.out) {
    const output = resolve(args.out); await mkdir(dirname(output), {recursive: true});
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} finally { await rm(temp, {recursive: true, force: true}); }
