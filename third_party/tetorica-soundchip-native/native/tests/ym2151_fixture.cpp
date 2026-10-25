// Standalone offline OPM fixture. Never creates an audio device or OKI core.
#include <tetorica/ym2151.hpp>
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
void *operator new(std::size_t size) { if (audit) ++allocations; if (auto *p = std::malloc(size)) return p; throw std::bad_alloc(); }
void *operator new[](std::size_t size) { return ::operator new(size); }
void operator delete(void *p) noexcept { if (audit && p) ++frees; std::free(p); }
void operator delete[](void *p) noexcept { ::operator delete(p); }
void operator delete(void *p, std::size_t) noexcept { ::operator delete(p); }
void operator delete[](void *p, std::size_t) noexcept { ::operator delete(p); }
static void write(void *p, uint8_t reg, uint8_t value) { native_ym2151_write(p, reg, value); }
static void voice(void *p, uint8_t ch) {
    for (uint8_t op = 0; op < 4; ++op) {
        const uint8_t slot = op * 8 + ch;
        write(p, 0x40 + slot, op + 1); write(p, 0x60 + slot, 24 + op * 5);
        write(p, 0x80 + slot, 31); write(p, 0xa0 + slot, 0x80); write(p, 0xc0 + slot, 0); write(p, 0xe0 + slot, 15);
    }
    write(p, 0x20 + ch, 0xc7); write(p, 0x28 + ch, 0x4a); write(p, 0x30 + ch, ch * 16); write(p, 8, ch | 0x78);
}
static void all_channels_pan_and_reads() {
    for (uint8_t ch = 0; ch < 8; ++ch) for (uint8_t pan : {0x40, 0x80, 0xc0}) {
        void *first = native_ym2151_create(48000), *reference = native_ym2151_create(48000);
        assert(first && reference);
        audit = true;
        for (void *p : {first, reference}) { voice(p, ch); write(p, 0x20 + ch, pan | 7); }
        double left = 0, right = 0;
        for (uint32_t frame = 0; frame < 1024; ++frame) {
            // Repeated observations on only one instance must not advance its
            // oscillators, envelopes, free-running noise/LFO or timer state.
            for (uint32_t observation = 0; observation < 4; ++observation) {
                NativeYm2151State state{}; native_ym2151_get_state(first, &state);
                assert(state.keys[ch] == 15 && state.registers[0x20 + ch] == (pan | 7));
                for (uint8_t other = 0; other < 8; ++other) if (other != ch) assert(!state.keys[other]);
                assert(native_ym2151_read(first, 0) == native_ym2151_read(reference, 0));
                assert(native_ym2151_read(first, 1) == native_ym2151_read(reference, 1));
                assert(native_ym2151_read_status(first) == native_ym2151_read_status(reference));
            }
            float l, r, expected_l, expected_r;
            native_ym2151_sample(first, &l, &r); native_ym2151_sample(reference, &expected_l, &expected_r);
            assert(std::isfinite(l) && std::isfinite(r)); assert(l == expected_l && r == expected_r);
            left += std::abs(l); right += std::abs(r);
        }
        assert((pan & 0x40) ? left > .1 : left == 0);
        assert((pan & 0x80) ? right > .1 : right == 0);
        native_ym2151_stop(first);
        double reference_energy = 0;
        for (uint32_t frame = 0; frame < 128; ++frame) {
            float l, r, expected_l, expected_r;
            native_ym2151_sample(first, &l, &r); native_ym2151_sample(reference, &expected_l, &expected_r);
            assert(l == 0 && r == 0); reference_energy += std::abs(expected_l) + std::abs(expected_r);
        }
        assert(reference_energy > .1);
        audit = false; assert(!allocations && !frees);
        native_ym2151_destroy(first); native_ym2151_destroy(reference);
    }
}
static int self_test() {
    static_assert(sizeof(NativeYm2151State) == 272, "OPM state ABI");
    all_channels_pan_and_reads();
    assert(!native_ym2151_create(0));
    void *first = native_ym2151_create(48000), *reference = native_ym2151_create(48000), *fresh = native_ym2151_create(48000);
    assert(first && reference && fresh);
    NativeYm2151State state{};
    audit = true;
    assert(!native_ym2151_set_clock(first, 99999)); assert(!native_ym2151_set_clock(first, 100000001));
    assert(native_ym2151_set_clock(first, 100000)); assert(native_ym2151_set_clock(first, 100000000)); assert(native_ym2151_set_clock(first, 3579545));
    for (void *p : {first, reference}) {
        voice(p, 4); voice(p, 7); write(p, 0x0f, 0x91);
        write(p, 0x18, 237); write(p, 0x19, 67); write(p, 0x19, 128 | 93); write(p, 0x1b, 3);
    }
    for (uint32_t clock : {3579545u, 100000u, 3579545u}) {
        voice(first, 0); assert(native_ym2151_set_clock(first, clock)); assert(native_ym2151_set_clock(reference, clock));
        for (uint32_t frame = 0; frame < 4096; ++frame) {
            if (frame == 701) native_ym2151_key_off(first, 0);
            if (frame == 1703) write(first, 0x60, 1); // Authored edit cannot resurrect a force-muted note.
            float l, r, el, er;
            native_ym2151_get_state(first, &state);
            native_ym2151_sample(first, &l, &r); native_ym2151_sample(reference, &el, &er);
            if (frame >= 701) assert(l == el && r == er);
        }
    }
    native_ym2151_get_state(first, &state); assert(state.clock == 3579545 && state.amd == 67 && state.pmd == 93 && !state.keys[0] && state.registers[0x60] == 1);
    // Restore a power-on image after free-running random LFO/noise activity.
    native_ym2151_reset(first);
    for (void *p : {first, fresh}) { voice(p, 7); write(p, 0x0f, 0x91); write(p, 0x18, 237); write(p, 0x19, 67); write(p, 0x19, 221); write(p, 0x1b, 3); }
    for (uint32_t n = 0; n < 4096; ++n) { float l, r, el, er; native_ym2151_sample(first, &l, &r); native_ym2151_sample(fresh, &el, &er); assert(l == el && r == er); }
    // CSM is one global source; its cancellation preserves all normal keys.
    write(first, 8, 2 | (9 << 3)); write(first, 8, 5 | (3 << 3)); write(first, 0x10, 255); write(first, 0x11, 3); write(first, 0x14, 0x8f);
    native_ym2151_key_off_fm(first, 2); native_ym2151_get_state(first, &state);
    assert(!state.keys[2] && state.keys[5] == 3 && (state.registers[0x14] & 0x81) == 0x81);
    native_ym2151_all_notes_off(first); native_ym2151_get_state(first, &state);
    assert((state.registers[0x14] & 0x81) == 0x81); for (auto key : state.keys) assert(!key);
    write(first, 8, 5 | (3 << 3));
    native_ym2151_cancel_csm(first); native_ym2151_get_state(first, &state);
    assert(!(state.registers[0x14] & 0x81) && (state.registers[0x14] & 2) && state.keys[5] == 3);
    native_ym2151_audition_key_on(first, 1, 5); native_ym2151_stop(first);
    for (int n = 0; n < 200; ++n) { float l, r; native_ym2151_sample(first, &l, &r); assert(l == 0 && r == 0); }
    native_ym2151_audition_key_on(first, 1, 5); native_ym2151_reset(first);
    for (int n = 0; n < 200; ++n) { float l, r; native_ym2151_sample(first, &l, &r); }
    native_ym2151_get_state(first, &state); for (auto key : state.keys) assert(!key);
    voice(first, 0); write(first, 0x10, 255); write(first, 0x11, 3); write(first, 0x14, 5);
    for (int n = 0; n < 128; ++n) { float l, r; native_ym2151_sample(first, &l, &r); }
    native_ym2151_get_state(first, &state); assert((state.status & 1) && state.irq);
    for (int n = 0; n < 100; ++n) native_ym2151_get_state(first, &state);
    assert((state.status & 1) && state.irq); write(first, 0x14, 0x10); native_ym2151_get_state(first, &state); assert(!(state.status & 1) && !state.irq);
    write(first, 0x12, 255); write(first, 0x14, 0x0a);
    for (int n = 0; n < 128; ++n) { float l, r; native_ym2151_sample(first, &l, &r); }
    native_ym2151_get_state(first, &state); assert((state.status & 2) && state.irq);
    for (int n = 0; n < 100; ++n) { assert(native_ym2151_read_status(first) & 2); native_ym2151_get_state(first, &state); }
    assert((state.status & 2) && state.irq); write(first, 0x14, 0x20); native_ym2151_get_state(first, &state); assert(!(state.status & 2) && !state.irq);
    audit = false; assert(!allocations && !frees);
    native_ym2151_destroy(first); native_ym2151_destroy(reference); native_ym2151_destroy(fresh);
    std::puts("YM2151 all8channels/pan/observation/independent/reset-power-on/timers/CSM/cache/preview/snapshot self-test passed; callback allocations 0, frees 0"); return 0;
}
struct Event { uint32_t frame = 0, a = 0, b = 0; std::string op; };
int main(int argc, char **argv) {
    try {
        if (argc == 2 && std::string(argv[1]) == "--self-test") return self_test();
        if (argc != 3) return 2;
        const uint32_t rate = std::stoul(argv[1]), frames = std::stoul(argv[2]); if (frames > 10000000) return 2;
        std::vector<Event> events; std::string line;
        while (std::getline(std::cin, line)) {
            std::istringstream in(line); Event event; if (!(in >> event.frame >> event.op)) continue;
            if (event.op == "write" || event.op == "audition") in >> event.a >> event.b;
            else if (event.op == "clock" || event.op == "off" || event.op == "off-fm") in >> event.a;
            else if (event.op != "reset" && event.op != "stop" && event.op != "all-off" && event.op != "cancel-csm") return 2;
            events.push_back(std::move(event));
        }
        std::stable_sort(events.begin(), events.end(), [](const Event &a, const Event &b) { return a.frame < b.frame; });
        auto *chip = native_ym2151_create(rate); if (!chip) return 3;
        std::vector<float> pcm(frames * 16); size_t next = 0;
        audit = true;
        for (uint32_t frame = 0; frame < frames; ++frame) {
            while (next < events.size() && events[next].frame == frame) {
                const auto &e = events[next++];
                if (e.op == "write") write(chip, e.a, e.b);
                else if (e.op == "clock") assert(native_ym2151_set_clock(chip, e.a));
                else if (e.op == "off") native_ym2151_key_off(chip, e.a);
                else if (e.op == "off-fm") native_ym2151_key_off_fm(chip, e.a);
                else if (e.op == "audition") native_ym2151_audition_key_on(chip, e.a, e.b);
                else if (e.op == "cancel-csm") native_ym2151_cancel_csm(chip);
                else if (e.op == "reset") native_ym2151_reset(chip);
                else if (e.op == "stop") native_ym2151_stop(chip);
                else if (e.op == "all-off") native_ym2151_all_notes_off(chip);
            }
            native_ym2151_sample(chip, &pcm[frame * 16], &pcm[frame * 16 + 1]);
            pcm[frame * 16 + 2] = native_ym2151_read_status(chip); pcm[frame * 16 + 3] = native_ym2151_get_irq(chip);
            pcm[frame * 16 + 4] = native_ym2151_read(chip, 0); pcm[frame * 16 + 5] = native_ym2151_read(chip, 1);
            NativeYm2151State state{}; native_ym2151_get_state(chip, &state);
            for (uint32_t ch = 0; ch < 8; ++ch) pcm[frame * 16 + 6 + ch] = state.keys[ch];
            pcm[frame * 16 + 14] = state.amd; pcm[frame * 16 + 15] = state.pmd;
        }
        audit = false; assert(!allocations && !frees); native_ym2151_destroy(chip);
        return std::fwrite(pcm.data(), sizeof(float), pcm.size(), stdout) == pcm.size() ? 0 : 4;
    } catch (const std::exception &e) { std::cerr << e.what() << '\n'; return 1; }
}
