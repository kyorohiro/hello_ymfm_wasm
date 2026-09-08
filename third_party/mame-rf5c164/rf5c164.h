// license:BSD-3-Clause
// copyright-holders:Olivier Galibert,Aaron Giles
#pragma once
#include <array>
#include <cstdint>
class RF5C164 {
public:
    RF5C164(uint32_t rate, uint32_t clock) : rate_(rate), clock_(clock) { reset(); }
    void reset(); // registers and resampler only; RAM is retained
    void clear_memory() { ram_.fill(0); }
    void write(uint8_t offset, uint8_t data);
    void write_memory(uint16_t offset, uint8_t data) { ram_[uint16_t(wbank_ | offset)] = data; }
    uint8_t read_memory(uint16_t offset) const { return ram_[offset]; }
    uint8_t read(uint8_t offset) const { return channels_[(offset & 14) >> 1].addr >> ((offset & 1) ? 19 : 11); }
    bool load(const uint8_t *data, uint32_t offset, uint32_t size);
    uint32_t bank() const { return wbank_; }
    uint32_t sample_rate() const { return rate_; }
    void generate(float *left, float *right, uint32_t frames);
private:
    struct Channel { uint8_t enable=0, env=0, pan=0, start=0; uint32_t addr=0; uint16_t step=0, loopst=0; };
    std::array<Channel, 8> channels_{};
    std::array<uint8_t, 65536> ram_{};
    uint8_t cbank_=0, enable_=0;
    uint16_t wbank_=0;
    uint32_t rate_, clock_;
    uint64_t phase_=0;
    float left_=0, right_=0;
    void tick();
};
