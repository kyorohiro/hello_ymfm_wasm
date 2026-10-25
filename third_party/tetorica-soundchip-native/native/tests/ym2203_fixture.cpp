// Offline PCM/state fixture, never opens a playback device.
#include <tetorica/ym2203.hpp>
#include <algorithm>
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
static uint64_t allocations = 0, frees = 0;
static void *(*create_chip)(uint32_t) = native_ym2203_create;
void *operator new(std::size_t n) { if (audit) ++allocations; if (void *p = std::malloc(n)) return p; throw std::bad_alloc(); }
void *operator new[](std::size_t n) { return ::operator new(n); }
void operator delete(void *p) noexcept { if (audit && p) ++frees; std::free(p); }
void operator delete[](void *p) noexcept { ::operator delete(p); }
void operator delete(void *p, std::size_t) noexcept { ::operator delete(p); }
void operator delete[](void *p, std::size_t) noexcept { ::operator delete(p); }
static void write(void *p, uint8_t r, uint8_t v) { native_ym2203_write(p, 0, r, v); }
static void voice(void *p, uint8_t ch) {
    for (uint8_t op = 0; op < 4; ++op) {
        const uint8_t off = ch + op * 4;
        write(p, 0x30 + off, 1); write(p, 0x40 + off, 12 + op * 5);
        write(p, 0x50 + off, 31); write(p, 0x60 + off, 3); write(p, 0x70 + off, 0); write(p, 0x80 + off, 0x2f);
    }
    write(p, 0xb0 + ch, 7); write(p, 0xa4 + ch, 0x24); write(p, 0xa0 + ch, 0x81); write(p, 0x28, 0xf0 | ch);
}
static double render(void *p, uint32_t n) {
    double energy = 0; float l, r;
    for (uint32_t i = 0; i < n; ++i) { native_ym2203_sample(p, &l, &r); assert(std::isfinite(l) && l == r); energy += std::abs(l); }
    return energy;
}
static void ssg_channels_noise_and_envelopes() {
    for (uint8_t ch = 0; ch < 3; ++ch) {
        void *a = create_chip(48000), *b = create_chip(48000); assert(a && b); audit = true;
        for (void *p : {a, b}) {
            write(p, ch * 2, 127 + ch * 31); write(p, ch * 2 + 1, 1); write(p, 6, 7);
            write(p, 7, uint8_t(63 & ~(1u << ch) & ~(1u << (ch + 3)))); write(p, 8 + ch, 12);
        }
        double energy = 0;
        for (uint32_t frame = 0; frame < 1024; ++frame) {
            NativeYm2203State state{}; native_ym2203_get_state(a, &state); assert(state.ssg_levels[ch] == 12);
            for (uint8_t port = 0; port < 4; ++port) assert(native_ym2203_read(a, port) == native_ym2203_read(b, port));
            float l, r, expected_l, expected_r; native_ym2203_sample(a, &l, &r); native_ym2203_sample(b, &expected_l, &expected_r);
            assert(std::isfinite(l) && l == r && l == expected_l && r == expected_r); energy += std::abs(l);
        }
        assert(energy > .01);
        native_ym2203_set_source_mute_mask(a, 1); assert(render(a, 128) == 0); render(b, 128);
        native_ym2203_set_source_mute_mask(a, 0);
        for (uint32_t frame = 0; frame < 128; ++frame) { float l, r, expected_l, expected_r; native_ym2203_sample(a, &l, &r); native_ym2203_sample(b, &expected_l, &expected_r); assert(l == expected_l && r == expected_r); }
        native_ym2203_stop(a); assert(render(a, 128) == 0 && render(b, 128) > .01);
        audit = false; assert(!allocations && !frees); native_ym2203_destroy(a); native_ym2203_destroy(b);
    }
    for (uint8_t shape = 0; shape < 16; ++shape) {
        void *p = create_chip(48000); assert(p); audit = true;
        for (uint8_t ch = 0; ch < 3; ++ch) { write(p, ch * 2, 127 + ch * 31); write(p, ch * 2 + 1, 1); write(p, 8 + ch, 16); }
        write(p, 6, 7); write(p, 7, 0x0a); write(p, 11, 23); write(p, 12, 0); write(p, 13, shape);
        assert(render(p, 2048) > .01); NativeYm2203State state{}; native_ym2203_get_state(p, &state);
        assert(state.registers[13] == shape); for (uint8_t ch = 0; ch < 3; ++ch) assert(state.ssg_levels[ch] == 16);
        audit = false; assert(!allocations && !frees); native_ym2203_destroy(p);
    }
}
static void distinct_reset_profiles() {
    void *primary = native_ym2203_create(48000), *additional = native_ym2203_create_extra(48000); assert(primary && additional); audit = true;
    for (void *p : {primary, additional}) {
        write(p, 7, 63); write(p, 8, 15); assert(render(p, 4) > .01);
        assert(native_ym2203_set_clock(p, 100000)); native_ym2203_reset(p);
        NativeYm2203State state{}; native_ym2203_get_state(p, &state); assert(state.clock == 100000 && !state.ssg_levels[0] && !state.registers[8] && !state.irq);
    }
    float held_l, held_r, clear_l, clear_r; native_ym2203_sample(primary, &held_l, &held_r); native_ym2203_sample(additional, &clear_l, &clear_r);
    // At this boundary the next outer frame contains no source interval.
    // Primary retains that frame, while the additional profile clears it.
    assert(held_l > 0 && held_l == held_r && clear_l == 0 && clear_r == 0);
    // The core's own preexisting resampler history is separate from the outer
    // profile boundary. Subsequent output stays finite; explicit Stop clears
    // both profiles immediately, including all held contributions.
    render(primary, 128); render(additional, 128); native_ym2203_stop(primary); native_ym2203_stop(additional);
    assert(render(primary, 128) == 0 && render(additional, 128) == 0);
    audit = false; assert(!allocations && !frees); native_ym2203_destroy(primary); native_ym2203_destroy(additional);
}
static int self_test() {
    static_assert(sizeof(NativeYm2203State) == 280, "Rust FFI layout");
    ssg_channels_noise_and_envelopes();
    assert(!create_chip(0) && !create_chip(384001));
    void *p = create_chip(48000); assert(p); NativeYm2203State s{}; audit = true;
    native_ym2203_get_state(p, &s); assert(s.clock == 4000000 && s.prescaler == 6 && render(p, 200) == 0);
    for (uint8_t ch = 0; ch < 3; ++ch) voice(p, ch);
    assert(render(p, 4000) > 1);
    write(p, 0, 127); write(p, 1, 1); write(p, 6, 13); write(p, 7, 0x38); write(p, 8, 11);
    write(p, 9, 16); write(p, 11, 37); write(p, 12, 1); write(p, 13, 10); write(p, 14, 0xaa); write(p, 15, 0x55);
    assert(render(p, 1000) > .1);
    write(p, 0x2e, 0); native_ym2203_get_state(p, &s); assert(s.prescaler == 3);
    write(p, 0x2f, 0); write(p, 0x2e, 0); native_ym2203_get_state(p, &s); assert(s.prescaler == 2);
    write(p, 0x2d, 0); native_ym2203_get_state(p, &s); assert(s.prescaler == 6);
    write(p, 0xa4, 0x21); write(p, 0xa0, 0x11); write(p, 0xa4, 0x2a); write(p, 0xa1, 0x22);
    native_ym2203_get_state(p, &s); assert(s.registers[0xa4] == 0x21 && s.registers[0xa5] == 0x2a);
    assert(native_ym2203_set_clock(p, 100000000)); assert(native_ym2203_set_clock(p, 100000)); assert(!native_ym2203_set_clock(p, 99999)); assert(!native_ym2203_set_clock(p, 100000001));
    write(p, 0x27, 0x40); native_ym2203_stop(p); native_ym2203_get_state(p, &s);
    assert(s.clock == 100000 && s.registers[0x27] == 0x40 && s.registers[0xa4] == 0x21 && s.registers[0xa5] == 0x2a);
    assert(s.registers[0x40] == 12 && s.ssg_levels[0] == 11 && s.ssg_levels[1] == 16);
    assert(s.registers[6] == 13 && s.registers[7] == 0x38 && s.registers[13] == 10 && s.registers[14] == 0xaa && s.registers[15] == 0x55);
    assert(render(p, 2000) == 0);
    native_ym2203_audition_key_on(p, 3); assert(render(p, 2000) > .01);
    native_ym2203_key_off(p, 3); native_ym2203_set_retained_ssg_level(p, 0, 0); native_ym2203_audition_key_on(p, 3);
    render(p, 200); assert(render(p, 1000) == 0); native_ym2203_get_state(p, &s); assert(s.ssg_levels[0] == 0 && s.registers[8] == 0);
    native_ym2203_set_clock(p, 4000000); native_ym2203_audition_key_on(p, 0); assert(render(p, 1000) > .01);
    native_ym2203_key_off(p, 0); render(p, 40); assert(render(p, 200) == 0);
    native_ym2203_audition_key_on(p, 0); native_ym2203_key_off(p, 0); assert(render(p, 2000) == 0);
    native_ym2203_audition_key_on(p, 0); native_ym2203_stop(p); assert(render(p, 1000) == 0);
    voice(p, 0); native_ym2203_set_source_mute_mask(p, 3); assert(render(p, 1000) == 0);
    native_ym2203_set_source_mute_mask(p, 0); assert(render(p, 1000) > .1);
    native_ym2203_set_mute_mask(p, 7); render(p, 40); assert(render(p, 200) == 0); native_ym2203_set_mute_mask(p, 0);
    write(p, 0x24, 255); write(p, 0x25, 3); write(p, 0x26, 255); write(p, 0x27, 15); render(p, 1000);
    assert((native_ym2203_read_status(p) & 3) == 3 && native_ym2203_get_irq(p));
    write(p, 0x27, 0x30); assert(!native_ym2203_get_irq(p));
    for (int i = 0; i < 100; ++i) { native_ym2203_get_state(p, &s); assert(s.status == native_ym2203_read_status(p)); for (uint8_t port = 0; port < 4; ++port) native_ym2203_read(p, port); }
    native_ym2203_stop(p); native_ym2203_reset(p); native_ym2203_get_state(p, &s); assert(s.clock == 4000000 && !s.irq && s.registers[8] == 0 && s.ssg_levels[0] == 0);
    render(p, 40); assert(render(p, 200) == 0);
    audit = false; assert(allocations == 0 && frees == 0); native_ym2203_destroy(p);
    std::puts("Selected mono YM2203 only; FM/SSG six voices, source clocks/mutes, prescalers, applied frequency pairs, retained TL/SSG levels and Stop, deferred retrigger/cancellation, timers/status/IRQ passed; callback allocations 0, frees 0"); return 0;
}
static int extra_self_test() {
    void *a = native_ym2203_create_extra(48000), *b = native_ym2203_create_extra(48000), *reference = native_ym2203_create_extra(48000); assert(a && b && reference);
    audit = true;
    voice(a, 0);
    for (void *p : {b, reference}) {
        voice(p, 2); write(p, 6, 13); write(p, 7, 0); write(p, 8, 16); write(p, 9, 11); write(p, 10, 7);
        write(p, 11, 31); write(p, 13, 10); write(p, 0x2e, 0); write(p, 0x24, 255); write(p, 0x25, 3); write(p, 0x26, 253); write(p, 0x27, 0xcf);
    }
    for (int i = 0; i < 4096; ++i) {
        if (i % 31 == 0) { write(a, 6, i & 31); write(a, 13, i & 15); native_ym2203_set_mute_mask(a, i & 7); assert(native_ym2203_set_clock(a, 100000 + i * 10000)); }
        if (i == 701) native_ym2203_reset(a);
        if (i == 1703) native_ym2203_stop(a);
        float l, r, x, y, ignored; native_ym2203_sample(a, &ignored, &r); native_ym2203_sample(b, &l, &r); native_ym2203_sample(reference, &x, &y);
        assert(l == x && r == y && l == r); assert(native_ym2203_read_status(b) == native_ym2203_read_status(reference)); assert(native_ym2203_get_irq(b) == native_ym2203_get_irq(reference));
    }
    NativeYm2203State s{};
    for (int i = 0; i < 100; ++i) native_ym2203_get_state(b, &s);
    native_ym2203_cancel_csm(b); write(reference, 0x27, 0x4e);
    native_ym2203_get_state(b, &s); assert(s.keys[2] == 15 && s.registers[0x27] == 0x4e && s.ssg_levels[0] == 16 && s.prescaler == 3);
    for (int i = 0; i < 1024; ++i) {
        float l, r, x, y; native_ym2203_sample(b, &l, &r); native_ym2203_sample(reference, &x, &y); assert(l == x && r == y);
    }
    for (void *p : {b, reference}) write(p, 0x27, 0xcf);
    render(b, 1024); render(reference, 1024); native_ym2203_key_off_fm(b, 2); write(reference, 0x28, 2);
    native_ym2203_get_state(b, &s); assert(!s.keys[2] && s.registers[0x27] == 0xcf && s.registers[0x42] == 12);
    for (int i = 0; i < 1024; ++i) {
        float l, r, x, y; native_ym2203_sample(b, &l, &r); native_ym2203_sample(reference, &x, &y); assert(l == x && r == y);
    }
    native_ym2203_stop(b); native_ym2203_audition_fm_key_on(b, 2, 5); native_ym2203_cancel_csm(b); render(b, 1024);
    native_ym2203_get_state(b, &s); assert(s.keys[2] == 5);
    native_ym2203_set_clock(b, 100000); native_ym2203_stop(b); native_ym2203_reset(b); assert(render(b, 1) == 0);
    audit = false; assert(allocations == 0 && frees == 0); native_ym2203_destroy(a);
    audit = true; render(b, 1024); audit = false; assert(allocations == 0 && frees == 0);
    native_ym2203_destroy(b); native_ym2203_destroy(reference);
    std::puts("Additional YM2203: independent FM/SSG/noise/envelope/timers, CSM/normal source cancellation, reset profile, retained controls and control-thread retirement passed; callback allocations 0, frees 0"); return 0;
}
struct Event { uint32_t frame = 0, a = 0, b = 0; std::string op; };
int main(int argc, char **argv) {
    try {
        bool extra = argc > 1 && std::string(argv[1]) == "--extra";
        if (extra) { create_chip = native_ym2203_create_extra; ++argv; --argc; }
        if (argc == 2 && std::string(argv[1]) == "--self-test") {
            create_chip = native_ym2203_create; self_test();
            create_chip = native_ym2203_create_extra; self_test(); extra_self_test(); distinct_reset_profiles();
            return 0;
        }
        if (argc != 3) return 2;
        const uint32_t rate = std::stoul(argv[1]), frames = std::stoul(argv[2]); if (frames > 10000000) return 2;
        std::vector<Event> events; std::string line;
        while (std::getline(std::cin, line)) {
            std::istringstream in(line); Event e; if (!(in >> e.frame >> e.op)) continue;
            if (e.op == "write" || e.op == "level" || e.op == "audition-mask") in >> e.a >> e.b;
            else if (e.op == "clock" || e.op == "source" || e.op == "mute" || e.op == "off" || e.op == "off-fm" || e.op == "audition") in >> e.a;
            else if (e.op != "reset" && e.op != "stop" && e.op != "cancel-csm") return 2;
            events.push_back(std::move(e));
        }
        std::stable_sort(events.begin(), events.end(), [](const Event &a, const Event &b) { return a.frame < b.frame; });
        void *p = create_chip(rate); if (!p) return 3;
        constexpr uint32_t PLANES = 8; std::vector<float> pcm(frames * PLANES); size_t next = 0; audit = true;
        for (uint32_t frame = 0; frame < frames; ++frame) {
            while (next < events.size() && events[next].frame == frame) {
                const auto &e = events[next++];
                if (e.op == "write") write(p, e.a, e.b);
                else if (e.op == "level") native_ym2203_set_retained_ssg_level(p, e.a, e.b);
                else if (e.op == "clock") assert(native_ym2203_set_clock(p, e.a));
                else if (e.op == "source") native_ym2203_set_source_mute_mask(p, e.a);
                else if (e.op == "mute") native_ym2203_set_mute_mask(p, e.a);
                else if (e.op == "off") native_ym2203_key_off(p, e.a);
                else if (e.op == "off-fm") native_ym2203_key_off_fm(p, e.a);
                else if (e.op == "cancel-csm") native_ym2203_cancel_csm(p);
                else if (e.op == "audition") native_ym2203_audition_key_on(p, e.a);
                else if (e.op == "audition-mask") native_ym2203_audition_fm_key_on(p, e.a, e.b);
                else if (e.op == "reset") native_ym2203_reset(p);
                else if (e.op == "stop") native_ym2203_stop(p);
            }
            native_ym2203_sample(p, &pcm[frame*PLANES], &pcm[frame*PLANES+1]); NativeYm2203State s{}; native_ym2203_get_state(p, &s);
            pcm[frame*PLANES+2] = s.status; pcm[frame*PLANES+3] = s.irq;
            for (uint8_t port = 0; port < 4; ++port) pcm[frame*PLANES+4+port] = native_ym2203_read(p, port);
        }
        audit = false; assert(allocations == 0 && frees == 0); native_ym2203_destroy(p);
        return std::fwrite(pcm.data(), sizeof(float), pcm.size(), stdout) == pcm.size() ? 0 : 4;
    } catch (const std::exception &e) { std::cerr << e.what() << '\n'; return 1; }
}
