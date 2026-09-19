// license:BSD-3-Clause
// copyright-holders:Hiromitsu Shioya, Olivier Galibert
// Standalone adaptation; see README.md for pinned MAME source and output model.
#pragma once
#include <cstdint>
#include <vector>
#include <array>
class SegaPcm {
public:
    static constexpr int NUM_VOICES = 16;
    SegaPcm(uint32_t rate, uint32_t clock, uint8_t bankShift = 0, uint8_t bankMask = 0);
    void reset();
    // `offset` is the VGM 0xC0 command's raw memory offset (0-0xFFFF); only
    // offset < 0x100 addresses a real register (16 voices x 8 bytes, low
    // bank = static parameters, high bank = live address/control). See
    // README.md for the register table this mirrors from MAME.
    void write(uint16_t offset, uint8_t value);
    int loadSampleMemory(const uint8_t *data, uint32_t size, uint32_t offset, uint32_t memorySize);
    void clearSampleMemory();
    void generate(float *left, float *right, uint32_t frames);
    uint32_t sample_rate() const { return rate; }
    void set_mute_mask(uint32_t mask) { mute_mask = mask & 0xffff; }
private:
    struct voice_t {
        uint32_t addr = 0xffff00; // 16.8 fixed point: bits8-23 byte address, bits0-7 fraction
        uint16_t loop = 0xffff;   // restart address, bits 8-23 of the byte address
        uint8_t end = 0xff;       // top byte (bits16-23) of the end address, +1
        uint8_t freq = 0xff;      // addr advance per tick
        uint8_t lvol = 0xff;
        uint8_t rvol = 0xff;
        uint8_t ctrl = 0xff;      // bit0: disabled, bit1: stop instead of loop, rest: bank bits
    };
    void tick();
    voice_t voices[NUM_VOICES];
    std::vector<uint8_t> rom;
    uint8_t bankShift;
    uint8_t bankMask;
    uint32_t rate, clock;
    uint32_t mute_mask = 0;
    // Integer phase units: each output sample spans `clock` units, and each
    // native tick (one full pass over all 16 voices) spans `rate * 128`
    // units, matching MAME's `stream_alloc(0, 2, clock() / (16 * 8))`.
    uint64_t tick_remaining = 0;
    std::array<float, NUM_VOICES> lastLeft{};
    std::array<float, NUM_VOICES> lastRight{};
};
