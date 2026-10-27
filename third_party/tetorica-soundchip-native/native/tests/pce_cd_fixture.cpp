// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro
// Public C headers must co-link with the existing C++ HuC6280 consumer API.
#include <tetorica/cdda.h>
#include <tetorica/msm5205.h>
#include <tetorica/huc6280.hpp>
#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <memory>
#include <vector>

int main() {
    constexpr uint32_t rate = 48000;
    using Chip = std::unique_ptr<void, void (*)(void *)>;
    Chip psg(native_huc6280_create(rate), native_huc6280_destroy);
    assert(psg);
    std::array<uint8_t, 32> wave{};
    for (unsigned i = 0; i < 32; ++i) wave[i] = uint8_t(i < 16 ? i * 2 : 62 - i * 2);
    native_huc6280_waveform(psg.get(), 0, wave.data());
    native_huc6280_write(psg.get(), 1, 255, -1);
    native_huc6280_write(psg.get(), 5, 255, 0);
    native_huc6280_write(psg.get(), 2, 254, 0);
    native_huc6280_write(psg.get(), 3, 0, 0);
    native_huc6280_write(psg.get(), 4, 152, 0);
    // Host vectors own the source bytes and outlive all rendering.
    std::vector<uint8_t> pcm(4410 * 4), encoded(64, 0x17);
    for (unsigned i = 0; i < 4410; ++i) {
        const int16_t value = int16_t(i % 32 < 16 ? 4096 : -4096);
        pcm[i * 4] = uint8_t(value); pcm[i * 4 + 1] = uint8_t(uint16_t(value) >> 8);
        pcm[i * 4 + 2] = uint8_t(-value); pcm[i * 4 + 3] = uint8_t(uint16_t(-value) >> 8);
    }
    cdda_pcm_state cd{};
    msm5205_pcm_state ad{};
    assert(cdda_pcm_init(&cd, rate) && cdda_pcm_prepare(&cd, pcm.data(), uint32_t(pcm.size())));
    assert(msm5205_pcm_init(&ad, rate, 1536000));
    assert(msm5205_pcm_stop(&ad)); // silence the generic raw reset predictor
    assert(msm5205_pcm_prepare(&ad, encoded.data(), uint32_t(encoded.size())));
    assert(cd.pcm == pcm.data() && ad.source == encoded.data());
    assert(cdda_pcm_play(&cd) && msm5205_pcm_play(&ad, 1, 125, 1, 12));
    double psg_peak = 0, cd_peak = 0, ad_peak = 0;
    for (uint32_t frame = 0; frame < 6000; ++frame) {
        if (frame == 1000) assert(cdda_pcm_pause(&cd));
        if (frame == 1500) assert(cdda_pcm_resume(&cd));
        if (frame == 2000) assert(msm5205_pcm_set_muted(&ad, 1));
        if (frame == 2500) assert(msm5205_pcm_set_muted(&ad, 0));
        if (frame == 3000) assert(msm5205_pcm_stop(&ad));
        float pl, pr, cl, cr, al, ar;
        native_huc6280_sample(psg.get(), &pl, &pr);
        assert(cdda_pcm_render(&cd, &cl, &cr, 1));
        assert(msm5205_pcm_render(&ad, &al, &ar, 1));
        psg_peak = std::max(psg_peak, double(std::abs(pl)));
        cd_peak = std::max(cd_peak, double(std::abs(cl)));
        ad_peak = std::max(ad_peak, double(std::abs(al)));
        assert(std::isfinite(pl + cl + al) && std::isfinite(pr + cr + ar));
        assert(al == ar);
        if (frame >= 3000 || (frame >= 2000 && frame < 2500)) assert(al == 0 && ar == 0);
        if (frame >= 1000 && frame < 1500) assert(cl == 0 && cr == 0);
        assert(cd.output_frames == frame + 1 && ad.output_frames == frame + 1);
    }
    assert(psg_peak > 0.001 && cd_peak > 0.01 && ad_peak > 0.01);
    assert(cd.state == CDDA_PCM_ENDED && cd.frame == 4410 && cd.phase == 0);
    assert(ad.state == MSM5205_PCM_READY && ad.source == encoded.data());
    native_huc6280_stop(psg.get());
    assert(cdda_pcm_stop(&cd) && msm5205_pcm_stop(&ad));
    for (unsigned i = 0; i < 32; ++i) {
        float pl, pr, cl, cr, al, ar;
        native_huc6280_sample(psg.get(), &pl, &pr);
        assert(cdda_pcm_render(&cd, &cl, &cr, 1));
        assert(msm5205_pcm_render(&ad, &al, &ar, 1));
        assert(cl == 0 && cr == 0 && al == 0 && ar == 0);
        if (i > 2) assert(pl == 0 && pr == 0);
    }
    std::cout << "C++14 HuC6280 + MSM5205 + CD-DA public consumers, independent state/shared clock: passed\n";
}
