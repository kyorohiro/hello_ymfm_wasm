// Offline Game Boy sound sketch using the actual standalone SDK APU.
// Original notes/wave RAM and noise; no device, ROM or external sample assets.
#include <tetorica/gameboy.hpp>
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
constexpr uint32_t RATE = 48000, FRAMES = RATE * 3, CLOCK = 4194304;
using Core = std::unique_ptr<void, void (*)(void *)>;
void write(void *chip, uint8_t offset, uint8_t value) { native_gameboy_write(chip, offset, value); }

void note(void *chip, unsigned channel, int midi) {
    const double hz = 440.0 * std::pow(2.0, (midi - 69) / 12.0);
    // Pulse: clock / (32 * (2048-N)); 32-sample wave: clock / (64 * (2048-N)).
    const long period = std::lround(CLOCK / ((channel == 2 ? 64.0 : 32.0) * hz));
    if (channel > 2 || period < 1 || period > 2048)
        throw std::runtime_error("Note is outside the Game Boy hardware pitch range");
    const uint16_t frequency = uint16_t(2048 - period);
    const uint8_t low = channel == 0 ? 0x03 : channel == 1 ? 0x08 : 0x0d;
    write(chip, low, uint8_t(frequency));
    write(chip, uint8_t(low + 1), uint8_t(0x80 | (frequency >> 8))); // Trigger; no length gate.
}

void configure(void *chip) {
    // All addresses are offsets from GB I/O FF10, not absolute CPU addresses.
    write(chip, 0x16, 0x80); // NR52: sound controller power.
    write(chip, 0x14, 0x77); // NR50: equal maximum output gains in the retained core convention.
    write(chip, 0x00, 0x00); // NR10: no pulse-1 sweep.
    write(chip, 0x01, 0x80); write(chip, 0x02, 0xf0); // Pulse 1: 50%, constant envelope.
    write(chip, 0x06, 0x80); write(chip, 0x07, 0xf0); // Pulse 2: 50%, constant envelope.
    write(chip, 0x0a, 0x00); // Wave DAC off while writing its 16 owned RAM bytes.
    // Original 32-nibble triangle, rising 0..15 then falling 15..0.
    for (unsigned byte = 0; byte < 16; ++byte) {
        const unsigned index = byte * 2;
        const unsigned first = index < 16 ? index : 31 - index;
        const unsigned second = index + 1 < 16 ? index + 1 : 30 - index;
        write(chip, uint8_t(0x20 + byte), uint8_t((first << 4) | second));
    }
    write(chip, 0x0a, 0x80); write(chip, 0x0c, 0x20); // Wave DAC on, full nibble level.
    write(chip, 0x11, 0xf2); // Noise: short decaying envelope.
    write(chip, 0x12, 0x35); // Long LFSR, divisor 80 << 3 CPU cycles.
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
    Core chip(native_gameboy_create(RATE), native_gameboy_destroy);
    if (!chip) throw std::runtime_error("Could not allocate the Game Boy core");
    if (!native_gameboy_set_clock(chip.get(), CLOCK))
        throw std::runtime_error("Could not configure the reference Game Boy clock");
    configure(chip.get());

    std::vector<uint8_t> wav;
    const uint32_t data_bytes = FRAMES * 4;
    wav.reserve(44 + data_bytes);
    tag(wav, "RIFF"); u32(wav, 36 + data_bytes); tag(wav, "WAVE");
    tag(wav, "fmt "); u32(wav, 16); u16(wav, 1); u16(wav, 2);
    u32(wav, RATE); u32(wav, RATE * 4); u16(wav, 4); u16(wav, 16);
    tag(wav, "data"); u32(wav, data_bytes);

    const std::array<int, 4> melody{{72, 76, 79, 84}}, harmony{{60, 67, 64, 67}}, bass{{48, 52, 55, 60}};
    constexpr uint32_t step = RATE / 4;
    for (uint32_t frame = 0; frame < FRAMES; ++frame) {
        const uint32_t index = frame / step, within = frame % step, phrase = index / 4;
        if (within == 0) {
            native_gameboy_stop(chip.get());
            // NR51 high nibble is left, low nibble is right. First: pulses
            // split L/R. Second: wave L, noise R. Last: pulse sides reverse,
            // with centered wave/noise. The first two phrases isolate voices.
            write(chip.get(), 0x15, phrase == 0 ? 0x12 : phrase == 1 ? 0x48 : 0xed);
            if (phrase != 1) {
                note(chip.get(), 0, melody[index % 4]);
                note(chip.get(), 1, harmony[index % 4]);
            }
            if (phrase != 0) {
                note(chip.get(), 2, bass[index % 4]);
                write(chip.get(), 0x10, 0x30); // Noise length: roughly 1/16 second.
                write(chip.get(), 0x13, 0xc0); // Noise trigger plus length enable.
            }
        }
        float left, right;
        native_gameboy_sample(chip.get(), &left, &right);
        const double fade = std::min(1.0, std::min(within / 240.0, (step - 1 - within) / 1200.0));
        // Four full-level sources are bounded by 1.0 in this output model;
        // fixed gain reserves headroom without peak normalization or clipping.
        sample(wav, 0.6 * fade * left); sample(wav, 0.6 * fade * right);
    }
    return wav;
}
}

int main(int argc, char **argv) {
    if (argc != 2) { std::cerr << "Usage: tetorica_gameboy_wav <output.wav>\n"; return 2; }
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
