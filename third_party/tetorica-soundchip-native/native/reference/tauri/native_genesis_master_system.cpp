// Exact Browser/WASM Sega PSG and ymfm OPLL cores; no device or JS runtime.
#include "native_genesis_master_system.h"
#include "native_genesis_psg.h"
#include "native_genesis_opll.h"
#include <array>
#include <cmath>
#include <cstring>

namespace {
struct NativeMasterSystem : NativeOpllCore, NativePsgCore {
    explicit NativeMasterSystem(uint32_t sr) : NativeOpllCore(sr), NativePsgCore(sr) {}
    void key_off(uint8_t voice) {
        if (voice < 4) { psg_key_off(voice); return; }
        NativeOpllCore::key_off(voice - 4);
    }
    void audition(uint8_t voice) {
        if (voice < 4) { psg_audition(voice); return; }
        NativeOpllCore::audition(voice - 4);
    }
    void stop(uint8_t chip) {
        if (chip == 0 || chip == 2) psg_stop();
        if (chip == 1 || chip == 2) stop_opll();
    }
    void reset(uint8_t chip) {
        if (chip == 0 || chip == 2) psg_reset();
        if (chip == 1 || chip == 2) reset_opll();
    }
    void sample(float *pl, float *pr, float *fl, float *fr) {
        sample_psg(pl, pr);
        sample_opll(fl, fr);
    }
};
NativeMasterSystem *core(void *p) { return static_cast<NativeMasterSystem *>(p); }
}
extern "C" {
void *native_master_system_create(uint32_t rate) {
    if (rate < 8000 || rate > 384000) return nullptr;
    try { return new NativeMasterSystem(rate); } catch (...) { return nullptr; }
}
void native_master_system_destroy(void *p) { delete core(p); }
void native_master_system_reset(void *p, uint8_t chip) { core(p)->reset(chip); }
void native_master_system_stop(void *p, uint8_t chip) { core(p)->stop(chip); }
void native_master_system_key_off(void *p, uint8_t voice) { core(p)->key_off(voice); }
void native_master_system_audition_key_on(void *p, uint8_t voice) { core(p)->audition(voice); }
void native_master_system_write(void *p, uint8_t chip, uint8_t reg, uint8_t value) { if (chip == 0) core(p)->psg_write(value); else if (chip == 1) core(p)->opll_write(reg, value); }
void native_master_system_sample(void *p, float *pl, float *pr, float *fl, float *fr) { core(p)->sample(pl, pr, fl, fr); }
int native_master_system_set_clock(void *p, uint8_t chip, uint32_t clock) {
    if (clock < 100000 || clock > 100000000 || chip > 1) return 0;
    if (chip == 0) core(p)->psg_clock = clock; else core(p)->opll_clock = clock; return 1;
}
void native_master_system_set_mute_mask(void *p, uint8_t chip, uint32_t mask) {
    auto *h = core(p);
    if (chip == 0) h->psg_mute(mask);
    else if (chip == 1) { h->opll_mute_mask = mask & 0x1ff; h->update_mute(); h->last_opll = 0; }
}
uint8_t native_master_system_read(void *p, uint8_t offset) { return core(p)->opll.read(offset); }
uint8_t native_master_system_read_status(void *p) { return core(p)->opll.read_status(); }
uint8_t native_master_system_get_irq(void *p) { return core(p)->intf.irq_asserted ? 1 : 0; }
void native_master_system_get_state(void *p, NativeMasterSystemState *s) {
    const auto *h = core(p); std::memcpy(s->registers, h->registers.data(), 64); std::memcpy(s->periods, h->periods.data(), 6);
    std::memcpy(s->attenuation, h->attenuation.data(), 4); std::memcpy(s->levels, h->levels.data(), 4);
    s->psg_clock = h->psg_clock; s->opll_clock = h->opll_clock; s->psg_mute_mask = h->psg_mute_mask; s->opll_mute_mask = h->opll_mute_mask;
    s->latch = h->latch; s->noise_mode = h->noise_mode; s->status = core(p)->opll.read_status(); s->irq = h->intf.irq_asserted ? 1 : 0;
}
}
