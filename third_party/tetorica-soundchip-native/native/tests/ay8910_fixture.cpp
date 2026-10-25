// Offline independent AY-3-8910 fixture; no OPLL, machine, or audio device.
#include <tetorica/ay8910.hpp>
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

static void ay_voice(void *chip, uint8_t ch) {
    native_ay8910_write(chip, ch * 2, 127 + ch * 43); native_ay8910_write(chip, ch * 2 + 1, 1);
    native_ay8910_write(chip, 7, 0x38); native_ay8910_write(chip, 8 + ch, 12 - ch);
}
static void sample(void *chip, float &l, float &r) {
    native_ay8910_sample(chip, &l, &r); assert(l == r && std::isfinite(l));
}
static double render(void *chip, uint32_t frames) {
    double sum = 0; float l, r; for (uint32_t i = 0; i < frames; ++i) { sample(chip, l, r); sum += std::abs(l); } return sum;
}
static void tones_noise_mixer_and_reads() {
    for (uint8_t ch = 0; ch < 3; ++ch) for (uint8_t mode = 0; mode < 4; ++mode) {
        void *chip = native_ay8910_create(48000), *reference = native_ay8910_create(48000); assert(chip && reference); audit = true;
        uint8_t mixer = 63; if (mode & 1) mixer &= ~(1u << ch); if (mode & 2) mixer &= ~(1u << (ch + 3));
        for (void *p : {chip, reference}) {
            native_ay8910_write(p, ch * 2, 127 + ch * 43); native_ay8910_write(p, ch * 2 + 1, 1);
            native_ay8910_write(p, 6, 7); native_ay8910_write(p, 7, mixer); native_ay8910_write(p, 8 + ch, 15);
            native_ay8910_write(p, 14, 0x55); native_ay8910_write(p, 15, 0xaa);
        }
        double energy = 0;
        for (uint32_t frame = 0; frame < 1024; ++frame) {
            NativeAy8910State state{}; native_ay8910_get_state(chip, &state);
            assert(state.registers[7] == mixer && state.levels[ch] == 15);
            for (uint8_t reg = 0; reg < 16; ++reg) assert(native_ay8910_read(chip, reg) == native_ay8910_read(reference, reg));
            float l, r, expected_l, expected_r; sample(chip, l, r); sample(reference, expected_l, expected_r);
            assert(l == expected_l && r == expected_r); energy += std::abs(l);
        }
        assert(energy > .01); native_ay8910_stop(chip); assert(render(chip, 128) == 0); assert(render(reference, 128) > .01);
        audit = false; assert(!allocations && !frees); native_ay8910_destroy(chip); native_ay8910_destroy(reference);
    }
}
static void all_envelope_shapes_and_reset() {
    for (uint8_t shape = 0; shape < 16; ++shape) {
        void *chip = native_ay8910_create(48000), *reference = native_ay8910_create(48000); assert(chip && reference); audit = true;
        for (void *p : {chip, reference}) {
            for (uint8_t ch = 0; ch < 3; ++ch) { ay_voice(p, ch); native_ay8910_write(p, ch + 8, 16); }
            native_ay8910_write(p, 6, 5); native_ay8910_write(p, 7, 0x0a);
            native_ay8910_write(p, 11, 3); native_ay8910_write(p, 12, 0); native_ay8910_write(p, 13, shape);
        }
        double energy = 0;
        for (uint32_t frame = 0; frame < 4096; ++frame) {
            NativeAy8910State state{}; native_ay8910_get_state(chip, &state); assert(state.registers[13] == shape);
            float l, r, expected_l, expected_r; sample(chip, l, r); sample(reference, expected_l, expected_r); assert(l == expected_l && r == expected_r); energy += std::abs(l);
        }
        assert(energy > .01);
        for (void *p : {chip, reference}) {
            native_ay8910_reset(p); for (uint8_t ch = 0; ch < 3; ++ch) { ay_voice(p, ch); native_ay8910_write(p, ch + 8, 16); }
            native_ay8910_write(p, 6, 5); native_ay8910_write(p, 7, 0x0a); native_ay8910_write(p, 11, 3); native_ay8910_write(p, 13, shape);
        }
        for (uint32_t frame = 0; frame < 1024; ++frame) { float l, r, expected_l, expected_r; sample(chip, l, r); sample(reference, expected_l, expected_r); assert(l == expected_l && r == expected_r); }
        audit = false; assert(!allocations && !frees); native_ay8910_destroy(chip); native_ay8910_destroy(reference);
    }
}
static void stop_and_public_release_history() {
    void *ordinary = native_ay8910_create(48000), *preview = native_ay8910_create(48000), *stopped = native_ay8910_create(48000); assert(ordinary && preview && stopped); audit = true;
    for (void *p : {ordinary, preview, stopped}) {
        // Both generator inputs disabled yield a constant positive DAC level,
        // making the resampler-held output observable without phase ambiguity.
        native_ay8910_write(p, 7, 63); native_ay8910_write(p, 8, 15); assert(render(p, 64) > .01);
        assert(native_ay8910_set_clock(p, 100000));
    }
    native_ay8910_all_notes_off(ordinary); native_ay8910_preview_key_off(preview, 0); native_ay8910_stop(stopped);
    float first, other, preview_l, preview_r, stop_l, stop_r;
    sample(ordinary, first, other); sample(preview, preview_l, preview_r); sample(stopped, stop_l, stop_r);
    assert(first > 0 && first == preview_l && stop_l == 0 && stop_r == 0);
    render(ordinary, 64); render(preview, 64); assert(render(ordinary, 64) == 0 && render(preview, 64) == 0);
    for (void *p : {ordinary, preview, stopped}) {
        NativeAy8910State state{}; native_ay8910_get_state(p, &state); assert(state.levels[0] == 15 && state.registers[8] == 0 && state.clock == 100000);
        native_ay8910_set_retained_level(p, 0, 0); native_ay8910_audition_key_on(p, 0); assert(render(p, 64) == 0);
        native_ay8910_set_retained_level(p, 0, 9); native_ay8910_set_retained_level(p, 0, 32); native_ay8910_audition_key_on(p, 0);
        native_ay8910_get_state(p, &state); assert(state.levels[0] == 9 && state.registers[8] == 9); assert(render(p, 128) > .01);
    }
    audit = false; assert(!allocations && !frees); native_ay8910_destroy(ordinary); native_ay8910_destroy(preview); native_ay8910_destroy(stopped);
}
static int self_test() {
    static_assert(sizeof(NativeAy8910State) == 24, "AY ABI");
    tones_noise_mixer_and_reads(); all_envelope_shapes_and_reset(); stop_and_public_release_history();
    assert(!native_ay8910_create(0) && !native_ay8910_create(384001));
    void *ay = native_ay8910_create(48000); assert(ay); audit = true;
    NativeAy8910State state{}; native_ay8910_get_state(ay, &state); assert(state.clock == 1789773 && state.levels[0] == 9 && state.levels[2] == 9 && render(ay, 100) == 0);
    ay_voice(ay, 0); ay_voice(ay, 2); assert(render(ay, 1000) > .01);
    assert(!native_ay8910_set_clock(ay, 99999) && !native_ay8910_set_clock(ay, 100000001));
    assert(native_ay8910_set_clock(ay, 100000000) && native_ay8910_set_clock(ay, 100000));
    native_ay8910_stop(ay); assert(render(ay, 100) == 0); native_ay8910_get_state(ay, &state); assert(state.levels[0] == 12 && state.levels[2] == 10 && !state.registers[8] && !state.registers[10]);
    native_ay8910_set_retained_level(ay, 0, 0); native_ay8910_audition_key_on(ay, 0); native_ay8910_get_state(ay, &state); assert(!state.levels[0] && !state.registers[8]);
    native_ay8910_set_retained_level(ay, 0, 17); native_ay8910_audition_key_on(ay, 0); native_ay8910_get_state(ay, &state); assert(state.levels[0] == 17 && state.registers[8] == 17);
    native_ay8910_reset(ay); native_ay8910_get_state(ay, &state); assert(state.levels[0] == 9 && state.clock == 100000); for (uint8_t reg = 0; reg < 16; ++reg) assert(!state.registers[reg]);
    audit = false; assert(!allocations && !frees); native_ay8910_destroy(ay);
    // Preserve the independently owned foreign voice, including its cached
    // contribution while the outer clock ratio yields held output intervals.
    {
        void *a = native_ay8910_create(48000), *b = native_ay8910_create(48000); assert(a && b); audit = true;
        ay_voice(a, 0); ay_voice(a, 2); ay_voice(b, 2); render(a, 701); render(b, 701);
        native_ay8910_set_clock(a, 100000); native_ay8910_set_clock(b, 100000); render(a, 39); render(b, 39); native_ay8910_key_off(a, 0);
        double energy = 0;
        for (uint32_t i = 0; i < 1000; ++i) { float al, ar, bl, br; sample(a, al, ar); sample(b, bl, br); assert(std::abs(al - bl) <= 1e-7); energy += std::abs(al); NativeAy8910State observed{}; native_ay8910_get_state(a, &observed); native_ay8910_read(a, 14); }
        assert(energy > .01); audit = false; assert(!allocations && !frees); native_ay8910_destroy(a); native_ay8910_destroy(b);
    }
    std::puts("Standalone AY8910 all3tones/noise/mixers/all16envelopes/independence/retainedlevels/Stop-vs-release-history/reset/clock/reads passed; callback allocations 0, frees 0"); return 0;
}
struct Event { uint32_t frame = 0, a = 0, b = 0; std::string op; };
int main(int argc, char **argv) {
    try {
        if (argc == 2 && std::string(argv[1]) == "--self-test") return self_test();
        if (argc != 3 && argc != 4) return 2; if (argc == 4 && std::string(argv[1]) != "ay8910") return 2;
        const int first = argc == 4 ? 2 : 1;
        const uint32_t rate = std::stoul(argv[first]), frames = std::stoul(argv[first + 1]), planes = 22; if (frames > 10000000) return 2;
        std::vector<Event> events; std::string line;
        while (std::getline(std::cin, line)) {
            std::istringstream in(line); Event event; if (!(in >> event.frame >> event.op)) continue;
            if (event.op == "write" || event.op == "retained") in >> event.a >> event.b;
            else if (event.op == "clock" || event.op == "off" || event.op == "audition") in >> event.a;
            else if (event.op != "reset" && event.op != "stop" && event.op != "all-off") return 2;
            events.push_back(std::move(event));
        }
        std::stable_sort(events.begin(), events.end(), [](const Event &a, const Event &b) { return a.frame < b.frame; });
        void *chip = native_ay8910_create(rate); if (!chip) return 3;
        std::vector<float> pcm(frames * planes); size_t next = 0; audit = true;
        for (uint32_t frame = 0; frame < frames; ++frame) {
            while (next < events.size() && events[next].frame == frame) {
                const auto &event = events[next++];
                if (event.op == "write") native_ay8910_write(chip, event.a, event.b);
                else if (event.op == "clock") assert(native_ay8910_set_clock(chip, event.a));
                else if (event.op == "reset") native_ay8910_reset(chip);
                else if (event.op == "stop") native_ay8910_stop(chip);
                else if (event.op == "all-off") native_ay8910_all_notes_off(chip);
                else if (event.op == "off") native_ay8910_preview_key_off(chip, event.a);
                else if (event.op == "audition") native_ay8910_audition_key_on(chip, event.a);
                else if (event.op == "retained") native_ay8910_set_retained_level(chip, event.a, event.b);
            }
            float *out = &pcm[frame * planes]; sample(chip, out[0], out[1]);
            NativeAy8910State state{}; native_ay8910_get_state(chip, &state); for (uint8_t i = 0; i < 16; ++i) out[2 + i] = state.registers[i];
            for (uint8_t i = 0; i < 3; ++i) out[18 + i] = state.levels[i]; out[21] = state.clock;
        }
        audit = false; assert(!allocations && !frees); native_ay8910_destroy(chip);
        return std::fwrite(pcm.data(), sizeof(float), pcm.size(), stdout) == pcm.size() ? 0 : 4;
    } catch (const std::exception &e) { std::cerr << e.what() << '\n'; return 1; }
}
