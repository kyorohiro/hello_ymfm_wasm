// SPDX-License-Identifier: BSD-3-Clause
#include "generated/sid8580_machine_core.h"
#include <new>
#include <emscripten/emscripten.h>
using Instance=tetorica::Sid8580MachineCore;
extern "C" {
EMSCRIPTEN_KEEPALIVE Instance* sid8m_create(unsigned rate,unsigned profiles){return rate>=8000&&rate<=96000&&profiles<=3?new(std::nothrow)Instance(rate,profiles):nullptr;}
EMSCRIPTEN_KEEPALIVE void sid8m_destroy(Instance*p){delete p;}
EMSCRIPTEN_KEEPALIVE uint8_t* sid8m_input(Instance*p){return p->input();}
EMSCRIPTEN_KEEPALIVE uint8_t* sid8m_rom_input(Instance*p){return p->romInput();}
EMSCRIPTEN_KEEPALIVE int sid8m_load(Instance*p,unsigned n,unsigned load,unsigned init,unsigned song,unsigned basic,unsigned roms){return p->load(n,load,init,song,basic,roms);}
EMSCRIPTEN_KEEPALIVE int sid8m_load_psid(Instance*p,unsigned n,unsigned load,unsigned init,unsigned play,unsigned song,unsigned roms,unsigned page){return p->loadPsid(n,load,init,play,song,roms,page);}
EMSCRIPTEN_KEEPALIVE int sid8m_load_psid_vbi(Instance*p,unsigned n,unsigned load,unsigned init,unsigned play,unsigned song,unsigned roms,unsigned page){return p->loadPsidVbi(n,load,init,play,song,roms,page);}
EMSCRIPTEN_KEEPALIVE float* sid8m_output(Instance*p){return p->output();}
EMSCRIPTEN_KEEPALIVE int sid8m_render(Instance*p,unsigned n){return p->render(n);}
EMSCRIPTEN_KEEPALIVE void sid8m_stop(Instance*p){p->stop();}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_state(Instance*p){return p->state();}
EMSCRIPTEN_KEEPALIVE const char* sid8m_error(Instance*p){return p->error();}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_error_code(Instance*p){return p->errorCode();}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_error_address(Instance*p){return p->errorAddress();}
EMSCRIPTEN_KEEPALIVE double sid8m_cycles(Instance*p){return static_cast<double>(p->cycles());}
EMSCRIPTEN_KEEPALIVE double sid8m_sid_cycles(Instance*p){return static_cast<double>(p->sidCycles());}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_profiles(Instance*p){return p->profiles();}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_model(Instance*){return 8580;}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_host_dc_hz(Instance*){return 12;}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_init_cycles(Instance*p){return p->initCycles();}
EMSCRIPTEN_KEEPALIVE double sid8m_boot_cycles(Instance*p){return static_cast<double>(p->bootCycles());}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_init_returned(Instance*p){return p->initReturned();}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_init_pending(Instance*p){return p->initPending();}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_init_limit(Instance*p){return p->initLimit();}
EMSCRIPTEN_KEEPALIVE double sid8m_init_return_cycle(Instance*p){return static_cast<double>(p->initReturnCycle());}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_irq_count(Instance*p){return p->irqCount();}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_nmi_count(Instance*p){return p->nmiCount();}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_play_calls(Instance*p){return p->playCalls();}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_driver_address(Instance*p){return p->driverAddress();}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_read_count(Instance*p){return p->readCount();}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_write_count(Instance*p){return p->writeCount();}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_pc(Instance*p){return p->pc();}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_ram_read(Instance*p,unsigned address){return p->ramRead(address);}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_register(Instance*p,unsigned r){return p->reg(r);}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_envelope(Instance*p,unsigned v){return p->envelope(v);}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_phase(Instance*p,unsigned v){return p->phase(v);}
EMSCRIPTEN_KEEPALIVE const Instance::TraceEntry* sid8m_trace(Instance*p){return p->trace();}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_trace_count(Instance*p){return p->traceCount();}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_dropped_trace(Instance*p){return p->droppedTrace();}
EMSCRIPTEN_KEEPALIVE void sid8m_clear_trace(Instance*p){p->clearTrace();}
EMSCRIPTEN_KEEPALIVE const sid8580_read_entry* sid8m_sid_read_trace(Instance*p){return p->sidReadTrace();}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_sid_read_trace_count(Instance*p){return p->sidReadTraceCount();}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_sid_read_trace_dropped(Instance*p){return p->sidReadTraceDropped();}
EMSCRIPTEN_KEEPALIVE void sid8m_sid_read_trace_clear(Instance*p){p->clearSidReadTrace();}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_sid_observable_mask(Instance*p){return p->observableMask();}
EMSCRIPTEN_KEEPALIVE unsigned sid8m_sid_observable_value(Instance*p,unsigned r){return p->observableValue(r);}
EMSCRIPTEN_KEEPALIVE double sid8m_sid_observable_cycle(Instance*p,unsigned r){return static_cast<double>(p->observableCycle(r));}
}
