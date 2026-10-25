// Offline independent YM2413 fixture; no AY, Sega PSG, machine, or device.
#include <tetorica/ym2413.hpp>
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

static void opll_voice(void *chip, uint8_t ch, uint8_t instrument = 1) {
    native_ym2413_write(chip, 0x30 + ch, (instrument << 4) | 3);
    native_ym2413_write(chip, 0x10 + ch, 0xc0); native_ym2413_write(chip, 0x20 + ch, 0x18);
}
static void sample(void *chip, float &l, float &r) {
    native_ym2413_sample(chip, &l, &r); assert(l == r && std::isfinite(l));
}
static double render(void *chip, uint32_t frames) {
    double sum = 0; float l, r;
    for (uint32_t i = 0; i < frames; ++i) { sample(chip, l, r); sum += std::abs(l); }
    return sum;
}
static void melodic_channels_and_patches() {
    for (uint8_t ch = 0; ch < 9; ++ch) {
        void *chip = native_ym2413_create(48000), *reference = native_ym2413_create(48000); assert(chip && reference);
        audit = true; opll_voice(chip, ch); opll_voice(reference, ch); double energy = 0;
        for (uint32_t frame = 0; frame < 2048; ++frame) {
            NativeYm2413State state{}; native_ym2413_get_state(chip, &state);
            assert(state.registers[0x20 + ch] & 16);
            for (uint8_t other = 0; other < 9; ++other) if (other != ch) assert(!(state.registers[0x20 + other] & 16));
            for (uint32_t observation = 0; observation < 4; ++observation) {
                native_ym2413_get_state(chip, &state);
                assert(native_ym2413_read(chip, 0) == native_ym2413_read(reference, 0));
                assert(native_ym2413_read(chip, 1) == native_ym2413_read(reference, 1));
                assert(native_ym2413_read_status(chip) == native_ym2413_read_status(reference));
                assert(native_ym2413_get_irq(chip) == native_ym2413_get_irq(reference));
            }
            float l, r, expected_l, expected_r; sample(chip, l, r); sample(reference, expected_l, expected_r);
            assert(l == expected_l && r == expected_r); energy += std::abs(l);
        }
        assert(energy > .01); native_ym2413_stop(chip); assert(render(chip, 128) == 0); assert(render(reference, 128) > .01);
        audit = false; assert(!allocations && !frees); native_ym2413_destroy(chip); native_ym2413_destroy(reference);
    }
    for (uint8_t instrument = 0; instrument < 16; ++instrument) {
        void *chip = native_ym2413_create(48000); assert(chip); audit = true;
        if (!instrument) {
            const uint8_t patch[8] = {0x21, 0x21, 0, 7, 0xff, 0xff, 0, 0};
            for (uint8_t reg = 0; reg < 8; ++reg) native_ym2413_write(chip, reg, patch[reg]);
        }
        opll_voice(chip, 3, instrument); assert(render(chip, 4096) > .01);
        NativeYm2413State state{}; native_ym2413_get_state(chip, &state); assert(state.registers[0x33] == ((instrument << 4) | 3));
        audit = false; assert(!allocations && !frees); native_ym2413_destroy(chip);
    }
}
static void rhythm_gates_and_retained_levels() {
    for (uint8_t voice = 9; voice < 14; ++voice) {
        void *chip = native_ym2413_create(48000); assert(chip); audit = true;
        for (uint8_t ch = 6; ch < 9; ++ch) { native_ym2413_write(chip, 0x10 + ch, 127 + ch * 13); native_ym2413_write(chip, 0x20 + ch, 8); }
        native_ym2413_write(chip, 0x36, 2); native_ym2413_write(chip, 0x37, 0x43); native_ym2413_write(chip, 0x38, 0x65);
        native_ym2413_write(chip, 0x0e, 63); assert(render(chip, 2048) > .01);
        native_ym2413_key_off(chip, voice); NativeYm2413State state{}; native_ym2413_get_state(chip, &state);
        assert(state.registers[0x0e] == (63 & ~(16 >> (voice - 9))));
        assert(state.registers[0x36] == 2 && state.registers[0x37] == 0x43 && state.registers[0x38] == 0x65);
        native_ym2413_audition_key_on(chip, voice); render(chip, 128); native_ym2413_get_state(chip, &state); assert(state.registers[0x0e] == 63);
        native_ym2413_stop(chip); native_ym2413_get_state(chip, &state); assert(state.registers[0x0e] == 32 && render(chip, 128) == 0);
        assert(state.registers[0x36] == 2 && state.registers[0x37] == 0x43 && state.registers[0x38] == 0x65);
        audit = false; assert(!allocations && !frees); native_ym2413_destroy(chip);
    }
}
static int self_test() {
    static_assert(sizeof(NativeYm2413State) == 72, "OPLL ABI");
    melodic_channels_and_patches(); rhythm_gates_and_retained_levels();
    assert(!native_ym2413_create(0) && !native_ym2413_create(384001));
    void *opll = native_ym2413_create(48000); assert(opll);
    audit = true; NativeYm2413State state{}; native_ym2413_get_state(opll, &state);
    assert(state.clock == 3579545 && render(opll, 100) == 0);
    opll_voice(opll, 0); opll_voice(opll, 8); assert(render(opll, 1000) > .01);
    assert(!native_ym2413_set_clock(opll, 99999) && !native_ym2413_set_clock(opll, 100000001));
    assert(native_ym2413_set_clock(opll, 100000000) && native_ym2413_set_clock(opll, 100000));
    native_ym2413_stop(opll); native_ym2413_get_state(opll, &state);
    assert(state.clock == 100000 && state.registers[0x30] == 0x13 && state.registers[0x38] == 0x13 && render(opll, 100) == 0);
    native_ym2413_audition_key_on(opll, 0); native_ym2413_get_state(opll, &state); assert(!(state.registers[0x20] & 16));
    assert(render(opll, 2000) > .01); native_ym2413_audition_key_on(opll, 0); native_ym2413_key_off(opll, 0);
    native_ym2413_get_state(opll, &state); assert(!(state.registers[0x20] & 16));
    native_ym2413_stop(opll); native_ym2413_audition_key_on(opll, 0); native_ym2413_reset(opll); assert(render(opll, 300) == 0);
    native_ym2413_get_state(opll, &state); assert(state.clock == 100000);
    for (uint8_t reg = 0; reg < 64; ++reg) assert(!state.registers[reg]);
    audit = false; assert(!allocations && !frees); native_ym2413_destroy(opll);
    // Cancel only one voice while another voice has a held low-clock sample.
    {
        void *a = native_ym2413_create(48000), *b = native_ym2413_create(48000); assert(a && b); audit = true;
        opll_voice(a, 0); opll_voice(a, 5); opll_voice(b, 5); render(a, 701); render(b, 701);
        native_ym2413_set_clock(a, 100000); native_ym2413_set_clock(b, 100000); render(a, 39); render(b, 39); native_ym2413_key_off(a, 0);
        double energy = 0;
        for (uint32_t i = 0; i < 1000; ++i) { float al, ar, bl, br; sample(a, al, ar); sample(b, bl, br); assert(std::abs(al - bl) <= 1e-7); energy += std::abs(al); NativeYm2413State observed{}; native_ym2413_get_state(a, &observed); native_ym2413_read(a, 1); }
        assert(energy > .01); audit = false; assert(!allocations && !frees); native_ym2413_destroy(a); native_ym2413_destroy(b);
    }
    // Shared rhythm channels retain the independently owned operator, including
    // the held mixed sample and each channel's nonlinear DAC clipping.
    {
        void *a = native_ym2413_create(96000), *b = native_ym2413_create(96000);
        audit = true;
        for (void *chip : {a, b}) {
            opll_voice(chip, 4);
            for (uint8_t ch = 6; ch < 9; ++ch) { native_ym2413_write(chip, 0x10 + ch, 127 + ch * 13); native_ym2413_write(chip, 0x20 + ch, 8); }
            native_ym2413_write(chip, 0x36, 2); native_ym2413_write(chip, 0x37, 0x43); native_ym2413_write(chip, 0x38, 0x65);
        }
        native_ym2413_write(a, 0x0e, 63); native_ym2413_write(b, 0x0e, 35); // foreign HH/CYM
        render(a, 1703); render(b, 1703);
        native_ym2413_set_clock(a, 100000); native_ym2413_set_clock(b, 100000);
        render(a, 37); render(b, 37);
        native_ym2413_key_off(a, 9); native_ym2413_key_off(a, 10); native_ym2413_key_off(a, 11);
        NativeYm2413State state{}; native_ym2413_get_state(a, &state);
        assert(state.registers[0x0e] == 35 && state.registers[0x37] == 0x43 && state.registers[0x38] == 0x65);
        // A stale melodic release on an aliased physical channel cannot mute
        // its replacement rhythm owner.
        native_ym2413_key_off(a, 7); native_ym2413_key_off(a, 8);
        for (uint32_t i = 0; i < 1000; ++i) { float al, ar, bl, br; sample(a, al, ar); sample(b, bl, br); assert(al == bl); }
        native_ym2413_audition_key_on(a, 10); native_ym2413_audition_key_on(a, 13); native_ym2413_key_off(a, 10);
        render(a, 200); native_ym2413_get_state(a, &state); assert(!(state.registers[0x0e] & 8) && (state.registers[0x0e] & 1));
        audit = false; assert(!allocations && !frees); native_ym2413_destroy(a); native_ym2413_destroy(b);
    }
    // Inverse alias: cancelling inactive authored drum flags cannot mute their
    // physical replacement FM6..8 when rhythm mode is disabled.
    {
        void *a = native_ym2413_create(96000), *b = native_ym2413_create(96000);
        audit = true;
        for (void *chip : {a, b}) { for (uint8_t ch = 6; ch < 9; ++ch) opll_voice(chip, ch); native_ym2413_write(chip, 0x0e, 31); }
        render(a, 1703); render(b, 1703);
        native_ym2413_set_clock(a, 100000); native_ym2413_set_clock(b, 100000);
        render(a, 37); render(b, 37);
        for (uint8_t voice = 9; voice < 14; ++voice) native_ym2413_key_off(a, voice);
        for (uint32_t i = 0; i < 1000; ++i) { float al, ar, bl, br; sample(a, al, ar); sample(b, bl, br); assert(al == bl); }
        audit = false; assert(!allocations && !frees); native_ym2413_destroy(a); native_ym2413_destroy(b);
    }

    std::puts("Standalone YM2413 all9channels/builtin+userpatch/all5rhythm/aliased-cache/independence/clock/read/Stop/reset/audition tests passed; callback allocations 0, frees 0"); return 0;
}
struct Event { uint32_t frame = 0, a = 0, b = 0; std::string op; };
int main(int argc, char **argv) {
    try {
        if (argc == 2 && std::string(argv[1]) == "--self-test") return self_test();
        if (argc != 3 && argc != 4) return 2;
        if (argc == 4 && std::string(argv[1]) != "ym2413") return 2;
        const int first = argc == 4 ? 2 : 1;
        const uint32_t rate = std::stoul(argv[first]), frames = std::stoul(argv[first + 1]), planes = 71; if (frames > 10000000) return 2;
        std::vector<Event> events; std::string line;
        while (std::getline(std::cin, line)) {
            std::istringstream in(line); Event event; if (!(in >> event.frame >> event.op)) continue;
            if (event.op == "write") in >> event.a >> event.b;
            else if (event.op == "clock" || event.op == "off" || event.op == "audition") in >> event.a;
            else if (event.op != "reset" && event.op != "stop" && event.op != "all-off") return 2;
            events.push_back(std::move(event));
        }
        std::stable_sort(events.begin(), events.end(), [](const Event &a, const Event &b) { return a.frame < b.frame; });
        void *chip = native_ym2413_create(rate); if (!chip) return 3;
        std::vector<float> pcm(frames * planes); size_t next = 0; audit = true;
        for (uint32_t frame = 0; frame < frames; ++frame) {
            while (next < events.size() && events[next].frame == frame) {
                const auto &event = events[next++];
                if (event.op == "write") native_ym2413_write(chip, event.a, event.b);
                else if (event.op == "clock") assert(native_ym2413_set_clock(chip, event.a));
                else if (event.op == "reset") native_ym2413_reset(chip);
                else if (event.op == "stop" || event.op == "all-off") native_ym2413_stop(chip);
                else if (event.op == "off") native_ym2413_preview_key_off(chip, event.a);
                else if (event.op == "audition") native_ym2413_audition_key_on(chip, event.a);
            }
            float *out = &pcm[frame * planes]; sample(chip, out[0], out[1]);
            NativeYm2413State state{}; native_ym2413_get_state(chip, &state); for (uint8_t i = 0; i < 64; ++i) out[2 + i] = state.registers[i];
            out[66] = state.clock; out[67] = state.status; out[68] = state.irq; out[69] = native_ym2413_read(chip, 0); out[70] = native_ym2413_read(chip, 1);
        }
        audit = false; assert(!allocations && !frees); native_ym2413_destroy(chip);
        return std::fwrite(pcm.data(), sizeof(float), pcm.size(), stdout) == pcm.size() ? 0 : 4;
    } catch (const std::exception &e) { std::cerr << e.what() << '\n'; return 1; }
}
