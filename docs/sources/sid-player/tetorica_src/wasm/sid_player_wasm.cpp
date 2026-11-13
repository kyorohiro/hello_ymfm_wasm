// SPDX-License-Identifier: BSD-3-Clause
#include "sid_player_core.h"
#include <new>
#include <emscripten/emscripten.h>
using Instance = tetorica::SidPlayerCore;
extern "C" {
EMSCRIPTEN_KEEPALIVE Instance* sidp_create(unsigned sampleRate) {
    return sampleRate >= 8000 && sampleRate <= 96000 ? new (std::nothrow) Instance(sampleRate) : nullptr;
}
EMSCRIPTEN_KEEPALIVE void sidp_destroy(Instance* p) { delete p; }
EMSCRIPTEN_KEEPALIVE uint8_t* sidp_input(Instance* p) { return p->input(); }
EMSCRIPTEN_KEEPALIVE int sidp_load(Instance* p, unsigned length, unsigned load, unsigned init, unsigned play, unsigned subtune) { return p->load(length, load, init, play, subtune); }
EMSCRIPTEN_KEEPALIVE float* sidp_output(Instance* p) { return p->output(); }
EMSCRIPTEN_KEEPALIVE int sidp_render(Instance* p, unsigned frames) { return p->render(frames); }
EMSCRIPTEN_KEEPALIVE void sidp_stop(Instance* p) { p->stop(); }
EMSCRIPTEN_KEEPALIVE unsigned sidp_state(Instance* p) { return p->state(); }
EMSCRIPTEN_KEEPALIVE const char* sidp_error(Instance* p) { return p->error(); }
EMSCRIPTEN_KEEPALIVE unsigned sidp_error_code(Instance* p) { return p->errorCode(); }
EMSCRIPTEN_KEEPALIVE unsigned sidp_error_address(Instance* p) { return p->errorAddress(); }
EMSCRIPTEN_KEEPALIVE double sidp_cycles(Instance* p) { return static_cast<double>(p->cycles()); }
EMSCRIPTEN_KEEPALIVE unsigned sidp_init_cycles(Instance* p) { return p->initCycles(); }
EMSCRIPTEN_KEEPALIVE unsigned sidp_play_calls(Instance* p) { return p->playCalls(); }
EMSCRIPTEN_KEEPALIVE unsigned sidp_skipped_vbis(Instance* p) { return p->skippedVbis(); }
EMSCRIPTEN_KEEPALIVE unsigned sidp_register(Instance* p, unsigned reg) { return p->reg(reg); }
EMSCRIPTEN_KEEPALIVE int sidp_manual_write(Instance* p, unsigned reg, unsigned value) { return p->manualWrite(reg, value); }
EMSCRIPTEN_KEEPALIVE unsigned sidp_source_revision(Instance* p, unsigned reg) { return p->sourceRevision(reg); }
EMSCRIPTEN_KEEPALIVE unsigned sidp_envelope(Instance* p, unsigned voice) { return p->envelope(voice); }
EMSCRIPTEN_KEEPALIVE unsigned sidp_phase(Instance* p, unsigned voice) { return p->phase(voice); }
EMSCRIPTEN_KEEPALIVE const Instance::TraceEntry* sidp_trace(Instance* p) { return p->trace(); }
EMSCRIPTEN_KEEPALIVE unsigned sidp_trace_count(Instance* p) { return p->traceCount(); }
EMSCRIPTEN_KEEPALIVE unsigned sidp_dropped_trace(Instance* p) { return p->droppedTrace(); }
EMSCRIPTEN_KEEPALIVE void sidp_clear_trace(Instance* p) { p->clearTrace(); }
}
