// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro
#include "pokey.h"
#include <new>

// The ABI owns one complete core for each handle. No process-global current
// device exists, so the same WASM module can serve two or more POKEYs.
extern "C" {
void* pokey_create(uint32_t clock, uint32_t rate) {
    if (!Pokey::validConfiguration(clock, rate)) return nullptr;
    try {
        return new Pokey(clock, rate);
    } catch (...) {
        return nullptr;
    }
}
void pokey_destroy(Pokey* chip) { delete chip; }
void pokey_reset(Pokey* chip) { if (chip) chip->reset(); }
void pokey_write(Pokey* chip, uint32_t address, uint32_t value) {
    if (chip) chip->writeRegister(address, uint8_t(value));
}
uint32_t pokey_read(const Pokey* chip, uint32_t address) {
    return chip ? chip->readRegister(address) : 0;
}
void pokey_mute(Pokey* chip, uint32_t channel, uint32_t muted) {
    if (chip) chip->mute(channel, muted != 0);
}
void pokey_generate(Pokey* chip, float* left, float* right, uint32_t frames) {
    if (chip && left && right) chip->generate(left, right, frames);
}
}
