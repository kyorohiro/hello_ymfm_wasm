// Offline NES + FDS sound sketch using the actual standalone SDK renderer.
// Original notes, DMC bits and wave RAM; no device, ROM or sample assets.
#include <tetorica/nes.hpp>
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
constexpr uint32_t RATE = 48000, FRAMES = RATE * 3;
constexpr double CLOCK = 1789773.0;
using Core = std::unique_ptr<void, void (*)(void *)>;
void write(void *chip, uint16_t address, uint8_t value) { native_nes_write(chip, address, value); }

double hertz(int midi) { return 440.0 * std::pow(2.0, (midi - 69) / 12.0); }
void check_pitch(double actual, double wanted) {
    if (std::abs(actual / wanted - 1.0) > 0.01)
        throw std::runtime_error("Note exceeds the example's one-percent pitch tolerance");
}
void apu_note(void *chip, unsigned channel, int midi) {
    const double hz = hertz(midi), divider = channel == 2 ? 32.0 : 16.0;
    const long period = std::lround(CLOCK / (divider * hz)) - 1;
    if (channel > 2 || period < 8 || period > 2047)
        throw std::runtime_error("Note is outside the NES timer range");
    check_pitch(CLOCK / (divider * (period + 1)), hz);
    const uint16_t low = uint16_t(0x4002 + channel * 4);
    write(chip, low, uint8_t(period));
    write(chip, uint16_t(low + 1), uint8_t(0xf8 | (period >> 8)));
}
void fds_note(void *chip, int midi) {
    const double hz = hertz(midi);
    // With zero sweep gain, each 16 CPU ticks adds frequency*64 to the
    // 24-bit wave accumulator: one complete 64-sample wave is 2^22/frequency ticks.
    const long frequency = std::lround(hz * 4194304.0 / CLOCK);
    if (frequency < 1 || frequency > 4095)
        throw std::runtime_error("Note is outside the FDS frequency range");
    check_pitch(CLOCK * frequency / 4194304.0, hz);
    write(chip, 0x4080, 0xa0); // Fixed gain 32, envelope disabled.
    write(chip, 0x4082, uint8_t(frequency));
    write(chip, 0x4083, uint8_t(0x40 | (frequency >> 8))); // Oscillator on; envelope halted.
}

void configure(void *chip) {
    write(chip, 0x4017, 0x40); // Four-step APU sequencer; frame IRQ inhibited.
    write(chip, 0x4000, 0xb9); // Pulse 1: 50%, length halt, constant volume 9.
    write(chip, 0x4004, 0x76); // Pulse 2: 25%, length halt, constant volume 6.
    write(chip, 0x4001, 0x08); write(chip, 0x4005, 0x08); // Sweep disabled, negate mode.
    write(chip, 0x4008, 0xff); // Triangle: held length and linear reload 127.
    write(chip, 0x400c, 0x16); // Noise: constant volume 6, finite length.
    write(chip, 0x400e, 0x05); // Long LFSR, NTSC period 96 CPU ticks.

    // 65 original bytes: LSB-first rising/falling DAC steps, balanced per byte.
    // native_nes_load copies into owned 64 KiB RAM; this local array may expire.
    std::array<uint8_t, 65> dmc{};
    const std::array<uint8_t, 4> bits{{0x0f, 0x33, 0x55, 0x33}};
    for (unsigned i = 0; i < dmc.size(); ++i) dmc[i] = bits[i % bits.size()];
    if (!native_nes_load(chip, dmc.data(), 0xc000, uint32_t(dmc.size())))
        throw std::runtime_error("Could not copy the original DMC bits");
    write(chip, 0x4010, 0x4a); // Loop, no IRQ; NTSC DMC rate index 10.
    write(chip, 0x4012, 0x00); // DMC start = C000 + value*64.
    write(chip, 0x4013, 0x04); // DMC length = value*16 + 1 = 65 bytes.

    write(chip, 0x4023, 0x02); // Open the FDS register I/O gate.
    write(chip, 0x4083, 0x80); // Halt oscillator while authoring the wave.
    write(chip, 0x4084, 0x80); // Fixed sweep gain zero: unmodulated pitch.
    write(chip, 0x4087, 0x80); // Halt modulation; permits modulation table writes.
    write(chip, 0x4085, 0x00); // Zero signed modulation counter.
    for (unsigned i = 0; i < 32; ++i) write(chip, 0x4088, 0); // Original neutral table.
    write(chip, 0x4089, 0x80); // Open the 64-byte wave-write window.
    for (unsigned i = 0; i < 64; ++i)
        write(chip, uint16_t(0x4040 + i), uint8_t(i < 32 ? i * 2 : (63 - i) * 2));
    write(chip, 0x4089, 0x00); // Close wave writes; full master level.
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
    Core chip(native_nes_create(RATE, CLOCK, true), native_nes_destroy);
    if (!chip) throw std::runtime_error("Could not allocate the NES + FDS renderer");
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
            native_nes_stop(chip.get()); // I/O remains open, so FDS also stops.
            // First second: both pulses, triangle, noise and copied DMC bits.
            // Second: FDS wave alone. Last: all six sources together.
            if (phrase != 1) {
                write(chip.get(), 0x4011, 0x40); // Center the DMC DAC before restart.
                write(chip.get(), 0x4015, 0x1f); // Enable all five APU sources/refill DMC.
                apu_note(chip.get(), 0, melody[index % 4]);
                apu_note(chip.get(), 1, harmony[index % 4]);
                apu_note(chip.get(), 2, bass[index % 4]);
                write(chip.get(), 0x400f, 0x00); // Noise length 10 half-frame clocks.
            }
            if (phrase != 0) fds_note(chip.get(), melody[index % 4]);
        }
        float left, right;
        native_nes_sample(chip.get(), &left, &right);
        const double fade = std::min(1.0, std::min(within / 240.0, (step - 1 - within) / 1200.0));
        // The retained renderer is mono on both channels. Fixed example gain
        // reserves headroom; it does not replace the core's nonlinear mix/filters.
        sample(wav, 0.65 * fade * left); sample(wav, 0.65 * fade * right);
    }
    return wav;
}
}

int main(int argc, char **argv) {
    if (argc != 2) { std::cerr << "Usage: tetorica_nes_fds_wav <output.wav>\n"; return 2; }
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
