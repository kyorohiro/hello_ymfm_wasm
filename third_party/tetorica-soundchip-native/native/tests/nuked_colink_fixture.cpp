// Original link/isolation/thread-construction test. No audio device or assets.
// Copyright 2026 Tetorica contributors. BSD-3-Clause; see LICENSE.
#include <tetorica/nuked_ym2612.hpp>
#include <tetorica/ym2612.hpp>
#include <tetorica/segapsg.hpp>
#include <array>
#include <atomic>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <thread>

int main() {
    // The first construction is deliberately concurrent. All workers own their
    // own raw and Native handles; no test shares a handle between threads.
    std::atomic<unsigned> ready{0};
    std::atomic<bool> start{false};
    std::array<std::array<float, 128>, 8> pcm{};
    std::array<std::thread, 8> workers;
    for (unsigned id = 0; id < workers.size(); ++id) workers[id] = std::thread([&, id] {
        ++ready;
        while (!start.load()) std::this_thread::yield();
        void *raw = tetorica_nuked_create();
        void *native = native_nuked_ym2612_create(48000);
        assert(raw && native);
        tetorica_nuked_write(raw, 0, 0xb6);
        tetorica_nuked_write(raw, 1, 0xc0);
        tetorica_nuked_write(raw, 0, 0x2a);
        tetorica_nuked_write(raw, 1, 220);
        tetorica_nuked_write(raw, 0, 0x2b);
        tetorica_nuked_write(raw, 1, 128);
        std::array<float, 128> right{};
        tetorica_nuked_generate(raw, pcm[id].data(), right.data(), 128);
        for (unsigned i = 0; i < right.size(); ++i) {
            assert(std::isfinite(pcm[id][i]) && pcm[id][i] == right[i]);
            float l, r;
            native_nuked_ym2612_sample(native, &l, &r);
            assert(std::isfinite(l) && std::isfinite(r));
        }
        native_nuked_ym2612_destroy(native);
        tetorica_nuked_destroy(raw);
    });
    while (ready.load() != workers.size()) std::this_thread::yield();
    start = true;
    for (auto &worker : workers) worker.join();
    double energy = 0;
    for (unsigned id = 0; id < pcm.size(); ++id)
        for (unsigned i = 0; i < pcm[id].size(); ++i) {
            assert(pcm[id][i] == pcm[0][i]); energy += std::abs(pcm[id][i]);
        }
    assert(energy > 1);

    void *regular = native_ym2612_create(48000), *regular_ref = native_ym2612_create(48000);
    void *nuked = native_nuked_ym2612_create(48000), *psg = native_game_gear_create(48000);
    assert(regular && regular_ref && nuked && psg);
    for (void *h : {regular, regular_ref}) {
        native_ym2612_write(h, 1, 0xb6, 0xc0);
        native_ym2612_write(h, 0, 0x2a, 220);
        native_ym2612_write(h, 0, 0x2b, 128);
    }
    native_game_gear_write(psg, 0x84); native_game_gear_write(psg, 0x20);
    native_game_gear_write(psg, 0x94);
    double psg_energy = 0, regular_energy = 0;
    for (unsigned i = 0; i < 8192; ++i) {
        native_nuked_ym2612_write(nuked, 0, 0x2a, uint8_t(i));
        native_nuked_ym2612_write(nuked, 0, 0x2b, 128);
        if (i == 123) native_nuked_ym2612_reset(nuked);
        if (i == 4095) native_nuked_ym2612_stop(nuked);
        float l, r, a, b, nl, nr, pl, pr;
        native_ym2612_sample(regular, &l, &r); native_ym2612_sample(regular_ref, &a, &b);
        native_nuked_ym2612_sample(nuked, &nl, &nr); native_game_gear_sample(psg, &pl, &pr);
        assert(l == a && r == b && std::isfinite(nl) && std::isfinite(nr));
        regular_energy += std::abs(l) + std::abs(r); psg_energy += std::abs(pl) + std::abs(pr);
    }
    assert(regular_energy > 1 && psg_energy > 1);
    native_ym2612_destroy(regular); native_ym2612_destroy(regular_ref);
    native_nuked_ym2612_destroy(nuked); native_game_gear_destroy(psg);
    std::puts("Nuked cold concurrent construction, independent handles and co-link with ymfm/PSG passed");
}
