#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Deterministic marked copy. Production host and all C64 hardware stay intact.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const source='tetorica_src/wasm/sid_rsid_core.h';
const expected='1de69a5fcb1cc4b7284c12c7f8de52f4c2109a4c8944396c94072a3f49f9ece1';
const c64='third_party/chips-c64/upstream/systems/c64.h';
const expectedC64='a0e30d76798bbe2463e99814ddcd890640d0d808e904cf9b47f8294462543a6c';
const target='tetorica_src/wasm/sid8580-machine/generated/sid8580_machine_core.h';
const manifestPath='tetorica_src/wasm/sid8580-machine/generated/source-manifest.json';
const hash=b=>createHash('sha256').update(b).digest('hex');
const original=await readFile(resolve(root,source)),originalC64=await readFile(resolve(root,c64));
assert.equal(hash(original),expected,'Production host revision changed; review the research patch explicitly');
assert.equal(hash(originalC64),expectedC64,'Pristine C64 revision changed');
let text=original.toString(),recipes=[];
function patch(name,from,to,count=1){
  const actual=text.split(from).length-1;assert.equal(actual,count,`Research patch context ${name}`);
  text=text.split(from).join(to);recipes.push({name,occurrences:actual});
}
patch('research-class','SidRsidCore','Sid8580MachineCore',4);
patch('compatibility-sid-include','"../../third_party/chips-m6581/m6581.h"','"../sid_endpoint.h"');
patch('relative-original-includes','"../../third_party/','"../../../../third_party/',text.split('"../../third_party/').length-1);
patch('separate-machine-tick','tetorica_rsid_machine_tick','tetorica_sid8580_machine_tick',2);
patch('constructor-options','explicit Sid8580MachineCore(unsigned sampleRate) : sampleRate_(sampleRate) {}',
  'explicit Sid8580MachineCore(unsigned sampleRate,unsigned profiles) : sampleRate_(sampleRate),profiles_(profiles) {}');
patch('sid-handle-lifecycle','if (machine_.valid) c64_discard(&machine_);',
  'if (machine_.valid) { sid8580_endpoint_discard(&machine_.sid); c64_discard(&machine_); }',2);
patch('configure-new-endpoint','        c64_init(&machine_, &desc);',
  '        c64_init(&machine_, &desc);\n        if (!machine_.sid.handle || !sid8580_endpoint_set_profiles(&machine_.sid,profiles_)) return fail(InvalidArguments);');
patch('stop-preserves-debug-history','if (machine_.valid) { m6581_reset(&machine_.sid); machine_.audio.sample_pos = 0; }',
  'if (machine_.valid) { sid8580_endpoint_stop(&machine_.sid); machine_.audio.sample_pos = 0; }');
patch('post-boot-debug-boundary','            traceCount_ = droppedTrace_ = readCount_ = writeCount_ = irqCount_ = nmiCount_ = 0;',
  '            traceCount_ = droppedTrace_ = readCount_ = writeCount_ = irqCount_ = nmiCount_ = 0;\n            sid8580_endpoint_clear_debug(&machine_.sid);');
patch('unsupported-pot-code','UnsupportedIo = 3, MissingRom = 4, CpuJam = 6',
  'UnsupportedIo = 3, MissingRom = 4, UnsupportedSidRead = 5, CpuJam = 6');
patch('unsupported-pot-description','        case CpuJam:',
  '        case UnsupportedSidRead: return "Research 8580 endpoint does not support POTX/POTY reads";\n        case CpuJam:');
patch('all-formats-expansion-guard','if (psidVbi_ && machine_.io_mapped && address >= 0xde00',
  'if (machine_.io_mapped && address >= 0xde00');
patch('endpoint-fault-before-next-cpu-tick','        machine_.pins = tetorica_sid8580_machine_tick(&machine_, machine_.pins);',
  '        machine_.pins = tetorica_sid8580_machine_tick(&machine_, machine_.pins);\n        if (machine_.sid.error) { fail(machine_.sid.error == 5 ? UnsupportedSidRead : InvalidArguments,M6502_GET_ADDR(machine_.pins)); return; }');
patch('selected-read-count','unsigned readCount() const { return readCount_; }','unsigned readCount() const { return machine_.sid.read_count; }');
patch('selected-write-count','unsigned writeCount() const { return writeCount_; }','unsigned writeCount() const { return machine_.sid.write_count; }');
patch('unavailable-live-envelope','unsigned envelope(unsigned v) const { return v < 3 ? machine_.sid.voice[v].env_cur_level & 255 : 0; }',
  'unsigned envelope(unsigned) const { return std::numeric_limits<unsigned>::max(); }');
patch('unavailable-live-phase','unsigned phase(unsigned v) const { return v < 3 ? machine_.sid.voice[v].wav_accum : 0; }',
  'unsigned phase(unsigned) const { return std::numeric_limits<unsigned>::max(); }');
patch('research-metadata-and-read-trace','    static void increase(unsigned& value)',String.raw`public:
    unsigned profiles() const { return profiles_; }
    uint64_t sidCycles() const { return machine_.sid.cycles; }
    const sid8580_read_entry* sidReadTrace() const { return machine_.sid.read_trace; }
    unsigned sidReadTraceCount() const { return machine_.sid.read_trace_count; }
    unsigned sidReadTraceDropped() const { return machine_.sid.read_trace_dropped; }
    void clearSidReadTrace() { machine_.sid.read_trace_count=machine_.sid.read_trace_dropped=0; }
    unsigned observableMask() const { return machine_.sid.observable_mask; }
    unsigned observableValue(unsigned r) const {
        if(r==27 && (observableMask()&1))return machine_.sid.osc3_value;
        if(r==28 && (observableMask()&2))return machine_.sid.env3_value;
        return std::numeric_limits<unsigned>::max();
    }
    uint64_t observableCycle(unsigned r) const { return r==27?machine_.sid.osc3_cycle:r==28?machine_.sid.env3_cycle:0; }
private:
    static void increase(unsigned& value)`);
patch('store-profile-options','    unsigned sampleRate_;','    unsigned sampleRate_,profiles_;');
text=`// GENERATED research adaptation of ${source}\n// Original SHA256 ${expected}; production source is not modified.\n`+text;
const output=Buffer.from(text);
const manifest={format:'tetorica-sid8580-machine-source-adaptation',version:1,
  source:{path:source,bytes:original.length,sha256:expected},
  pristineC64:{path:c64,bytes:originalC64.length,sha256:expectedC64,modified:false},
  output:{path:target,bytes:output.length,sha256:hash(output)},recipes,
  exclusions:['No hardware timing edits','No snapshots exported','No fake live voice state','No production source mutation'],
  outputChain:'Sidera external RC followed by retained 12Hz host DC blocker'};
const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
const args=process.argv.slice(2);assert(args.length===0||(args.length===1&&args[0]==='--check'));
if(args.length){assert((await readFile(resolve(root,target))).equals(output));assert((await readFile(resolve(root,manifestPath))).equals(manifestBytes));}
else{await mkdir(resolve(root,'tetorica_src/wasm/sid8580-machine/generated'),{recursive:true});await writeFile(resolve(root,target),output);await writeFile(resolve(root,manifestPath),manifestBytes);}
console.log('SID8580 machine marked host '+(args.length?'checked':'generated'));
