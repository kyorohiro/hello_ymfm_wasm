// Offline six-operator DX7 sketch using the actual standalone Native renderer.
// Original unpacked voices and MIDI notes; no SysEx, presets, ROM or device.
#include <tetorica/dx7.hpp>
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
using Voice = std::array<uint8_t, 155>;
using Core = std::unique_ptr<void, void (*)(void *)>;

// The 155-byte single-voice payload stores OP6 first and OP1 last. Each
// operator has 21 unpacked parameters; the final 29 bytes are global/name data.
constexpr unsigned offset(unsigned operator_number) { return (6 - operator_number) * 21; }
Voice voice(uint8_t algorithm, const std::array<uint8_t, 6> &levels,
            const std::array<uint8_t, 6> &ratios, const char (&name)[11]) {
    Voice result{};
    for (unsigned op = 1; op <= 6; ++op) {
        const unsigned off = offset(op);
        const std::array<uint8_t, 21> parameters{{
            96, 50, 30, 65, // EG rates 1..4; release uses rate 4.
            99, 95, 85, 0,  // EG levels 1..4; release ends at zero.
            39, 0, 0, 0, 0, // Key breakpoint/depths/curves; no level scaling.
            0, 0, 2,        // Rate scaling, AM sensitivity, velocity sensitivity.
            levels[op - 1], 0, ratios[op - 1], 0, 7 // Output, ratio mode/coarse/fine/detune.
        }};
        std::copy(parameters.begin(), parameters.end(), result.begin() + off);
    }
    std::fill(result.begin() + 126, result.begin() + 130, 99); // Pitch EG rates.
    std::fill(result.begin() + 130, result.begin() + 134, 50); // Neutral pitch EG.
    result[134] = algorithm; // Zero-based algorithm: 0..31 means DX7 1..32.
    result[135] = 1;         // Gentle OP6 feedback.
    result[137] = 35;        // Shared LFO speed; pitch/amplitude depths stay zero.
    result[142] = 4;         // Sine LFO.
    result[144] = 24;        // Conventional neutral transpose; core does not apply it.
    std::copy(name, name + 10, result.begin() + 145);
    return result;
}

int note(void *chip, uint8_t midi, uint8_t velocity) {
    // Native Note On returns the allocated slot, not the MIDI note number.
    const int slot = native_dx7_note_on(chip, midi, velocity);
    if (slot < 0) throw std::runtime_error("No unheld DX7 slot is available");
    return slot;
}
void release(void *chip, int slot) {
    if (slot >= 0) native_dx7_release_slot(chip, uint8_t(slot));
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
    // Select copies each complete payload synchronously; these original voices
    // are not a SysEx bank. All six operators have nonzero levels in each voice.
    auto cascade = voice(0, {{98, 75, 96, 65, 68, 71}}, {{1, 2, 1, 2, 3, 4}}, "SDKCASCADE");
    const auto pairs = voice(4, {{96, 82, 94, 76, 91, 80}}, {{1, 2, 1, 3, 2, 4}}, "SDK3PAIRS ");
    const auto chord = voice(31, {{90, 86, 83, 79, 75, 72}}, {{1, 2, 3, 4, 5, 6}}, "SDK6SINES ");
    Core chip(native_dx7_create(RATE), native_dx7_destroy);
    if (!chip) throw std::runtime_error("Could not allocate the DX7 renderer");
    std::vector<uint8_t> wav;
    const uint32_t data_bytes = FRAMES * 4;
    wav.reserve(44 + data_bytes);
    tag(wav, "RIFF"); u32(wav, 36 + data_bytes); tag(wav, "WAVE");
    tag(wav, "fmt "); u32(wav, 16); u16(wav, 1); u16(wav, 2);
    u32(wav, RATE); u32(wav, RATE * 4); u16(wav, 4); u16(wav, 16);
    tag(wav, "data"); u32(wav, data_bytes);

    int melody = -1;
    std::array<int, 3> chord_slots{{-1, -1, -1}};
    for (uint32_t frame = 0; frame < FRAMES; ++frame) {
        if (frame == 0) {
            native_dx7_voice(chip.get(), cascade.data(), 1, false);
            melody = note(chip.get(), 60, 104); // C4, algorithm 1's four-plus-two chains.
        }
        if (frame == RATE / 3) {
            // A matching identity edits current sounding/releasing notes in
            // place. Operator levels change without restarting their envelopes.
            cascade[offset(4) + 16] = 82;
            cascade[offset(6) + 16] = 86;
            native_dx7_voice(chip.get(), cascade.data(), 1, true);
        }
        if (frame == RATE * 3 / 5) release(chip.get(), melody);
        if (frame == RATE) {
            native_dx7_voice(chip.get(), pairs.data(), 2, false);
            melody = note(chip.get(), 67, 100); // G4, algorithm 5's three FM pairs.
        }
        if (frame == RATE * 7 / 5) {
            release(chip.get(), melody);
            melody = note(chip.get(), 72, 96); // C5; previous slot keeps its tail.
        }
        if (frame == RATE * 17 / 10) release(chip.get(), melody);
        if (frame == RATE * 2) {
            native_dx7_voice(chip.get(), chord.data(), 3, false);
            chord_slots = {{note(chip.get(), 60, 92), note(chip.get(), 64, 88), note(chip.get(), 67, 90)}};
        }
        if (frame == RATE * 5 / 2)
            for (const int slot : chord_slots) release(chip.get(), slot);
        // The core runs at 44.1 kHz; this 48 kHz output uses its retained linear
        // interpolation. Fixed gain and 5 ms/40 ms edge fades reserve headroom.
        const double fade = std::min(1.0, std::min(frame / 240.0, (FRAMES - 1 - frame) / 1920.0));
        const double mono = 0.65 * fade * native_dx7_sample(chip.get());
        sample(wav, mono); sample(wav, mono);
    }
    return wav;
}
}

int main(int argc, char **argv) {
    if (argc != 2) { std::cerr << "Usage: tetorica_dx7_wav <output.wav>\n"; return 2; }
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
