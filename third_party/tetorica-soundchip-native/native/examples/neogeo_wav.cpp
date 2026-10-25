// Offline NeoGeo sound sketch: one four-FM YM2610 at 8 MHz.
// Both ADPCM ROM banks contain original synthetic data, not game/hardware ROMs.
#include <tetorica/ym2610.hpp>
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
constexpr uint32_t RATE = 48000, FRAMES = RATE * 3, CLOCK = 8000000;
constexpr double PI = 3.14159265358979323846;
using Core = std::unique_ptr<void, void (*)(void *)>;
double note_hz(int midi) { return 440.0 * std::pow(2.0, (midi - 69) / 12.0); }
void write(void *chip, unsigned port, unsigned reg, unsigned value) {
    native_ym2610b_write(chip, uint8_t(port), uint8_t(reg), uint8_t(value));
}

void fm_note(void *chip, unsigned channel, int midi) {
    const double hz = note_hz(midi);
    double error = std::numeric_limits<double>::infinity();
    unsigned block = 0, fnum = 0;
    for (unsigned candidate = 0; candidate < 8; ++candidate) {
        const double unit = CLOCK * std::ldexp(1.0, int(candidate) - 1) / (144.0 * 1048576.0);
        const long rounded = std::lround(hz / unit);
        if (rounded < 1 || rounded > 2047) continue;
        const double difference = std::abs(unit * rounded - hz);
        if (difference < error) { error = difference; block = candidate; fnum = unsigned(rounded); }
    }
    if (channel > 5 || !((0x36u >> channel) & 1) || !fnum) throw std::runtime_error("FM note is outside the hardware pitch range");
    // Shared OPN frequency latch: keep the high/low writes adjacent.
    write(chip, channel / 3, 0xa4 + channel % 3, (block << 3) | (fnum >> 8));
    write(chip, channel / 3, 0xa0 + channel % 3, fnum);
    write(chip, 0, 0x28, 0xf0 | (channel < 3 ? channel : channel + 1));
}

void ssg_pitch(void *chip, unsigned channel, int midi) {
    // OPNB SSG clock=master/4: tone frequency=master/(64*period).
    const long period = std::lround(CLOCK / (64.0 * note_hz(midi)));
    if (channel > 2 || period < 1 || period > 4095)
        throw std::runtime_error("SSG note is outside the hardware pitch range");
    write(chip, 0, channel * 2, unsigned(period) & 255);
    write(chip, 0, channel * 2 + 1, unsigned(period) >> 8);
}

// Small greedy Yamaha encoders for this synthetic example. Both pack the high
// nibble first, but ADPCM-A wraps a 12-bit predictor and ADPCM-B clamps 16 bits.
std::vector<uint8_t> encode(const std::vector<double> &pcm, bool adpcm_b) {
    if (pcm.empty() || pcm.size() % 2) throw std::runtime_error("Invalid synthetic sample length");
    static const int steps[49] = {16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,73,
        80,88,97,107,118,130,143,157,173,190,209,230,253,279,307,337,371,408,449,
        494,544,598,658,724,796,876,963,1060,1166,1282,1411,1552};
    static const int adjust_a[8] = {-1,-1,-1,-1,2,5,7,9};
    static const int adjust_b[8] = {57,57,57,57,77,102,128,153};
    std::vector<uint8_t> bytes(pcm.size() / 2, 0);
    int predictor = 0, index = 0, step_b = 127;
    for (size_t frame = 0; frame < pcm.size(); ++frame) {
        const int target = int(std::lround(pcm[frame] * (adpcm_b ? 32767.0 : 2047.0)));
        const int step = adpcm_b ? step_b : steps[index];
        int best = 0, best_value = 0, error = std::numeric_limits<int>::max();
        for (int code = 0; code < 16; ++code) {
            const int delta = ((2 * (code & 7) + 1) * step / 8) * ((code & 8) ? -1 : 1);
            int value = predictor + delta;
            if (adpcm_b) value = std::max(-32768, std::min(32767, value));
            else { value = (value % 4096 + 4096) % 4096; if (value >= 2048) value -= 4096; }
            if (std::abs(value - target) < error) {
                best = code; best_value = value; error = std::abs(value - target);
            }
        }
        bytes[frame / 2] |= uint8_t(best << (frame % 2 ? 0 : 4));
        predictor = best_value;
        if (adpcm_b) step_b = std::max(127, std::min(24576, step_b * adjust_b[best & 7] / 64));
        else index = std::max(0, std::min(48, index + adjust_a[best & 7]));
    }
    return bytes;
}

std::vector<uint8_t> adpcm_a_rom() {
    // Unlike OPNA fixed rhythm, OPNB programs each A voice's ROM range.
    // Six independent 1 KiB samples, each aligned to 256-byte address units.
    const std::array<unsigned, 7> offsets{{0,1024,2048,3072,4096,5120,6144}};
    std::vector<uint8_t> rom(offsets.back(), 0);
    uint32_t random = 0x13579bdf;
    for (unsigned voice = 0; voice < 6; ++voice) {
        std::vector<double> pcm((offsets[voice + 1] - offsets[voice]) * 2);
        for (size_t i = 0; i < pcm.size(); ++i) {
            const double t = double(i) / (pcm.size() - 1);
            random = random * 1664525u + 1013904223u;
            const double noise = double(random >> 8) / 8388607.5 - 1.0;
            const double tone = std::sin(2 * PI * (6 + voice * 3) * t);
            pcm[i] = 0.65 * std::exp(-8 * t) * (voice == 0 || voice == 4 ? tone : noise);
        }
        const auto bytes = encode(pcm, false);
        std::copy(bytes.begin(), bytes.end(), rom.begin() + offsets[voice]);
    }
    return rom;
}

std::vector<uint8_t> plucked_sample() {
    // A 220 Hz pluck at 16 kHz; 4096 decoded frames = 2048 aligned ROM bytes.
    std::vector<double> pcm(4096);
    for (size_t i = 0; i < pcm.size(); ++i) {
        const double time = i / 16000.0;
        const double gate = std::min(1.0, std::min(i / 16.0, (pcm.size() - 1 - i) / 128.0));
        pcm[i] = 0.55 * gate * std::exp(-14 * time) * std::sin(2 * PI * 220 * time);
    }
    return encode(pcm, true);
}

void configure(void *chip, size_t sample_bytes) {
    // Immutable variant 0 exposes physical FM slots 1,2,4,5, not 0,1,2,3.
    const std::array<unsigned, 6> levels{{127,20,42,127,44,46}};
    for (unsigned channel = 0; channel < 6; ++channel) {
        for (unsigned op = 0; op < 4; ++op) {
            const unsigned offset = op * 4 + channel % 3;
            write(chip, channel / 3, 0x30 + offset, 1);
            write(chip, channel / 3, 0x40 + offset, op == 0 ? levels[channel] : 127);
            write(chip, channel / 3, 0x50 + offset, 31);
            write(chip, channel / 3, 0x60 + offset, 0);
            write(chip, channel / 3, 0x70 + offset, 0);
            write(chip, channel / 3, 0x80 + offset, 15);
        }
        write(chip, channel / 3, 0xb0 + channel % 3, 7);
        write(chip, channel / 3, 0xb4 + channel % 3, channel == 2 ? 0x80 : channel == 4 ? 0x40 : 0xc0);
    }
    write(chip, 0, 6, 12); write(chip, 0, 7, 0xf8);
    write(chip, 0, 11, 1563 & 255); write(chip, 0, 12, 1563 >> 8);
    write(chip, 1, 1, 50); // ADPCM-A total level: higher is louder.
    for (unsigned voice = 0; voice < 6; ++voice) {
        write(chip, 1, 8 + voice, (voice == 1 ? 0x80 : voice == 3 ? 0x40 : 0xc0) | 24);
        const unsigned first = voice * 4, last = first + 3;
        write(chip, 1, 0x10 + voice, first & 255); write(chip, 1, 0x18 + voice, first >> 8);
        write(chip, 1, 0x20 + voice, last & 255); write(chip, 1, 0x28 + voice, last >> 8);
    }
    write(chip, 0, 0x10, 1); // B registers are on port 0, starting at 0x10.
    write(chip, 0, 0x11, 0xc0); // Both outputs, fixed 256-byte ROM addressing.
    write(chip, 0, 0x12, 0); write(chip, 0, 0x13, 0);
    const unsigned last = unsigned(sample_bytes / 256 - 1); // Inclusive end unit.
    write(chip, 0, 0x14, last & 255); write(chip, 0, 0x15, last >> 8);
    write(chip, 0, 0x1b, 140);
}

void adpcm_note(void *chip, int midi) {
    const double rate = 16000.0 * note_hz(midi) / 220.0;
    const long delta = std::lround(rate * 144.0 * 65536.0 / CLOCK);
    if (delta < 1 || delta > 65535) throw std::runtime_error("ADPCM-B rate is outside the hardware range");
    write(chip, 0, 0x10, 1);
    write(chip, 0, 0x19, unsigned(delta) & 255); write(chip, 0, 0x1a, unsigned(delta) >> 8);
    write(chip, 0, 0x10, 0xa0); // Start external B-ROM playback once; no repeat.
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
    Core chip(native_ym2610b_create(RATE, 0), native_ym2610b_destroy);
    if (!chip) throw std::runtime_error("Could not allocate the four-FM YM2610 core");
    if (!native_ym2610b_set_clock(chip.get(), CLOCK)) throw std::runtime_error("Could not set the reference clock");
    const auto rom_a = adpcm_a_rom(), rom_b = plucked_sample();
    if (!native_ym2610b_load_rom(chip.get(), 0, rom_a.data(), 0, uint32_t(rom_a.size())) ||
        !native_ym2610b_load_rom(chip.get(), 1, rom_b.data(), 0, uint32_t(rom_b.size())))
        throw std::runtime_error("Could not upload the synthetic ADPCM ROM banks");
    configure(chip.get(), rom_b.size());

    std::vector<uint8_t> wav;
    const uint32_t data_bytes = FRAMES * 4;
    wav.reserve(44 + data_bytes);
    tag(wav, "RIFF"); u32(wav, 36 + data_bytes); tag(wav, "WAVE");
    tag(wav, "fmt "); u32(wav, 16); u16(wav, 1); u16(wav, 2);
    u32(wav, RATE); u32(wav, RATE * 4); u16(wav, 4); u16(wav, 16);
    tag(wav, "data"); u32(wav, data_bytes);
    const std::array<int, 8> melody{{67,69,72,74,72,69,65,67}};
    const std::array<int, 8> bass{{48,48,53,55,53,48,55,48}};
    constexpr uint32_t step = RATE / 3;
    for (uint32_t frame = 0; frame < FRAMES; ++frame) {
        const uint32_t index = frame / step, within = frame % step;
        if (index < melody.size()) {
            if (within == 0) {
                fm_note(chip.get(), 1, melody[index]);
                fm_note(chip.get(), 2, melody[index] - 12);
                fm_note(chip.get(), 4, bass[index] + 7);
                fm_note(chip.get(), 5, bass[index]);
                for (unsigned channel = 0; channel < 3; ++channel)
                    ssg_pitch(chip.get(), channel, channel == 0 ? bass[index] : channel == 1 ? melody[index] + 12 : bass[index] + 19);
                write(chip.get(), 0, 8, 9); write(chip.get(), 0, 9, 16); write(chip.get(), 0, 10, 6);
                write(chip.get(), 0, 13, 9);
                write(chip.get(), 1, 0, (index % 2 ? 2 : 1) | 8); // A-ROM kick/snare + hat.
                adpcm_note(chip.get(), bass[index] + 12);
            }
            if (within == step * 4 / 5) {
                for (unsigned channel : {1u,2u,4u,5u}) write(chip.get(), 0, 0x28, channel < 3 ? channel : channel + 1);
                for (unsigned channel = 0; channel < 3; ++channel) write(chip.get(), 0, 8 + channel, 0);
                write(chip.get(), 0, 0x10, 1);
            }
        }
        float left, right;
        native_ym2610b_sample(chip.get(), &left, &right);
        const double fade = std::min(1.0, std::min(frame / 240.0, (FRAMES - 1 - frame) / 12000.0));
        // One postmix export gain preserves the core's FM/SSG/ADPCM balance.
        sample(wav, fade * 0.4 * left); sample(wav, fade * 0.4 * right);
    }
    return wav;
}
}

int main(int argc, char **argv) {
    if (argc != 2) { std::cerr << "Usage: tetorica_neogeo_wav <output.wav>\n"; return 2; }
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
