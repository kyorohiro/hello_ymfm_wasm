// Offline PC-98 YM2203 sound sketch: three FM voices and three SSG voices.
// Synthetic register-level notes/noise/envelope; no devices or sample assets.
#include <tetorica/ym2203.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <limits>
#include <memory>
#include <stdexcept>
#include <vector>

namespace {
constexpr uint32_t RATE = 48000, FRAMES = RATE * 3, CLOCK = 4000000;
using Core = std::unique_ptr<void, void (*)(void *)>;
double note_hz(int midi) { return 440.0 * std::pow(2.0, (midi - 69) / 12.0); }
void write(void *chip, unsigned reg, unsigned value) {
    native_ym2203_write(chip, 0, uint8_t(reg), uint8_t(value));
}

void fm_note(void *chip, unsigned channel, int midi) {
    const double hz = note_hz(midi);
    double error = std::numeric_limits<double>::infinity();
    unsigned block = 0, fnum = 0;
    for (unsigned candidate = 0; candidate < 8; ++candidate) {
        // Standard YM2203 prescaler: Hz=FNUM*clock*2^(BLOCK-1)/(72*2^20).
        const double unit = CLOCK * std::ldexp(1.0, int(candidate) - 1) / (72.0 * 1048576.0);
        const long rounded = std::lround(hz / unit);
        if (rounded < 1 || rounded > 2047) continue;
        const double difference = std::abs(unit * rounded - hz);
        if (difference < error) { error = difference; block = candidate; fnum = unsigned(rounded); }
    }
    if (channel > 2 || !fnum) throw std::runtime_error("FM note is outside the hardware pitch range");
    // OPN shares the high-frequency latch: write high immediately before low.
    write(chip, 0xa4 + channel, (block << 3) | (fnum >> 8));
    write(chip, 0xa0 + channel, fnum);
    write(chip, 0x28, 0xf0 | channel);
}

void ssg_pitch(void *chip, unsigned channel, int midi) {
    // YM2203's standard effective SSG clock is master/2, not OPNA's master/4.
    const long period = std::lround(CLOCK / (32.0 * note_hz(midi)));
    if (channel > 2 || period < 1 || period > 4095)
        throw std::runtime_error("SSG note is outside the hardware pitch range");
    write(chip, channel * 2, unsigned(period) & 255);
    write(chip, channel * 2 + 1, unsigned(period) >> 8);
}

void configure(void *chip) {
    const std::array<unsigned, 3> levels{{20, 40, 44}};
    for (unsigned channel = 0; channel < 3; ++channel) {
        for (unsigned op = 0; op < 4; ++op) {
            const unsigned offset = op * 4 + channel;
            write(chip, 0x30 + offset, 1);
            write(chip, 0x40 + offset, op == 0 ? levels[channel] : 127);
            write(chip, 0x50 + offset, 31);
            write(chip, 0x60 + offset, 0);
            write(chip, 0x70 + offset, 0);
            write(chip, 0x80 + offset, 15);
        }
        write(chip, 0xb0 + channel, 7); // One independent sine carrier per FM voice.
    }
    write(chip, 6, 12); // Shared SSG noise period.
    write(chip, 7, 0xf8); // All tones enabled, noise disabled.
    // SSG has 32 envelope steps: 256*period/(master/2) gives about 200 ms.
    write(chip, 11, 1563 & 255);
    write(chip, 12, 1563 >> 8);
}

void u16(std::vector<uint8_t> &bytes, uint16_t value) {
    bytes.push_back(uint8_t(value)); bytes.push_back(uint8_t(value >> 8));
}
void u32(std::vector<uint8_t> &bytes, uint32_t value) {
    u16(bytes, uint16_t(value)); u16(bytes, uint16_t(value >> 16));
}
void tag(std::vector<uint8_t> &bytes, const char *value) { bytes.insert(bytes.end(), value, value + 4); }
void sample(std::vector<uint8_t> &bytes, double value) {
    if (!std::isfinite(value) || std::abs(value) >= 1.0)
        throw std::runtime_error("Generated PCM is non-finite or exceeds the output headroom");
    u16(bytes, uint16_t(int16_t(std::lround(value * 32767.0))));
}

std::vector<uint8_t> render() {
    Core chip(native_ym2203_create(RATE), native_ym2203_destroy);
    if (!chip) throw std::runtime_error("Could not allocate the YM2203 core");
    if (!native_ym2203_set_clock(chip.get(), CLOCK))
        throw std::runtime_error("Could not configure the reference chip clock");
    configure(chip.get());
    std::vector<uint8_t> wav;
    const uint32_t data_bytes = FRAMES * 4;
    wav.reserve(44 + data_bytes);
    tag(wav, "RIFF"); u32(wav, 36 + data_bytes); tag(wav, "WAVE");
    tag(wav, "fmt "); u32(wav, 16); u16(wav, 1); u16(wav, 2);
    u32(wav, RATE); u32(wav, RATE * 4); u16(wav, 4); u16(wav, 16);
    tag(wav, "data"); u32(wav, data_bytes);

    const std::array<int, 8> melody{{64, 67, 71, 72, 71, 67, 66, 64}};
    const std::array<int, 8> bass{{40, 40, 43, 45, 43, 40, 47, 40}};
    constexpr uint32_t step = RATE / 3;
    for (uint32_t frame = 0; frame < FRAMES; ++frame) {
        const uint32_t index = frame / step, within = frame % step;
        if (index < melody.size()) {
            if (within == 0) {
                fm_note(chip.get(), 0, melody[index]);
                fm_note(chip.get(), 1, melody[index] - 12);
                fm_note(chip.get(), 2, bass[index] + 12);
                ssg_pitch(chip.get(), 0, bass[index]);
                ssg_pitch(chip.get(), 1, melody[index] + 12);
                ssg_pitch(chip.get(), 2, bass[index] + 19);
                write(chip.get(), 7, 0xd8); // Third SSG tone has a short noise attack.
                write(chip.get(), 8, 9);
                write(chip.get(), 9, 0x10); // Second SSG voice uses the hardware envelope.
                write(chip.get(), 10, 7);
                write(chip.get(), 13, 9); // Descend, then hold at zero.
            }
            if (within == RATE / 20) write(chip.get(), 7, 0xf8);
            if (within == step * 4 / 5) {
                for (unsigned channel = 0; channel < 3; ++channel) {
                    write(chip.get(), 0x28, channel); // Ordinary FM envelope release.
                    write(chip.get(), 8 + channel, 0);
                }
            }
        }
        float left, right;
        native_ym2203_sample(chip.get(), &left, &right);
        const double fade = std::min(1.0, std::min(frame / 240.0, (FRAMES - 1 - frame) / 12000.0));
        // The core mixes FM+SSG to mono. This fixed export gain leaves headroom
        // and preserves that internal balance; it is not a motherboard mix model.
        sample(wav, fade * 0.4 * left);
        sample(wav, fade * 0.4 * right);
    }
    return wav;
}
}

int main(int argc, char **argv) {
    if (argc != 2) { std::cerr << "Usage: tetorica_pc98_ym2203_wav <output.wav>\n"; return 2; }
    try {
        const auto wav = render();
        std::ofstream output(argv[1], std::ios::binary | std::ios::trunc);
        if (!output) throw std::runtime_error("Could not open the selected output file");
        output.write(reinterpret_cast<const char *>(wav.data()), std::streamsize(wav.size()));
        output.close();
        if (!output) throw std::runtime_error("Could not finish writing the WAV file");
        std::cout << "Wrote 3 seconds of 48 kHz stereo PCM16 to " << argv[1] << '\n';
        return 0;
    } catch (const std::exception &error) {
        std::cerr << "WAV export failed: " << error.what() << '\n';
        return 1;
    }
}
