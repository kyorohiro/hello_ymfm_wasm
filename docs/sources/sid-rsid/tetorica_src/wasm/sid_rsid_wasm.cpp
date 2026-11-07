// SPDX-License-Identifier: BSD-3-Clause
#include "sid_rsid_core.h"
#include <new>
#include <emscripten/emscripten.h>
using Instance = tetorica::SidRsidCore;
extern "C" {
EMSCRIPTEN_KEEPALIVE Instance* sidr_create(unsigned rate) { return rate >= 8000 && rate <= 96000 ? new (std::nothrow) Instance(rate) : nullptr; }
EMSCRIPTEN_KEEPALIVE void sidr_destroy(Instance* p) { delete p; }
EMSCRIPTEN_KEEPALIVE uint8_t* sidr_input(Instance* p) { return p->input(); }
EMSCRIPTEN_KEEPALIVE uint8_t* sidr_rom_input(Instance* p) { return p->romInput(); }
EMSCRIPTEN_KEEPALIVE int sidr_load(Instance* p,unsigned length,unsigned load,unsigned init,unsigned song,unsigned basic,unsigned roms) { return p->load(length,load,init,song,basic,roms); }
EMSCRIPTEN_KEEPALIVE float* sidr_output(Instance* p) { return p->output(); }
EMSCRIPTEN_KEEPALIVE int sidr_render(Instance* p,unsigned n) { return p->render(n); }
EMSCRIPTEN_KEEPALIVE void sidr_stop(Instance* p) { p->stop(); }
EMSCRIPTEN_KEEPALIVE unsigned sidr_state(Instance* p) { return p->state(); }
EMSCRIPTEN_KEEPALIVE const char* sidr_error(Instance* p) { return p->error(); }
EMSCRIPTEN_KEEPALIVE unsigned sidr_error_code(Instance* p) { return p->errorCode(); }
EMSCRIPTEN_KEEPALIVE unsigned sidr_error_address(Instance* p) { return p->errorAddress(); }
EMSCRIPTEN_KEEPALIVE double sidr_cycles(Instance* p) { return static_cast<double>(p->cycles()); }
EMSCRIPTEN_KEEPALIVE unsigned sidr_init_cycles(Instance* p) { return p->initCycles(); }
EMSCRIPTEN_KEEPALIVE double sidr_boot_cycles(Instance* p) { return static_cast<double>(p->bootCycles()); }
EMSCRIPTEN_KEEPALIVE unsigned sidr_init_returned(Instance* p) { return p->initReturned(); }
EMSCRIPTEN_KEEPALIVE double sidr_init_return_cycle(Instance* p) { return static_cast<double>(p->initReturnCycle()); }
EMSCRIPTEN_KEEPALIVE unsigned sidr_irq_count(Instance* p) { return p->irqCount(); }
EMSCRIPTEN_KEEPALIVE unsigned sidr_nmi_count(Instance* p) { return p->nmiCount(); }
EMSCRIPTEN_KEEPALIVE unsigned sidr_read_count(Instance* p) { return p->readCount(); }
EMSCRIPTEN_KEEPALIVE unsigned sidr_write_count(Instance* p) { return p->writeCount(); }
EMSCRIPTEN_KEEPALIVE unsigned sidr_pc(Instance* p) { return p->pc(); }
EMSCRIPTEN_KEEPALIVE unsigned sidr_ram_read(Instance* p,unsigned a) { return p->ramRead(a); }
EMSCRIPTEN_KEEPALIVE unsigned sidr_register(Instance* p,unsigned r) { return p->reg(r); }
EMSCRIPTEN_KEEPALIVE unsigned sidr_envelope(Instance* p,unsigned v) { return p->envelope(v); }
EMSCRIPTEN_KEEPALIVE unsigned sidr_phase(Instance* p,unsigned v) { return p->phase(v); }
EMSCRIPTEN_KEEPALIVE const Instance::TraceEntry* sidr_trace(Instance* p) { return p->trace(); }
EMSCRIPTEN_KEEPALIVE unsigned sidr_trace_count(Instance* p) { return p->traceCount(); }
EMSCRIPTEN_KEEPALIVE unsigned sidr_dropped_trace(Instance* p) { return p->droppedTrace(); }
EMSCRIPTEN_KEEPALIVE void sidr_clear_trace(Instance* p) { p->clearTrace(); }
}
