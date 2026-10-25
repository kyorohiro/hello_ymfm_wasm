// Offline stereo/state/allocation fixture. Never opens a playback device.
#include <tetorica/segapsg.hpp>
#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <new>
#include <sstream>
#include <string>
#include <vector>
static bool audit = false;
static uint64_t allocations = 0, frees = 0;
void *operator new(std::size_t n) { if (audit) ++allocations; if (void *p = std::malloc(n)) return p; throw std::bad_alloc(); }
void *operator new[](std::size_t n) { return ::operator new(n); }
void operator delete(void *p) noexcept { if (audit && p) ++frees; std::free(p); }
void operator delete[](void *p) noexcept { ::operator delete(p); }
void operator delete(void *p, std::size_t) noexcept { ::operator delete(p); }
void operator delete[](void *p, std::size_t) noexcept { ::operator delete(p); }
static double render(void *chip, uint32_t frames, int side = -1) {
    double energy = 0; float l, r;
    for (uint32_t i = 0; i < frames; ++i) {
        native_game_gear_sample(chip, &l, &r); assert(std::isfinite(l) && std::isfinite(r));
        if (side == 0) assert(r == 0); if (side == 1) assert(l == 0); if (side == 2) assert(l == r);
        energy += std::abs(l) + std::abs(r);
    }
    return energy;
}
static void tone(void *chip, uint8_t channel, uint16_t period, uint8_t level) {
    native_game_gear_write(chip, 0x80 | (channel << 5) | (period & 15));
    native_game_gear_write(chip, period >> 4); native_game_gear_write(chip, 0x90 | (channel << 5) | level);
}
static void independent_instances() {
    // A dynamic rack prepares each handle on the control thread. Rendering and
    // edits of one handle must not change another handle's phase or latch.
    void *a = native_game_gear_create(48000), *b = native_game_gear_create(48000);
    void *reference = native_game_gear_create(48000); assert(a && b && reference);
    audit = true;
    for (void *h : {b, reference}) {
        tone(h, 1, 173, 4); tone(h, 2, 251, 15);
        native_game_gear_write(h, 0xe7); native_game_gear_write(h, 0xf6);
        assert(native_game_gear_set_clock(h, 4000000)); native_game_gear_set_stereo(h, 0x0a);
    }
    tone(a, 0, 277, 3); native_game_gear_set_stereo(a, 0xf0);
    assert(native_game_gear_set_clock(a, 2000000));
    double energy = 0;
    for (int i = 0; i < 2048; ++i) {
        if (i % 31 == 0) {
            tone(a, 0, 127 + i % 511, i % 15);
            native_game_gear_set_mute_mask(a, i % 16);
            native_game_gear_set_stereo(a, uint8_t(i));
            assert(native_game_gear_set_clock(a, 100000 + uint32_t(i) * 30000));
        }
        if (i == 701) native_game_gear_reset(a);
        if (i == 997) native_game_gear_stop(a);
        if (i == 1201) {
            // Still a noise-volume continuation on B, regardless of A's latch.
            native_game_gear_write(b, 3); native_game_gear_write(reference, 3);
        }
        if (i == 1337) {
            native_game_gear_set_mute_mask(b, 8); native_game_gear_set_mute_mask(reference, 8);
        }
        float al, ar, bl, br, rl, rr;
        native_game_gear_sample(a, &al, &ar); native_game_gear_sample(b, &bl, &br);
        native_game_gear_sample(reference, &rl, &rr);
        assert(std::isfinite(al) && std::isfinite(ar)); assert(bl == 0 && bl == rl && br == rr);
        energy += std::abs(br);
    }
    NativeGameGearState state{}; native_game_gear_get_state(b, &state);
    assert(state.periods[1] == 173 && state.periods[2] == 251 && state.attenuation[3] == 3);
    assert(state.clock == 4000000 && state.stereo == 0x0a && state.mute_mask == 8 && state.latch == 7);
    assert(energy > 1);
    audit = false; assert(allocations == 0 && frees == 0);
    native_game_gear_destroy(a); // Reclamation is explicitly outside rendering.
    audit = true;
    for (int i = 0; i < 1000; ++i) {
        float bl, br, rl, rr; native_game_gear_sample(b, &bl, &br); native_game_gear_sample(reference, &rl, &rr);
        assert(bl == rl && br == rr);
    }
    audit = false; assert(allocations == 0 && frees == 0);
    native_game_gear_destroy(b); native_game_gear_destroy(reference);
}
static void noise_modes_latch_and_mute_phase() {
    for (uint8_t mode = 0; mode < 8; ++mode) {
        void *chip = native_game_gear_create(48000), *reference = native_game_gear_create(48000);
        assert(chip && reference);
        audit = true;
        for (void *h : {chip, reference}) {
            tone(h, 0, 0x2a5, 15); tone(h, 1, 0x15b, 15); tone(h, 2, 173, 15);
            // Tone-period, attenuation and noise continuation bytes all use
            // the selected latch; no control observation may change that latch.
            native_game_gear_write(h, 0x85); native_game_gear_write(h, 0x2a);
            native_game_gear_write(h, 0x96); native_game_gear_write(h, 4);
            native_game_gear_key_off(h, 0);
            native_game_gear_write(h, 0xe0 | mode); native_game_gear_write(h, mode);
            native_game_gear_write(h, 0xf4); native_game_gear_write(h, 5);
        }
        NativeGameGearState state{}; native_game_gear_get_state(chip, &state);
        assert(state.periods[0] == 0x2a5 && state.periods[1] == 0x15b && state.periods[2] == 173);
        assert(state.latch == 7 && state.noise_mode == mode && state.levels[0] == 4);
        assert(state.attenuation[0] == 15 && state.attenuation[3] == 5 && state.levels[3] == 5);
        native_game_gear_set_mute_mask(chip, 8);
        double reference_energy = 0;
        for (uint32_t frame = 0; frame < 4096; ++frame) {
            if (frame == 701 || frame == 2801) native_game_gear_set_mute_mask(chip, 0);
            if (frame == 1703) native_game_gear_set_mute_mask(chip, 8);
            if (frame % 17 == 0) {
                native_game_gear_get_state(chip, &state);
                assert(state.latch == 7 && state.noise_mode == mode && state.levels[3] == 5);
            }
            float l, r, expected_l, expected_r;
            native_game_gear_sample(chip, &l, &r); native_game_gear_sample(reference, &expected_l, &expected_r);
            assert(std::isfinite(l) && std::isfinite(r));
            if (frame < 701 || (frame >= 1703 && frame < 2801)) assert(l == 0 && r == 0);
            else assert(l == expected_l && r == expected_r);
            reference_energy += std::abs(expected_l) + std::abs(expected_r);
        }
        assert(reference_energy > 1);
        audit = false; assert(allocations == 0 && frees == 0);
        native_game_gear_destroy(chip); native_game_gear_destroy(reference);
    }
}
static int self_test() {
    static_assert(sizeof(NativeGameGearState) == 28, "Rust FFI layout");
    independent_instances();
    noise_modes_latch_and_mute_phase();
    assert(!native_game_gear_create(0) && !native_game_gear_create(384001));
    void *chip = native_game_gear_create(48000), *reference = native_game_gear_create(48000); assert(chip && reference);
    NativeGameGearState s{}; audit = true;
    native_game_gear_get_state(chip, &s); assert(s.clock == 3579545 && s.stereo == 255 && s.latch == 0 && s.noise_mode == 0);
    assert(render(chip, 200, 2) == 0);
    for (uint8_t ch = 0; ch < 3; ++ch) tone(chip, ch, 127 + ch * 31, 3 + ch);
    native_game_gear_write(chip, 0xe7); native_game_gear_write(chip, 0xf6);
    assert(render(chip, 1000, 2) > 1);
    native_game_gear_set_stereo(chip, 0xf0); assert(render(chip, 400, 0) > .1);
    native_game_gear_set_stereo(chip, 0x0f); assert(render(chip, 400, 1) > .1);
    native_game_gear_set_stereo(chip, 0); assert(render(chip, 400, 2) == 0);
    native_game_gear_set_stereo(chip, 0x96); assert(render(chip, 1000) > .1);
    assert(native_game_gear_set_clock(chip, 100000000)); assert(native_game_gear_set_clock(chip, 100000)); assert(!native_game_gear_set_clock(chip, 99999)); assert(!native_game_gear_set_clock(chip, 100000001));
    native_game_gear_stop(chip); native_game_gear_get_state(chip, &s);
    assert(s.clock == 100000 && s.stereo == 0x96 && s.noise_mode == 7 && s.latch == 7);
    for (uint8_t ch = 0; ch < 3; ++ch) assert(s.periods[ch] == 127 + ch * 31 && s.levels[ch] == 3 + ch && s.attenuation[ch] == 15);
    assert(s.levels[3] == 6 && s.attenuation[3] == 15 && render(chip, 1000) == 0);
    native_game_gear_audition_key_on(chip, 0); native_game_gear_audition_key_on(chip, 3); assert(render(chip, 2000) > .1);
    native_game_gear_key_off(chip, 0); native_game_gear_key_off(chip, 3); render(chip, 100); assert(render(chip, 1000) == 0);
    native_game_gear_set_mute_mask(chip, 15); native_game_gear_audition_key_on(chip, 0); assert(render(chip, 1000) == 0);
    native_game_gear_set_mute_mask(chip, 0); assert(render(chip, 1000) > .1);
    native_game_gear_set_mute_mask(chip, 9); native_game_gear_reset(chip); native_game_gear_get_state(chip, &s);
    assert(s.clock == 100000 && s.mute_mask == 9 && s.stereo == 255 && s.noise_mode == 0 && s.latch == 0);
    for (uint8_t ch = 0; ch < 4; ++ch) assert(s.levels[ch] == 0 && s.attenuation[ch] == 15);
    for (uint8_t ch = 0; ch < 3; ++ch) assert(s.periods[ch] == 0);
    assert(render(chip, 200) == 0);
    native_game_gear_set_mute_mask(chip, 0); native_game_gear_set_clock(chip, 4000000); native_game_gear_reset(chip);
    native_game_gear_set_clock(reference, 4000000);
    for (void *h : {chip, reference}) {
        tone(h, 0, 1, 4); tone(h, 1, 0, 6); tone(h, 2, 251, 8);
        native_game_gear_write(h, 0xe7); native_game_gear_write(h, 0xf5); native_game_gear_set_stereo(h, 0xa5);
    }
    // Repeated observational snapshots cannot advance oscillators or LFSR.
    for (int i = 0; i < 100; ++i) native_game_gear_get_state(chip, &s);
    for (int i = 0; i < 1000; ++i) { float l, r, a, b; native_game_gear_sample(chip, &l, &r); native_game_gear_sample(reference, &a, &b); assert(l == a && r == b); }
    audit = false; assert(allocations == 0 && frees == 0); native_game_gear_destroy(chip); native_game_gear_destroy(reference);
    std::puts("Standalone PSG only; independent instances and control-thread retirement, all8noise modes/data latches/mute phase, all stereo routes, retained clock/levels/periods/noise/Stop, reset mask, source mute, observational snapshots passed; callback allocations 0, frees 0"); return 0;
}
struct Event { uint32_t frame = 0, a = 0; std::string op; };
int main(int argc, char **argv) {
    try {
        if (argc == 2 && std::string(argv[1]) == "--self-test") return self_test();
        if (argc != 3) return 2;
        const uint32_t rate = std::stoul(argv[1]), frames = std::stoul(argv[2]); if (frames > 10000000) return 2;
        std::vector<Event> events; std::string line;
        while (std::getline(std::cin, line)) {
            std::istringstream in(line); Event e; if (!(in >> e.frame >> e.op)) continue;
            if (e.op == "write" || e.op == "stereo" || e.op == "clock" || e.op == "mute" || e.op == "off" || e.op == "audition") in >> e.a;
            else if (e.op != "reset" && e.op != "stop") return 2;
            events.push_back(std::move(e));
        }
        std::stable_sort(events.begin(), events.end(), [](const Event &a, const Event &b) { return a.frame < b.frame; });
        void *chip = native_game_gear_create(rate); if (!chip) return 3;
        std::vector<float> pcm(frames * 2); size_t next = 0; audit = true;
        for (uint32_t frame = 0; frame < frames; ++frame) {
            while (next < events.size() && events[next].frame == frame) {
                const auto &e = events[next++];
                if (e.op == "write") native_game_gear_write(chip, e.a);
                else if (e.op == "stereo") native_game_gear_set_stereo(chip, e.a);
                else if (e.op == "clock") assert(native_game_gear_set_clock(chip, e.a));
                else if (e.op == "mute") native_game_gear_set_mute_mask(chip, e.a);
                else if (e.op == "off") native_game_gear_key_off(chip, e.a);
                else if (e.op == "audition") native_game_gear_audition_key_on(chip, e.a);
                else if (e.op == "reset") native_game_gear_reset(chip);
                else if (e.op == "stop") native_game_gear_stop(chip);
            }
            native_game_gear_sample(chip, &pcm[frame * 2], &pcm[frame * 2 + 1]);
        }
        audit = false; assert(allocations == 0 && frees == 0); native_game_gear_destroy(chip);
        return std::fwrite(pcm.data(), sizeof(float), pcm.size(), stdout) == pcm.size() ? 0 : 4;
    } catch (const std::exception &e) { std::cerr << e.what() << '\n'; return 1; }
}
