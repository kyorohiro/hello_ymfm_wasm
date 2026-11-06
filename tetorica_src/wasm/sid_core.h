// Tetorica SID host, BSD-3-Clause. The included chip retains its zlib license.
#pragma once
#include <array>
#include <cmath>
#include <cstdint>
#include <cassert>
#define CHIPS_IMPL
#include "../../third_party/chips-m6581/m6581.h"

namespace tetorica {
class SidCore {
public:
    static constexpr unsigned queueCapacity = 4096;
    SidCore(int sampleRate, int clockHz) : sampleRate_(sampleRate), clockHz_(clockHz) {
        assert(sampleRate >= 8000 && sampleRate <= 96000 && clockHz >= 900000 && clockHz <= 1100000);
        reset();
    }
    void reset() {
        m6581_desc_t desc{};
        desc.tick_hz = clockHz_; desc.sound_hz = sampleRate_; desc.magnitude = 1.0f;
        m6581_init(&chip_, &desc);
        registers_.fill(0); queueRead_ = queueCount_ = 0; cycles_ = 0;
        previousInput_ = previousOutput_ = 0;
        dcPole_ = std::exp(-2.0 * 3.14159265358979323846 * 12.0 / sampleRate_);
    }
    bool write(unsigned reg, unsigned value) {
        if (reg > 31 || value > 255 || queueCount_ == queueCapacity) return false;
        uint64_t pins = M6581_CS | reg;
        M6581_SET_DATA(pins, value);
        tick(pins);
        registers_[reg] = static_cast<uint8_t>(value);
        return true;
    }
    int read(unsigned reg) {
        if (reg > 31 || queueCount_ == queueCapacity) return -1;
        return M6581_GET_DATA(tick(M6581_CS | M6581_RW | reg));
    }
    void render(float* output, unsigned frames) {
        for (unsigned i = 0; i < frames; ++i) {
            while (queueCount_ == 0) tick(0);
            output[i] = queue_[queueRead_];
            queueRead_ = (queueRead_ + 1) % queueCapacity;
            --queueCount_;
        }
    }
    const std::array<uint8_t, 32>& registers() const { return registers_; }
    uint64_t cycles() const { return cycles_; }
    unsigned envelope(unsigned voice) const { return chip_.voice[voice].env_cur_level & 255; }
    unsigned phase(unsigned voice) const { return chip_.voice[voice].wav_accum; }
private:
    uint64_t tick(uint64_t pins) {
        const auto result = m6581_tick(&chip_, pins);
        ++cycles_;
        if (result & M6581_SAMPLE) {
            const double input = chip_.sample;
            const double output = input - previousInput_ + dcPole_ * previousOutput_;
            previousInput_ = input; previousOutput_ = output;
            queue_[(queueRead_ + queueCount_) % queueCapacity] = static_cast<float>(output);
            ++queueCount_;
        }
        return result;
    }
    m6581_t chip_{};
    int sampleRate_, clockHz_;
    std::array<uint8_t, 32> registers_{};
    std::array<float, queueCapacity> queue_{};
    unsigned queueRead_ = 0, queueCount_ = 0;
    uint64_t cycles_ = 0;
    double previousInput_ = 0, previousOutput_ = 0, dcPole_ = 0;
};
}
