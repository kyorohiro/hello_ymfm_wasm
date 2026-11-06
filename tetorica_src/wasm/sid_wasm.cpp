// Tetorica standalone SID bridge, BSD-3-Clause.
#include "sid_core.h"
#include <new>
#include <emscripten/emscripten.h>

namespace {
struct Instance {
    tetorica::SidCore core;
    std::array<float, 4096> output{};
    Instance(int sampleRate, int clockHz) : core(sampleRate, clockHz) {}
};
}
extern "C" {
EMSCRIPTEN_KEEPALIVE Instance* sid_create(int sampleRate, int clockHz) {
    if (sampleRate < 8000 || sampleRate > 96000 || clockHz < 900000 || clockHz > 1100000) return nullptr;
    return new (std::nothrow) Instance(sampleRate, clockHz);
}
EMSCRIPTEN_KEEPALIVE void sid_destroy(Instance* instance) { delete instance; }
EMSCRIPTEN_KEEPALIVE void sid_reset(Instance* instance) { instance->core.reset(); }
EMSCRIPTEN_KEEPALIVE int sid_write(Instance* instance, unsigned reg, unsigned value) { return instance->core.write(reg, value); }
EMSCRIPTEN_KEEPALIVE int sid_read(Instance* instance, unsigned reg) { return instance->core.read(reg); }
EMSCRIPTEN_KEEPALIVE float* sid_output(Instance* instance) { return instance->output.data(); }
EMSCRIPTEN_KEEPALIVE int sid_render(Instance* instance, unsigned frames) {
    if (frames > instance->output.size()) return 0;
    instance->core.render(instance->output.data(), frames); return 1;
}
EMSCRIPTEN_KEEPALIVE double sid_cycles(Instance* instance) { return static_cast<double>(instance->core.cycles()); }
EMSCRIPTEN_KEEPALIVE unsigned sid_envelope(Instance* instance, unsigned voice) { return voice < 3 ? instance->core.envelope(voice) : 0; }
EMSCRIPTEN_KEEPALIVE unsigned sid_phase(Instance* instance, unsigned voice) { return voice < 3 ? instance->core.phase(voice) : 0; }
}
