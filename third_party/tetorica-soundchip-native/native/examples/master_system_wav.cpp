// Offline Master System FM-style sketch: actual OPLL + Sega PSG SDK cores.
// Synthetic notes and built-in rhythm voices; no device, ROM or extra library.
#include <tetorica/segapsg.hpp>
#include <tetorica/ym2413.hpp>
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
constexpr uint32_t RATE = 48000, FRAMES = RATE * 3, CLOCK = 3579545;
using Core = std::unique_ptr<void, void (*)(void *)>;
double note_hz(int midi) { return 440.0 * std::pow(2.0, (midi - 69) / 12.0); }

uint8_t opll_note(void *chip, int midi) {
    const double hz = note_hz(midi);
    double error = std::numeric_limits<double>::infinity();
    unsigned block = 0, fnum = 0;
    for (unsigned candidate = 0; candidate < 8; ++candidate) {
        // OPLL hardware pitch differs from OPN: no BLOCK-1 factor here.
        const double unit = CLOCK * std::ldexp(1.0, int(candidate)) / (72.0 * 524288.0);
        const long rounded = std::lround(hz / unit);
        if (rounded < 1 || rounded > 511) continue;
        const double difference = std::abs(unit * rounded - hz);
        if (difference < error) { error = difference; block = candidate; fnum = unsigned(rounded); }
    }
    if (!fnum) throw std::runtime_error("OPLL note is outside the hardware pitch range");
    const uint8_t control = uint8_t((block << 1) | (fnum >> 8));
    native_ym2413_write(chip, 0x10, uint8_t(fnum));
    native_ym2413_write(chip, 0x20, control | 0x10);
    return control;
}

void psg_tone(void *chip, unsigned channel, int midi, uint8_t attenuation) {
    const long period = std::lround(CLOCK / (32.0 * note_hz(midi)));
    if (channel > 2 || period < 2 || period > 1023)
        throw std::runtime_error("PSG note is outside the hardware pitch range");
    native_game_gear_write(chip, uint8_t(0x80 | (channel << 5) | (period & 15)));
    native_game_gear_write(chip, uint8_t(period >> 4));
    native_game_gear_write(chip, uint8_t(0x90 | (channel << 5) | attenuation));
}

void configure_opll(void *chip) {
    native_ym2413_write(chip, 0x30, 0x33); // Built-in piano, attenuation 3, FM channel 0.
    // Rhythm shares physical channels 6..8; the melody stays on channel 0.
    native_ym2413_write(chip, 0x16, 0xc0); native_ym2413_write(chip, 0x26, 0x06);
    native_ym2413_write(chip, 0x17, 0x00); native_ym2413_write(chip, 0x27, 0x09);
    native_ym2413_write(chip, 0x18, 0x80); native_ym2413_write(chip, 0x28, 0x08);
    native_ym2413_write(chip, 0x36, 0x08); // BD volume.
    native_ym2413_write(chip, 0x37, 0xc9); // HH / SD volumes.
    native_ym2413_write(chip, 0x38, 0xac); // TOM / CYM volumes.
    native_ym2413_write(chip, 0x0e, 0x20); // Rhythm mode, initially no drum gates.
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
    Core opll(native_ym2413_create(RATE), native_ym2413_destroy);
    Core psg(native_game_gear_create(RATE), native_game_gear_destroy);
    if (!opll || !psg) throw std::runtime_error("Could not allocate the OPLL and PSG cores");
    if (!native_ym2413_set_clock(opll.get(), CLOCK) || !native_game_gear_set_clock(psg.get(), CLOCK))
        throw std::runtime_error("Could not configure the reference chip clocks");
    native_game_gear_set_stereo(psg.get(), 0xff); // Master System mono on both outputs.
    configure_opll(opll.get());

    std::vector<uint8_t> wav;
    const uint32_t data_bytes = FRAMES * 4;
    wav.reserve(44 + data_bytes);
    tag(wav, "RIFF"); u32(wav, 36 + data_bytes); tag(wav, "WAVE");
    tag(wav, "fmt "); u32(wav, 16); u16(wav, 1); u16(wav, 2);
    u32(wav, RATE); u32(wav, RATE * 4); u16(wav, 4); u16(wav, 16);
    tag(wav, "data"); u32(wav, data_bytes);

    const std::array<int, 8> melody{{72, 71, 69, 67, 64, 67, 69, 72}};
    const std::array<int, 8> bass{{48, 48, 53, 53, 55, 55, 48, 48}};
    constexpr uint32_t step = RATE / 3;
    uint8_t control = 0;
    for (uint32_t frame = 0; frame < FRAMES; ++frame) {
        const uint32_t index = frame / step, within = frame % step;
        if (index < melody.size()) {
            if (within == 0) {
                control = opll_note(opll.get(), melody[index]);
                psg_tone(psg.get(), 0, melody[index], 12);
                psg_tone(psg.get(), 1, bass[index], 10);
                psg_tone(psg.get(), 2, bass[index] + 7, 14);
                native_ym2413_write(opll.get(), 0x0e, index % 2 ? 0x29 : 0x31); // SD/BD + HH.
            }
            if (within == RATE / 30 || within == step / 2 + RATE / 30)
                native_ym2413_write(opll.get(), 0x0e, 0x20);
            if (within == step / 2) native_ym2413_write(opll.get(), 0x0e, 0x21); // HH.
            if (within == step * 4 / 5) {
                native_ym2413_write(opll.get(), 0x20, control); // Ordinary melodic release.
                for (uint8_t channel = 0; channel < 3; ++channel)
                    native_game_gear_key_off(psg.get(), channel);
            }
        }
        float ol, oright, pl, pr;
        native_ym2413_sample(opll.get(), &ol, &oright);
        native_game_gear_sample(psg.get(), &pl, &pr);
        const double fade = std::min(1.0, std::min(frame / 240.0, (FRAMES - 1 - frame) / 12000.0));
        // OPLL's bounded mono output plus all four PSG sources stays below
        // 0.7 with these fixed example gains; no normalization is applied.
        sample(wav, fade * (0.5 * ol + 0.25 * pl));
        sample(wav, fade * (0.5 * oright + 0.25 * pr));
    }
    return wav;
}
}

int main(int argc, char **argv) {
    if (argc != 2) { std::cerr << "Usage: tetorica_master_system_wav <output.wav>\n"; return 2; }
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
