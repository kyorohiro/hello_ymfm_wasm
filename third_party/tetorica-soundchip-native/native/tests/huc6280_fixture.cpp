// SPDX-License-Identifier: BSD-3-Clause
// Imported fixture SHA-256: c38e44de6a05b6d4256b87f69000cf9931a7fb1955a91559745e0b2a8f0f2e67
// Offline PCM/state/allocation fixture; never opens an output device.
#include <tetorica/huc6280.hpp>
#include <cstddef>
#include <atomic>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <new>
#include <sstream>
#include <string>
#include <vector>

static bool audit = false;
static uint64_t allocations = 0, deallocations = 0;
void *operator new(std::size_t n) { if (audit) ++allocations; if (void *p = std::malloc(n)) return p; throw std::bad_alloc(); }
void *operator new[](std::size_t n) { return ::operator new(n); }
void operator delete(void *p) noexcept { if (audit && p) ++deallocations; std::free(p); }
void operator delete[](void *p) noexcept { ::operator delete(p); }
void operator delete(void *p, std::size_t) noexcept { ::operator delete(p); }
void operator delete[](void *p, std::size_t) noexcept { ::operator delete(p); }
struct Event { uint32_t frame, a = 0, b = 0; int channel = -1; std::string op; uint8_t wave[32] = {}; };
static void apply(void *ptr, const Event &e) {
    if (e.op == "write") native_huc6280_write(ptr, e.a, e.b, e.channel);
    else if (e.op == "waveform") native_huc6280_waveform(ptr, e.a, e.wave);
    else if (e.op == "off") native_huc6280_key_off(ptr, e.a);
    else if (e.op == "mute") native_huc6280_set_mute_mask(ptr, e.a);
    else if (e.op == "clock") assert(native_huc6280_set_clock(ptr, e.a));
    else if (e.op == "stop") native_huc6280_stop(ptr);
    else if (e.op == "reset") native_huc6280_reset(ptr);
    else std::abort();
}
static_assert(sizeof(NativeHuc6280State) == 352, "Reference C ABI size");
static_assert(offsetof(NativeHuc6280State, registers) == 11, "Reference register offset");
static_assert(offsetof(NativeHuc6280State, waveforms) == 75, "Reference waveform offset");
static_assert(offsetof(NativeHuc6280State, clock) == 348, "Reference clock offset");

static void program_voices(void *ptr, uint32_t omitted = 8) {
    native_huc6280_write(ptr, 1, 255, -1);
    for (uint32_t ch = 0; ch < 6; ++ch) {
        uint8_t wave[32];
        for (uint32_t i = 0; i < 32; ++i) wave[i] = (i * (ch + 1) + ch * 3) & 31;
        native_huc6280_waveform(ptr, ch, wave);
        native_huc6280_write(ptr, 2, 113 + ch * 29, ch);
        native_huc6280_write(ptr, 3, 1, ch);
        native_huc6280_write(ptr, 5, 0xff, ch);
        native_huc6280_write(ptr, 4, ch == omitted ? 31 : 159, ch);
    }
    native_huc6280_write(ptr, 0, 255, -1); // Raw selection is retained; active selection is masked.
}

static void sample_pair(void *ptr, void *reference, bool equal) {
    float l, r, rl, rr;
    native_huc6280_sample(ptr, &l, &r);
    native_huc6280_sample(reference, &rl, &rr);
    assert(std::isfinite(l) && std::isfinite(r) && std::isfinite(rl) && std::isfinite(rr));
    if (equal) assert(l == rl && r == rr);
}

static void extended_self_test() {
    assert(!native_huc6280_create(0) && !native_huc6280_create(7999));
    for (uint32_t rate : {8000u, 44100u, 48000u, 96000u, 384000u}) {
        void *ptr = native_huc6280_create(rate), *reference = native_huc6280_create(rate);
        assert(ptr && reference);
        audit = true;
        for (uint32_t clock : {100000u, 3579545u, 7159090u, 100000000u}) {
            for (uint32_t stopped = 0; stopped < 6; ++stopped) {
                native_huc6280_reset(ptr);
                native_huc6280_reset(reference);
                assert(native_huc6280_set_clock(ptr, clock));
                assert(native_huc6280_set_clock(reference, clock));
                program_voices(ptr);
                program_voices(reference, stopped);
                NativeHuc6280State before{}, after{};
                native_huc6280_get_state(ptr, &before);
                assert(before.selected == 7 && before.globals[0] == 255 && before.clock == clock);
                // Rejected writes, wave uploads, key-offs and clocks leave both
                // the observation and subsequent PCM sequence intact.
                native_huc6280_write(ptr, 10, 0xff, 0);
                native_huc6280_write(ptr, UINT32_MAX, 0xff, 0);
                native_huc6280_waveform(ptr, 6, before.waveforms[0]);
                native_huc6280_waveform(ptr, UINT32_MAX, before.waveforms[0]);
                native_huc6280_waveform(ptr, 0, nullptr);
                native_huc6280_key_off(ptr, 8);
                native_huc6280_key_off(ptr, UINT32_MAX);
                assert(!native_huc6280_set_clock(ptr, 99999));
                assert(!native_huc6280_set_clock(ptr, 100000001));
                native_huc6280_get_state(ptr, &after);
                assert(!std::memcmp(&before, &after, sizeof before));
                for (uint32_t i = 0; i < 73; ++i) sample_pair(ptr, reference, false);
                native_huc6280_get_state(ptr, &before);
                native_huc6280_key_off(ptr, stopped);
                native_huc6280_get_state(ptr, &after);
                before.registers[stopped][4] &= 127;
                assert(!std::memcmp(&before, &after, sizeof before));
                const uint32_t held = uint32_t(std::ceil(3579545.0 / clock));
                for (uint32_t i = 0; i < held + 128; ++i) {
                    native_huc6280_get_state(ptr, &before);
                    native_huc6280_get_state(ptr, &after);
                    assert(!std::memcmp(&before, &after, sizeof before));
                    sample_pair(ptr, reference, i >= held);
                }
                native_huc6280_get_state(ptr, &before);
                native_huc6280_stop(ptr);
                native_huc6280_get_state(ptr, &after);
                for (uint32_t ch = 0; ch < 8; ++ch) before.registers[ch][4] &= 127;
                assert(!std::memcmp(&before, &after, sizeof before));
                float l, r;
                for (uint32_t i = 0; i < held + 2; ++i) {
                    native_huc6280_sample(ptr, &l, &r);
                    assert(std::isfinite(l) && std::isfinite(r));
                    if (i >= held) assert(l == 0 && r == 0);
                }
            }
        }
        audit = false;
        assert(!allocations && !deallocations);
        native_huc6280_destroy(ptr);
        native_huc6280_destroy(reference);
    }

    void *ptr = native_huc6280_create(48000), *reference = native_huc6280_create(48000);
    assert(ptr && reference);
    audit = true;
    // Wave uploads copy and mask the complete 32-byte input, restore DDA and
    // control, and preserve the selected channel and shared LFO registers.
    uint8_t wave[32];
    native_huc6280_write(ptr, 0, 254, -1);
    native_huc6280_write(ptr, 8, 11, -1);
    native_huc6280_write(ptr, 9, 3, -1);
    for (uint32_t ch = 0; ch < 6; ++ch) {
        for (uint32_t i = 0; i < 32; ++i) wave[i] = uint8_t(32 + i + ch);
        native_huc6280_write(ptr, 4, 0xdf, ch);
        native_huc6280_write(ptr, 6, 63 - ch, ch);
        native_huc6280_waveform(ptr, ch, wave);
        std::memset(wave, 0, sizeof wave);
        NativeHuc6280State state{};
        native_huc6280_get_state(ptr, &state);
        assert(state.selected == 6 && state.globals[0] == 254);
        assert(state.globals[8] == 11 && state.globals[9] == 3);
        assert(state.registers[ch][4] == 0xdf && state.dda[ch] == (31 - ch));
        assert(state.indices[ch] == 0);
        for (uint32_t i = 0; i < 32; ++i) assert(state.waveforms[ch][i] == ((i + ch) & 31));
    }
    // An out-of-range explicit channel follows the selected-channel contract.
    native_huc6280_write(ptr, 2, 45, 8);
    native_huc6280_write(ptr, 3, 3, -2);
    NativeHuc6280State state{};
    native_huc6280_get_state(ptr, &state);
    assert(state.registers[6][2] == 45 && state.registers[6][3] == 3 && state.selected == 6);

    // Each of the six voices contributes independently to the stereo mix.
    for (uint32_t omitted = 0; omitted < 6; ++omitted) {
        native_huc6280_reset(ptr);
        native_huc6280_reset(reference);
        program_voices(ptr);
        program_voices(reference, omitted);
        bool differs = false;
        for (uint32_t i = 0; i < 1024; ++i) {
            float l, r, rl, rr;
            native_huc6280_sample(ptr, &l, &r);
            native_huc6280_sample(reference, &rl, &rr);
            differs |= l != rl || r != rr;
        }
        assert(differs);
    }
    // DDA supplies a constant source so both global and per-voice stereo
    // balance can be checked without relying on an oscillator's current sign.
    native_huc6280_reset(ptr);
    native_huc6280_write(ptr, 1, 255, -1);
    native_huc6280_write(ptr, 5, 255, 3);
    native_huc6280_write(ptr, 4, 223, 3);
    native_huc6280_write(ptr, 6, 29, 3);
    for (uint32_t balance : {0xf0u, 0x0fu, 0xffu}) {
        float l, r;
        native_huc6280_write(ptr, 1, balance, -1);
        native_huc6280_sample(ptr, &l, &r);
        assert((balance == 15 ? l == 0 : l > 0) && (balance == 240 ? r == 0 : r > 0));
        native_huc6280_write(ptr, 1, 255, -1);
        native_huc6280_write(ptr, 5, balance, 3);
        native_huc6280_sample(ptr, &l, &r);
        assert((balance == 15 ? l == 0 : l > 0) && (balance == 240 ? r == 0 : r > 0));
        native_huc6280_write(ptr, 5, 255, 3);
    }
    // Every supported LFO depth changes channel 0's period; both noise voices
    // differ from their wavetable modes. Muting in the imported test below
    // additionally checks that these sources continue to advance silently.
    for (uint32_t mode = 1; mode <= 5; ++mode) {
        native_huc6280_reset(ptr);
        native_huc6280_reset(reference);
        program_voices(ptr);
        program_voices(reference);
        if (mode <= 3) {
            native_huc6280_write(ptr, 8, 7, -1);
            native_huc6280_write(ptr, 9, mode, -1);
        } else native_huc6280_write(ptr, 7, 0x87, mode);
        bool differs = false;
        for (uint32_t i = 0; i < 2048; ++i) {
            float l, r, rl, rr;
            native_huc6280_sample(ptr, &l, &r);
            native_huc6280_sample(reference, &rl, &rr);
            assert(std::isfinite(l) && std::isfinite(r));
            differs |= l != rl || r != rr;
        }
        assert(differs);
    }
    // Invalid clock changes cannot alter the resampler or its held output.
    for (void *chip : {ptr, reference}) {
        native_huc6280_reset(chip);
        assert(native_huc6280_set_clock(chip, 100000));
        program_voices(chip);
    }
    for (uint32_t i = 0; i < 137; ++i) sample_pair(ptr, reference, true);
    native_huc6280_get_state(ptr, &state);
    assert(!native_huc6280_set_clock(ptr, 0) && !native_huc6280_set_clock(ptr, UINT32_MAX));
    NativeHuc6280State after{};
    native_huc6280_get_state(ptr, &after);
    assert(!std::memcmp(&state, &after, sizeof state));
    for (uint32_t i = 0; i < 1024; ++i) sample_pair(ptr, reference, true);

    // Stop and individual key-off gate DDA without clearing its authored value
    // or the outer resampler's held sample. Reset clears that sample at once,
    // retains the chosen clock and source mute, and clears all authored state.
    for (bool global : {false, true}) {
        native_huc6280_reset(ptr);
        native_huc6280_write(ptr, 1, 255, -1);
        native_huc6280_write(ptr, 5, 255, 2);
        native_huc6280_write(ptr, 4, 223, 2);
        native_huc6280_write(ptr, 6, 29, 2);
        float l = 0, r = 0;
        for (uint32_t i = 0; i < 36; ++i) native_huc6280_sample(ptr, &l, &r);
        assert(l > 0 && r > 0);
        const float heldLeft = l, heldRight = r;
        if (global) native_huc6280_stop(ptr); else native_huc6280_key_off(ptr, 2);
        native_huc6280_sample(ptr, &l, &r);
        assert(l == heldLeft && r == heldRight);
        for (uint32_t i = 0; i < 36; ++i) native_huc6280_sample(ptr, &l, &r);
        assert(l == 0 && r == 0);
        native_huc6280_get_state(ptr, &state);
        assert(state.registers[2][4] == 95 && state.dda[2] == 29 && state.clock == 100000);
        native_huc6280_set_mute_mask(ptr, 0xffffffc4);
        native_huc6280_reset(ptr);
        native_huc6280_get_state(ptr, &state);
        assert(state.clock == 100000 && state.selected == 0);
        NativeHuc6280State cleared{};
        cleared.clock = 100000;
        assert(!std::memcmp(&state, &cleared, sizeof state));
        native_huc6280_sample(ptr, &l, &r);
        assert(l == 0 && r == 0);
        native_huc6280_write(ptr, 1, 255, -1);
        native_huc6280_write(ptr, 5, 255, 2);
        native_huc6280_write(ptr, 4, 223, 2);
        native_huc6280_write(ptr, 6, 29, 2);
        for (uint32_t i = 0; i < 72; ++i) native_huc6280_sample(ptr, &l, &r);
        assert(l == 0 && r == 0);
        native_huc6280_set_mute_mask(ptr, 0xffffffc0); // Bits above voice 5 are ignored.
        for (uint32_t i = 0; i < 36; ++i) native_huc6280_sample(ptr, &l, &r);
        assert(l > 0 && r > 0);
    }
    audit = false;
    assert(!allocations && !deallocations);
    native_huc6280_destroy(ptr);
    native_huc6280_destroy(reference);
}
static int self_test() {
    extended_self_test();
    void *ptr = native_huc6280_create(48000);
    void *sibling = native_huc6280_create(48000);
    void *reference = native_huc6280_create(48000);
    assert(ptr && sibling && reference);
    assert(!native_huc6280_create(1) && !native_huc6280_create(384001));
    uint8_t wave[32]; for (int i = 0; i < 32; ++i) wave[i] = i;
    audit = true;
    native_huc6280_write(ptr, 0, 7, -1);
    native_huc6280_write(ptr, 1, 255, -1);
    native_huc6280_write(ptr, 4, 27, 2);
    native_huc6280_waveform(ptr, 2, wave);
    native_huc6280_write(ptr, 2, 177, 2);
    native_huc6280_write(ptr, 5, 0xf9, 2);
    native_huc6280_write(ptr, 4, 155, 2);
    assert(native_huc6280_set_clock(ptr, 7159090));
    float l, r; for (int i = 0; i < 2048; ++i) native_huc6280_sample(ptr, &l, &r);
    NativeHuc6280State state;
    native_huc6280_get_state(ptr, &state);
    assert(state.selected == 7 && state.globals[0] == 7);
    assert(state.registers[2][4] == 155 && state.registers[2][2] == 177);
    assert(std::memcmp(state.waveforms[2], wave, 32) == 0);
    native_huc6280_stop(ptr);
    native_huc6280_get_state(ptr, &state);
    assert(state.registers[2][4] == 27 && state.clock == 7159090 && state.selected == 7);
    assert(std::memcmp(state.waveforms[2], wave, 32) == 0);
    native_huc6280_write(ptr, 4, 0xdf, 3); native_huc6280_write(ptr, 6, 29, 3);
    native_huc6280_get_state(ptr, &state); assert(state.dda[3] == 29);
    native_huc6280_key_off(ptr, 3); native_huc6280_get_state(ptr, &state);
    assert(state.registers[3][4] == 0x5f && state.dda[3] == 29);
    native_huc6280_reset(ptr); native_huc6280_get_state(ptr, &state);
    assert(state.clock == 7159090 && state.selected == 0 && state.globals[1] == 0);
    for (auto &waveform : state.waveforms) for (auto value : waveform) assert(value == 0);
    assert(!native_huc6280_set_clock(ptr, 1));
    assert(!native_huc6280_set_clock(ptr, 100000001));
    // Read-only status and a muted source must leave every oscillator, shared
    // LFO and LFSR progressing identically to an unobserved reference.
    assert(native_huc6280_set_clock(ptr, 3579545));
    assert(native_huc6280_set_clock(reference, 3579545));
    for (void *chip : {ptr, reference}) {
        native_huc6280_write(chip, 1, 255, -1);
        for (uint32_t ch = 0; ch < 6; ++ch) {
            native_huc6280_waveform(chip, ch, wave);
            native_huc6280_write(chip, 2, 177 + ch * 19, ch);
            native_huc6280_write(chip, 3, 1, ch);
            native_huc6280_write(chip, 5, 255, ch);
            native_huc6280_write(chip, 4, 159, ch);
        }
        native_huc6280_write(chip, 7, 0x87, 4);
        native_huc6280_write(chip, 8, 7, -1);
        native_huc6280_write(chip, 9, 3, -1);
        native_huc6280_write(chip, 0, 7, -1);
    }
    native_huc6280_set_mute_mask(ptr, 63);
    for (int i = 0; i < 2048; ++i) {
        float rl, rr;
        native_huc6280_get_state(ptr, &state);
        native_huc6280_sample(ptr, &l, &r);
        native_huc6280_sample(reference, &rl, &rr);
        assert(l == 0 && r == 0);
    }
    native_huc6280_set_mute_mask(ptr, 0);
    for (int i = 0; i < 2048; ++i) {
        float rl, rr;
        native_huc6280_get_state(ptr, &state);
        native_huc6280_sample(ptr, &l, &r);
        native_huc6280_sample(reference, &rl, &rr);
        assert(l == rl && r == rr && std::isfinite(l) && std::isfinite(r));
    }
    native_huc6280_key_off(ptr, 0);
    native_huc6280_get_state(ptr, &state);
    assert(state.selected == 7 && state.registers[0][4] == 31);
    for (int ch = 1; ch < 6; ++ch) assert(state.registers[ch][4] == 159);
    assert(state.globals[8] == 7 && state.globals[9] == 3);
    NativeHuc6280State sibling_state;
    native_huc6280_get_state(sibling, &sibling_state);
    assert(sibling_state.clock == 3579545 && sibling_state.globals[1] == 0);
    for (const auto &values : sibling_state.waveforms) for (auto value : values) assert(value == 0);
    // Clearing key-on silences DDA without destroying the last authored DAC,
    // waveform, raw selection or shared LFO configuration.
    native_huc6280_write(sibling, 1, 255, -1);
    native_huc6280_write(sibling, 5, 255, 3);
    native_huc6280_write(sibling, 4, 223, 3);
    native_huc6280_write(sibling, 6, 29, 3);
    native_huc6280_sample(sibling, &l, &r); assert(l != 0 && r != 0);
    native_huc6280_key_off(sibling, 3);
    native_huc6280_sample(sibling, &l, &r); assert(l == 0 && r == 0);
    native_huc6280_get_state(sibling, &sibling_state);
    assert(sibling_state.registers[3][4] == 95 && sibling_state.dda[3] == 29);
    audit = false;
    assert(allocations == 0 && deallocations == 0);
    native_huc6280_destroy(ptr);
    native_huc6280_destroy(sibling);
    native_huc6280_destroy(reference);
    std::printf("{\"stateBytes\":%zu,\"coreHeapBytes\":%zu,\"independentInstances\":true,\"observationPreservesPhase\":true,\"mutePreservesLfoAndNoisePhase\":true,\"targetedDdaStop\":true,\"renderAllocations\":0,\"renderFrees\":0}\n", sizeof(NativeHuc6280State), native_huc6280_core_size());
    return 0;
}
int main(int argc, char **argv) {
    if (argc == 2 && std::string(argv[1]) == "--self-test") return self_test();
    if (argc != 3) return 2;
    const uint32_t rate = std::stoul(argv[1]), frames = std::stoul(argv[2]);
    std::vector<Event> events;
    std::string line;
    while (std::getline(std::cin, line)) {
        std::istringstream in(line); Event e; if (!(in >> e.frame >> e.op)) continue;
        if (e.op == "write") in >> e.a >> e.b >> e.channel;
        else if (e.op == "waveform") { std::string hex; in >> e.a >> hex; assert(hex.size() == 64); for (int i = 0; i < 32; ++i) e.wave[i] = std::stoul(hex.substr(i * 2, 2), nullptr, 16); }
        else if (e.op == "off" || e.op == "clock" || e.op == "mute") in >> e.a;
        events.push_back(e);
    }
    void *ptr = native_huc6280_create(rate); if (!ptr) return 3;
    std::vector<float> output(frames * 2);
    size_t next = 0;
    audit = true;
    for (uint32_t frame = 0; frame < frames; ++frame) {
        while (next < events.size() && events[next].frame == frame) apply(ptr, events[next++]);
        native_huc6280_sample(ptr, &output[frame * 2], &output[frame * 2 + 1]);
    }
    audit = false;
    assert(allocations == 0 && deallocations == 0);
    native_huc6280_destroy(ptr);
    return std::fwrite(output.data(), sizeof(float), output.size(), stdout) == output.size() ? 0 : 4;
}
