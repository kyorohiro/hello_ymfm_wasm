// license:BSD-3-Clause
// copyright-holders:Brad Oliver, Eric Smith, Juergen Buchmueller, kyorohiro
// Standalone audio adaptation; see README.md for source pin and I/O limits.
#pragma once

#include <cstdint>
#include <memory>

class Pokey {
public:
    // Native clock in whole Hz; host rate in frames per second.
    // Invalid direct-constructor arguments fall back to 1789790 / 44100.
    explicit Pokey(uint32_t clock = 1789790, uint32_t sampleRate = 44100);
    ~Pokey();
    Pokey(const Pokey&) = delete;
    Pokey& operator=(const Pokey&) = delete;
    Pokey(Pokey&&) = delete;
    Pokey& operator=(Pokey&&) = delete;

    // clock: 1..100000000; sampleRate: 8000..384000.
    static bool validConfiguration(uint32_t clock, uint32_t sampleRate);
    void reset();
    // Register addresses are the chip-local 0x00..0x0f. Invalid writes are
    // ignored; invalid reads return 0xff. Reads are non-timing status peeks,
    // not copies of the write register bank (e.g. 0x0a reads RANDOM).
    void writeRegister(uint32_t address, uint8_t value);
    uint8_t readRegister(uint32_t address) const;
    // Zero-based 0..3. Muting only masks the mix; all chip clocks continue.
    void mute(uint32_t channel, bool muted);
    // Planar mono duplicated to L/R, legacy linear gain /32768, raw DC.
    // Persistent rational box integration; no allocation while rendering.
    // Both output pointers must be non-null for a non-empty block.
    void generate(float* left, float* right, uint32_t frames);

private:
    struct State;
    std::unique_ptr<State> state_;
};
