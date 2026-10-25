// Offline PC Engine sound sketch using the actual standalone SDK HuC6280.
// Original waves, host-fed DDA and noise; no device, ROM or external assets.
#include <tetorica/huc6280.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <vector>

namespace {
constexpr uint32_t RATE = 48000, FRAMES = RATE * 3, CLOCK = 3579545;
constexpr double PI = 3.14159265358979323846;
using Core = std::unique_ptr<void, void (*)(void *)>;
void write(void *chip, unsigned reg, unsigned value, int channel = -1) {
    native_huc6280_write(chip, reg, uint8_t(value), channel);
}
double frequency(int midi) { return 440.0 * std::pow(2.0, (midi - 69) / 12.0); }
void note(void *chip, unsigned channel, int midi, uint8_t volume) {
    // One 32-sample wave cycle takes 32 * period chip clocks. Zero means 4096.
    const long period = std::lround(CLOCK / (32.0 * frequency(midi)));
    if (channel >= 6 || period < 1 || period > 4096)
        throw std::runtime_error("Note is outside the HuC6280 hardware pitch range");
    write(chip, 2, unsigned(period) & 0xff, int(channel));
    write(chip, 3, (unsigned(period) >> 8) & 0x0f, int(channel));
    write(chip, 4, 0x80 | volume, int(channel));
}

void configure(void *chip) {
    std::array<uint8_t, 32> triangle{}, sine{}, pulse{};
    for (unsigned i = 0; i < 32; ++i) {
        triangle[i] = uint8_t(i < 16 ? 1 + 2 * i : 63 - 2 * i);
        sine[i] = uint8_t(std::lround(16 + 15 * std::sin(2 * PI * i / 32)));
        pulse[i] = uint8_t(i < 16 ? 24 : 8);
    }
    // The helper synchronously copies 32 unsigned 5-bit DAC values into owned RAM.
    native_huc6280_waveform(chip, 0, triangle.data());
    native_huc6280_waveform(chip, 1, sine.data());
    native_huc6280_waveform(chip, 2, pulse.data());
    write(chip, 1, 0xff); // Global balance: full left and right.
    write(chip, 9, 0);    // LFO disabled; channel 1 is an independent voice here.
    write(chip, 7, 0x9a, 4); // Noise is available only on channels 4 and 5.
    write(chip, 7, 0x90, 5);
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
    Core chip(native_huc6280_create(RATE), native_huc6280_destroy);
    if (!chip) throw std::runtime_error("Could not allocate the HuC6280 core");
    configure(chip.get()); // Keep the reference clock; no outer clock conversion is needed.

    std::vector<uint8_t> wav;
    const uint32_t data_bytes = FRAMES * 4;
    wav.reserve(44 + data_bytes);
    tag(wav, "RIFF"); u32(wav, 36 + data_bytes); tag(wav, "WAVE");
    tag(wav, "fmt "); u32(wav, 16); u16(wav, 1); u16(wav, 2);
    u32(wav, RATE); u32(wav, RATE * 4); u16(wav, 4); u16(wav, 16);
    tag(wav, "data"); u32(wav, data_bytes);

    const std::array<int, 4> melody{{72, 76, 79, 84}}, harmony{{60, 67, 64, 67}}, bass{{48, 52, 55, 60}};
    constexpr uint32_t step = RATE / 4, noise_frames = RATE / 16;
    double dda_phase = 0, dda_step = 0;
    for (uint32_t frame = 0; frame < FRAMES; ++frame) {
        const uint32_t index = frame / step, within = frame % step, phrase = index / 4;
        if (within == 0) {
            native_huc6280_stop(chip.get());
            // Per-channel balance high nibble is left, low nibble is right.
            // Phrase 1: triangle L/sine R. Phrase 2: pulse+noise L/DDA+noise R.
            // Phrase 3: reverse melody sides, center bass/DDA and split noise.
            write(chip.get(), 5, phrase == 2 ? 0x0f : 0xf0, 0);
            write(chip.get(), 5, phrase == 2 ? 0xf0 : 0x0f, 1);
            write(chip.get(), 5, phrase == 2 ? 0xff : 0xf0, 2);
            write(chip.get(), 5, phrase == 2 ? 0xff : 0x0f, 3);
            write(chip.get(), 5, 0x0f, 4); write(chip.get(), 5, 0xf0, 5);
            if (phrase != 1) {
                note(chip.get(), 0, melody[index % 4], 30);
                note(chip.get(), 1, harmony[index % 4], 28);
            }
            if (phrase != 0) {
                note(chip.get(), 2, bass[index % 4], 28);
                // DDA is an unsigned 5-bit latch: 16 is neutral, not zero.
                write(chip.get(), 4, 0x40 | 27, 3);
                write(chip.get(), 6, 16, 3);
                write(chip.get(), 4, 0xc0 | 27, 3);
                dda_phase = 0; dda_step = frequency(melody[index % 4] - 12) / RATE;
            }
        }
        if (phrase != 0) {
            write(chip.get(), 6, unsigned(std::lround(16 + 11 * std::sin(2 * PI * dda_phase))), 3);
            dda_phase += dda_step; dda_phase -= std::floor(dda_phase);
            const unsigned decay = within * 14 / noise_frames;
            write(chip.get(), 4, within < noise_frames ? 0x80 | (22 - decay) : 0, 4);
            write(chip.get(), 4, within < noise_frames ? 0x80 | (19 - decay) : 0, 5);
        }
        float left, right;
        native_huc6280_sample(chip.get(), &left, &right);
        const double fade = std::min(1.0, std::min(within / 240.0, (step - 1 - within) / 1200.0));
        // Fixed gain and per-note fades reserve headroom without normalization/clipping.
        sample(wav, 0.55 * fade * left); sample(wav, 0.55 * fade * right);
    }
    return wav;
}
}

int main(int argc, char **argv) {
    if (argc != 2) { std::cerr << "Usage: tetorica_pcengine_wav <output.wav>\n"; return 2; }
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
        std::cerr << "WAV export failed: " << error.what() << '\n'; return 1;
    }
}
