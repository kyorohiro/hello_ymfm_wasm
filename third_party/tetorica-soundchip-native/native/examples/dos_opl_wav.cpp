// Three one-second DOS-style sound sketches: OPL, OPL2 and OPL3.
// Actual selected SDK cores; synthetic notes/rhythm, no device or sample assets.
#include <tetorica/opl.hpp>
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
constexpr uint32_t RATE = 48000, FRAMES = RATE * 3;
using Core = std::unique_ptr<void, void (*)(void *)>;
void write(void *chip, unsigned reg, unsigned value) { native_opl_write(chip, uint16_t(reg), uint8_t(value)); }

uint8_t pitch(void *chip, unsigned kind, unsigned channel, int midi, bool key_on) {
    const double hz = 440 * std::pow(2.0, (midi - 69) / 12.0);
    const uint32_t clock = kind == 2 ? 14318180 : 3579545, divider = kind == 2 ? 288 : 72;
    double error = std::numeric_limits<double>::infinity();
    unsigned block = 0, fnum = 0;
    for (unsigned candidate = 0; candidate < 8; ++candidate) {
        const double unit = clock * std::ldexp(1.0, int(candidate)) / (divider * 1048576.0);
        const long rounded = std::lround(hz / unit);
        if (rounded < 1 || rounded > 1023) continue;
        const double difference = std::abs(unit * rounded - hz);
        if (difference < error) { error = difference; block = candidate; fnum = unsigned(rounded); }
    }
    if (channel > 8 || !fnum) throw std::runtime_error("Note is outside the OPL hardware pitch range");
    const uint8_t control = uint8_t((block << 2) | (fnum >> 8));
    write(chip, 0xa0 + channel, fnum);
    write(chip, 0xb0 + channel, control | (key_on ? 32 : 0));
    return control;
}

void op(void *chip, unsigned slot, unsigned level, unsigned waveform) {
    write(chip, 0x20 + slot, 0x21); // Sustained envelope, multiplier 1.
    write(chip, 0x40 + slot, level);
    write(chip, 0x60 + slot, 0xf0);
    write(chip, 0x80 + slot, 0x0f);
    write(chip, 0xe0 + slot, waveform);
}

void configure(void *chip, unsigned kind) {
    if (kind == 2) {
        write(chip, 0x105, 1); // OPL3 NEW mode must precede upper-bank controls.
        write(chip, 0x104, 1); // One four-operator pair: physical channels 0+3.
        op(chip, 0, 32, 4); op(chip, 3, 28, 0);
        op(chip, 8, 32, 6); op(chip, 11, 10, 0);
        write(chip, 0xc0, 0x10); write(chip, 0xc3, 0x10); // Four-op chain, left bus.
    } else {
        write(chip, 1, kind == 1 ? 0x20 : 0); // OPL2 waveform select enable.
        op(chip, 0, kind == 1 ? 32 : 42, 0);
        op(chip, 3, 12, kind == 1 ? 1 : 0); // OPL sine versus OPL2 half-sine.
        write(chip, 0xc0, 0); // Two-operator FM chain.
    }
    op(chip, 16, 48, 0); op(chip, 19, 36, 0); // Light bass-drum rhythm voice.
    write(chip, 0xc6, kind == 2 ? 0x30 : 0);
    pitch(chip, kind, 6, 43, false);
    write(chip, 0xbd, 0x20); // Rhythm mode shares physical channels 6..8.
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
    std::vector<uint8_t> wav;
    const uint32_t data_bytes = FRAMES * 4;
    wav.reserve(44 + data_bytes);
    tag(wav, "RIFF"); u32(wav, 36 + data_bytes); tag(wav, "WAVE");
    tag(wav, "fmt "); u32(wav, 16); u16(wav, 1); u16(wav, 2);
    u32(wav, RATE); u32(wav, RATE * 4); u16(wav, 4); u16(wav, 16);
    tag(wav, "data"); u32(wav, data_bytes);
    const std::array<int, 4> notes{{60,64,67,72}};
    for (unsigned kind = 0; kind < 3; ++kind) {
        // A new selected core per section; aliases/headers do not choose kind.
        Core chip(native_opl_create(RATE, uint8_t(kind)), native_opl_destroy);
        if (!chip) throw std::runtime_error("Could not allocate the selected OPL core");
        if (!native_opl_set_clock(chip.get(), kind == 2 ? 14318180 : 3579545))
            throw std::runtime_error("Could not configure the reference OPL clock");
        configure(chip.get(), kind);
        uint8_t control = 0;
        constexpr uint32_t step = RATE / 4;
        for (uint32_t frame = 0; frame < RATE; ++frame) {
            const uint32_t within = frame % step, index = frame / step;
            if (within == 0) {
                control = pitch(chip.get(), kind, 0, notes[index], true);
                write(chip.get(), 0xbd, 0x30);
            }
            if (within == RATE / 32) write(chip.get(), 0xbd, 0x20);
            if (within == step * 4 / 5) write(chip.get(), 0xb0, control);
            if (kind == 2 && frame == RATE / 2) {
                write(chip.get(), 0xc0, 0x20); write(chip.get(), 0xc3, 0x20); // Right bus.
            }
            float left, right;
            native_opl_sample(chip.get(), &left, &right);
            const double fade = std::min(1.0, std::min(frame / 240.0, (RATE - 1 - frame) / 1440.0));
            sample(wav, 0.45 * fade * left); sample(wav, 0.45 * fade * right);
        }
    }
    return wav;
}
}

int main(int argc, char **argv) {
    if (argc != 2) { std::cerr << "Usage: tetorica_dos_opl_wav <output.wav>\n"; return 2; }
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
