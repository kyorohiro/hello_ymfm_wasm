// SPDX-License-Identifier: BSD-3-Clause
// Explicit checkpoint ABI/PCM fixture; no audio device or machine ROM.
#include <tetorica/huc6280_state.h>
#include <array>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <new>
#include <vector>
static bool audit = false;
static unsigned allocations = 0;
void *operator new(std::size_t size) { if (audit) ++allocations; if (void *p = std::malloc(size)) return p; throw std::bad_alloc(); }
void *operator new[](std::size_t size) { return ::operator new(size); }
void operator delete(void *p) noexcept { std::free(p); }
void operator delete[](void *p) noexcept { ::operator delete(p); }
void operator delete(void *p, std::size_t) noexcept { ::operator delete(p); }
void operator delete[](void *p, std::size_t) noexcept { ::operator delete(p); }
using State = std::array<uint8_t, 512>;
static void put32(uint8_t *p, uint32_t value) { for (unsigned i = 0; i < 4; ++i) p[i] = uint8_t(value >> (8 * i)); }
static State save(void *h) { State data{}; assert(huc6280_state_size(h) == data.size()); assert(huc6280_save_state(h, data.data(), data.size())); return data; }
static void program(void *h, unsigned mode = 0) {
    huc6280_write(h, 1, 0xed); huc6280_write(h, 9, 0);
    for (unsigned ch = 0; ch < 8; ++ch) {
        huc6280_write(h, 0, ch); huc6280_write(h, 4, 64); huc6280_write(h, 4, 0);
        for (unsigned i = 0; i < 32; ++i) huc6280_write(h, 6, (i * (ch + 1) + ch * 3) & 31);
        huc6280_write(h, 2, 113 + ch * 29); huc6280_write(h, 3, ch & 3);
        huc6280_write(h, 5, 0xf9); huc6280_write(h, 4, 159 - ch);
    }
    if (mode == 1 || mode == 3) for (unsigned ch = 4; ch < 6; ++ch) {huc6280_write(h, 0, ch); huc6280_write(h, 7, 0x87 + ch);}
    if (mode == 2 || mode == 3) {huc6280_write(h, 8, 7); huc6280_write(h, 9, 3);}
    if (mode == 3) {huc6280_write(h, 0, 3); huc6280_write(h, 4, 223); huc6280_write(h, 6, 29); huc6280_mute(h, 1, 1); huc6280_mute(h, 5, 1);}
    huc6280_write(h, 0, 7);
}
static void render(void *h, std::vector<float> &left, std::vector<float> &right) {huc6280_generate(h, left.data(), right.data(), uint32_t(left.size()));}
static void compare(void *a, void *b, unsigned frames) {
    std::vector<float> left(frames), right(frames), other_left(frames), other_right(frames);
    render(a, left, right); render(b, other_left, other_right);
    assert(!std::memcmp(left.data(), other_left.data(), frames * sizeof(float)) && !std::memcmp(right.data(), other_right.data(), frames * sizeof(float)));
    for (unsigned i = 0; i < frames; ++i) assert(std::isfinite(left[i]) && std::isfinite(right[i]));
}
static void reject(void *h, const State &bad) {
    const State before = save(h);
    audit = true; assert(!huc6280_validate_state(h, bad.data(), bad.size())); assert(!huc6280_load_state(h, bad.data(), bad.size())); audit = false;
    assert(before == save(h));
}
static void write_bytes(const char *path, const void *data, size_t size) {FILE *file = std::fopen(path, "wb"); assert(file); assert(std::fwrite(data, 1, size, file) == size); std::fclose(file);}
static void write_pcm(void *h, const char *path) {
    std::vector<float> left(4096), right(4096); render(h, left, right); std::vector<uint8_t> bytes(4096 * 8);
    for (unsigned i = 0; i < 4096; ++i) {uint32_t l, r; std::memcpy(&l, &left[i], 4); std::memcpy(&r, &right[i], 4); put32(bytes.data() + i * 8, l); put32(bytes.data() + i * 8 + 4, r);}
    write_bytes(path, bytes.data(), bytes.size());
}
int main(int argc, char **argv) {
    if (argc == 4 && !std::strcmp(argv[1], "--export")) {
        void *h = huc6280_create(3579545, 44100); program(h, 3); std::vector<float> l(137), r(137); render(h, l, r);
        const State state = save(h); write_bytes(argv[2], state.data(), state.size()); write_pcm(h, argv[3]); huc6280_destroy(h); return 0;
    }
    if (argc == 4 && !std::strcmp(argv[1], "--import")) {
        State state{}; FILE *file = std::fopen(argv[2], "rb"); assert(file); assert(std::fread(state.data(), 1, state.size(), file) == state.size()); std::fclose(file);
        void *h = huc6280_create(3579545, 44100); assert(huc6280_load_state(h, state.data(), state.size())); write_pcm(h, argv[3]); huc6280_destroy(h); return 0;
    }
    for (uint32_t clock : {100000u, 3579545u, 7159090u}) for (uint32_t rate : {8000u, 44100u, 48000u, 96000u, 384000u}) for (unsigned mode = 0; mode < 4; ++mode) {
        void *a = huc6280_create(clock, rate), *b = huc6280_create(clock, rate), *reference = huc6280_create(clock, rate); assert(a && b && reference);
        program(a, mode); program(reference, mode); compare(a, reference, 137); const State state = save(a);
        audit = true;
        for (unsigned i = 0; i < 32; ++i) {assert(huc6280_validate_state(a, state.data(), state.size())); assert(huc6280_load_state(b, state.data(), state.size()));}
        audit = false; assert(!allocations); assert(save(b) == state); compare(b, reference, 2057);
        huc6280_write(a, 0, 0); huc6280_write(a, 4, 0); assert(huc6280_load_state(a, state.data(), state.size())); assert(save(a) == state);
        huc6280_destroy(a); huc6280_destroy(b); huc6280_destroy(reference);
    }
    void *h = huc6280_create(3579545, 44100); program(h, 3); std::vector<float> l(137), r(137); render(h, l, r); const State good = save(h);
    assert(good[48] == 7 && good[53] == 34); assert(!huc6280_state_size(nullptr));
    State output{}; output.fill(0xa5); assert(!huc6280_save_state(h, output.data(), 511)); for (auto value : output) assert(value == 0xa5);
    for (uint32_t size : {0u, 511u, 513u}) {assert(!huc6280_load_state(h, good.data(), size)); assert(!huc6280_validate_state(h, good.data(), size));}
    assert(!huc6280_save_state(nullptr, output.data(), 512)); assert(!huc6280_load_state(nullptr, good.data(), 512)); assert(!huc6280_validate_state(nullptr, good.data(), 512));
    assert(!huc6280_save_state(h, nullptr, 512)); assert(!huc6280_load_state(h, nullptr, 512));
    assert(!huc6280_save_state(h, static_cast<uint8_t *>(h), 512)); assert(!huc6280_load_state(h, static_cast<uint8_t *>(h), 512)); assert(save(h) == good);
    for (unsigned offset : {0u, 8u, 12u, 16u, 24u, 28u, 49u, 54u}) {State bad = good; bad[offset] ^= 1; reject(h, bad);}
    for (auto item : {std::pair<unsigned, uint32_t>{32, 44100}, {40, 0x7fc00000}, {44, 0x7f800000}, {64, 4096}, {104, UINT32_MAX}, {104, 1985}, {108, 1}, {112, 0x40000}, {116, uint32_t(-256)}, {116, 4337}, {172, 1044481}, {228, UINT32_MAX}}) {
        State bad = good; put32(bad.data() + item.first, item.second); reject(h, bad);
    }
    for (auto item : {std::pair<unsigned, uint8_t>{48, 8}, {53, 64}, {68, 32}, {100, 32}, {102, 32}, {103, 0xff}}) {State bad = good; bad[item.first] = item.second; reject(h, bad);}
    {State bad = good; put32(bad.data() + 64 + 4 * 56 + 48, 0); reject(h, bad);}
    for (auto settings : {std::pair<uint32_t, uint32_t>{3579546, 44100}, {3579545, 48000}}) {
        void *other = huc6280_create(settings.first, settings.second); const State before = save(other);
        assert(!huc6280_validate_state(other, good.data(), 512)); assert(!huc6280_load_state(other, good.data(), 512)); assert(save(other) == before); huc6280_destroy(other);
    }
    // Extreme valid LFO steps include negative carrier ticks and the maximum
    // held modulator timer; none may be normalized on checkpoint restore.
    for (unsigned value : {0u, 31u}) {
        huc6280_reset(h); huc6280_write(h, 1, 255);
        for (unsigned ch = 0; ch < 2; ++ch) {huc6280_write(h, 0, ch); huc6280_write(h, 4, 64); huc6280_write(h, 4, 0); for (unsigned i = 0; i < 32; ++i) huc6280_write(h, 6, ch ? value : i); huc6280_write(h, 2, ch ? 0 : 1); huc6280_write(h, 3, 0); huc6280_write(h, 5, 255); huc6280_write(h, 4, 159);}
        huc6280_write(h, 8, 255); huc6280_write(h, 9, 3); render(h, l, r); const State state = save(h); assert(huc6280_validate_state(h, state.data(), 512));
    }
    huc6280_destroy(h); assert(!allocations); std::puts("HuC6280 state ABI v1: 512-byte explicit encoding, exact continuation, guards and zero-allocation validation passed");
}
