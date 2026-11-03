// license:BSD-3-Clause
// copyright-holders:kyorohiro
#include "wonderswan.h"
#include <new>

extern "C" {
void* wonderswan_create(uint32_t clock, uint32_t rate) {
    if (!WonderSwan::validConfiguration(clock, rate)) return nullptr;
    return new (std::nothrow) WonderSwan(clock, rate);
}
void wonderswan_destroy(WonderSwan* chip) { delete chip; }
void wonderswan_reset(WonderSwan* chip) { if (chip) chip->reset(); }
void wonderswan_write(WonderSwan* chip, uint32_t address, uint32_t value) {
    if (chip) chip->writeRegister(address, uint8_t(value));
}
uint32_t wonderswan_read(const WonderSwan* chip, uint32_t address) {
    return chip ? chip->readRegister(address) : 0;
}
void wonderswan_write_memory(WonderSwan* chip, uint32_t address, uint32_t value) {
    if (chip) chip->writeMemory(address, uint8_t(value));
}
uint32_t wonderswan_read_memory(const WonderSwan* chip, uint32_t address) {
    return chip ? chip->readMemory(address) : 0;
}
void wonderswan_mute(WonderSwan* chip, uint32_t channel, uint32_t muted) {
    if (chip) chip->mute(channel, muted != 0);
}
void wonderswan_generate(WonderSwan* chip, float* left, float* right, uint32_t frames) {
    if (chip) chip->generate(left, right, frames);
}
}
