// Standalone Game Gear: one PSG, without constructing Genesis or an OPLL core.
#include "native_genesis_game_gear.h"
#include "native_genesis_psg.h"
#include <cstring>

namespace { NativePsgCore *core(void *p) { return static_cast<NativePsgCore *>(p); } }
extern "C" {
void *native_game_gear_create(uint32_t rate) {
    if (rate < 8000 || rate > 384000) return nullptr;
    try { return new NativePsgCore(rate); } catch (...) { return nullptr; }
}
void native_game_gear_destroy(void *p) { delete core(p); }
void native_game_gear_reset(void *p) { core(p)->psg_reset(); }
void native_game_gear_stop(void *p) { core(p)->psg_stop(); }
void native_game_gear_write(void *p, uint8_t value) { core(p)->psg_write(value); }
void native_game_gear_key_off(void *p, uint8_t channel) { core(p)->psg_key_off(channel); }
void native_game_gear_audition_key_on(void *p, uint8_t channel) { core(p)->psg_audition(channel); }
void native_game_gear_sample(void *p, float *left, float *right) { core(p)->sample_psg(left, right); }
int native_game_gear_set_clock(void *p, uint32_t value) {
    if (value < 100000 || value > 100000000) return 0;
    core(p)->psg_clock = value; return 1;
}
void native_game_gear_set_mute_mask(void *p, uint32_t mask) { core(p)->psg_mute(mask); }
void native_game_gear_set_stereo(void *p, uint8_t mask) { core(p)->psg_stereo(mask); }
void native_game_gear_get_state(void *p, NativeGameGearState *s) {
    const auto *h = core(p); std::memcpy(s->periods, h->periods.data(), 6);
    std::memcpy(s->attenuation, h->attenuation.data(), 4); std::memcpy(s->levels, h->levels.data(), 4);
    s->clock = h->psg_clock; s->mute_mask = h->psg_mute_mask;
    s->latch = h->latch; s->noise_mode = h->noise_mode; s->stereo = h->stereo;
}
}
