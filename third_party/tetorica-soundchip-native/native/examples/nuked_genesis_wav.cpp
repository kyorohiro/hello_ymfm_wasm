// Offline Nuked Genesis-style FM + PSG sketch using the actual standalone SDK cores.
// No audio device, external sample, application runtime or additional library.
#include <tetorica/segapsg.hpp>
#include <tetorica/nuked_ym2612.hpp>
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
constexpr uint32_t FM_CLOCK = 7670454, PSG_CLOCK = 3579545;
using Core = std::unique_ptr<void, void (*)(void *)>;

double note_hz(int midi) { return 440.0 * std::pow(2.0, (midi - 69) / 12.0); }

void fm_note(void *chip, int midi) {
    const double hz = note_hz(midi);
    double error = std::numeric_limits<double>::infinity();
    unsigned block = 0, fnum = 0;
    for (unsigned candidate = 0; candidate < 8; ++candidate) {
        // OPN hardware pitch: Hz = FNUM * clock * 2^(BLOCK-1) / (144*2^20).
        const double unit = FM_CLOCK * std::ldexp(1.0, int(candidate) - 1) / (144.0 * 1048576.0);
        const long rounded = std::lround(hz / unit);
        if (rounded < 1 || rounded > 2047) continue;
        const double difference = std::abs(unit * rounded - hz);
        if (difference < error) { error = difference; block = candidate; fnum = unsigned(rounded); }
    }
    if (!fnum) throw std::runtime_error("FM note is outside the hardware pitch range");
    native_nuked_ym2612_write(chip, 0, 0xa4, uint8_t((block << 3) | (fnum >> 8)));
    native_nuked_ym2612_write(chip, 0, 0xa0, uint8_t(fnum));
    native_nuked_ym2612_write(chip, 0, 0x28, 0xf0); // All four operators, channel 0.
}

void psg_tone(void *chip, unsigned channel, int midi, uint8_t attenuation) {
    // A square-wave cycle takes two periods at the clock/16 generator rate.
    const long period = std::lround(PSG_CLOCK / (32.0 * note_hz(midi)));
    if (channel > 2 || period < 2 || period > 1023)
        throw std::runtime_error("PSG note is outside the hardware pitch range");
    native_game_gear_write(chip, uint8_t(0x80 | (channel << 5) | (period & 15)));
    native_game_gear_write(chip, uint8_t(period >> 4));
    native_game_gear_write(chip, uint8_t(0x90 | (channel << 5) | attenuation));
}

void configure_fm(void *chip) {
    for (unsigned op = 0; op < 4; ++op) {
        const unsigned offset = op * 4;
        native_nuked_ym2612_write(chip, 0, uint8_t(0x30 + offset), 1);
        native_nuked_ym2612_write(chip, 0, uint8_t(0x40 + offset), op == 0 ? 0 : 127);
        native_nuked_ym2612_write(chip, 0, uint8_t(0x50 + offset), 31);
        native_nuked_ym2612_write(chip, 0, uint8_t(0x60 + offset), 4);
        native_nuked_ym2612_write(chip, 0, uint8_t(0x70 + offset), 0);
        native_nuked_ym2612_write(chip, 0, uint8_t(0x80 + offset), 15);
    }
    native_nuked_ym2612_write(chip, 0, 0xb0, 7);    // One audible independent carrier.
    native_nuked_ym2612_write(chip, 0, 0xb4, 0xc0); // Centered FM output.
}

void u16(std::vector<uint8_t> &bytes, uint16_t value) {
    bytes.push_back(uint8_t(value)); bytes.push_back(uint8_t(value >> 8));
}
void u32(std::vector<uint8_t> &bytes, uint32_t value) {
    u16(bytes, uint16_t(value)); u16(bytes, uint16_t(value >> 16));
}
void tag(std::vector<uint8_t> &bytes, const char *value) {
    bytes.insert(bytes.end(), value, value + 4);
}
void sample(std::vector<uint8_t> &bytes, double value) {
    if (!std::isfinite(value) || std::abs(value) >= 1.0)
        throw std::runtime_error("Generated PCM is non-finite or exceeds the output headroom");
    u16(bytes, uint16_t(int16_t(std::lround(value * 32767.0))));
}

std::vector<uint8_t> render() {
    Core fm(native_nuked_ym2612_create(RATE), native_nuked_ym2612_destroy);
    Core psg(native_game_gear_create(RATE), native_game_gear_destroy);
    if (!fm || !psg) throw std::runtime_error("Could not allocate the FM and PSG cores");
    if (!native_nuked_ym2612_set_clock(fm.get(), FM_CLOCK) || !native_game_gear_set_clock(psg.get(), PSG_CLOCK))
        throw std::runtime_error("Could not configure the reference chip clocks");
    // Genesis and Master System PSG output is mono on both channels. Game Gear
    // hosts may choose another mask; this example deliberately leaves all on.
    native_game_gear_set_stereo(psg.get(), 0xff);
    configure_fm(fm.get());

    std::vector<uint8_t> wav;
    const uint32_t data_bytes = FRAMES * 4;
    wav.reserve(44 + data_bytes);
    tag(wav, "RIFF"); u32(wav, 36 + data_bytes); tag(wav, "WAVE");
    tag(wav, "fmt "); u32(wav, 16); u16(wav, 1); u16(wav, 2);
    u32(wav, RATE); u32(wav, RATE * 4); u16(wav, 4); u16(wav, 16);
    tag(wav, "data"); u32(wav, data_bytes);

    const std::array<int, 8> melody{{60, 64, 67, 69, 67, 64, 62, 60}};
    const std::array<int, 8> bass{{48, 48, 55, 53, 48, 48, 55, 48}};
    constexpr uint32_t step = RATE / 3;
    for (uint32_t frame = 0; frame < FRAMES; ++frame) {
        const uint32_t index = frame / step, within = frame % step;
        if (index < melody.size()) {
            if (within == 0) {
                fm_note(fm.get(), melody[index]);
                psg_tone(psg.get(), 0, melody[index] + 12, 10);
                psg_tone(psg.get(), 1, bass[index], 10);
                psg_tone(psg.get(), 2, bass[index] + 7, 13);
                native_game_gear_write(psg.get(), 0xe4); // Short white-noise hat.
                native_game_gear_write(psg.get(), 0xfb);
            }
            if (within == RATE / 40) native_game_gear_write(psg.get(), 0xff);
            if (within == step * 4 / 5) {
                native_nuked_ym2612_write(fm.get(), 0, 0x28, 0);
                for (uint8_t channel = 0; channel < 3; ++channel)
                    native_game_gear_key_off(psg.get(), channel);
            }
        }
        float fl, fr, pl, pr;
        native_nuked_ym2612_sample(fm.get(), &fl, &fr);
        native_game_gear_sample(psg.get(), &pl, &pr);
        const double fade = std::min(1.0, std::min(frame / 240.0, (FRAMES - 1 - frame) / 12000.0));
        // Fixed example gains, not normalization: even full-scale FM plus all
        // four PSG sources (0.2 each) remains at or below 0.7 before this fade.
        sample(wav, fade * (0.5 * fl + 0.25 * pl));
        sample(wav, fade * (0.5 * fr + 0.25 * pr));
    }
    return wav;
}
}

int main(int argc, char **argv) {
    if (argc != 2) { std::cerr << "Usage: tetorica_nuked_genesis_wav <output.wav>\n"; return 2; }
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
