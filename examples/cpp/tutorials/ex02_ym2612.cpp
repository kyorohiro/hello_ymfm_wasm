/**
 * It is a minimal setup check.
 */
#include <iostream>
#include "ymfm.h"
#include "ymfm_opn.h"

int main()
{
    ymfm::ymfm_interface intf;
    ymfm::ym2612 chip(intf);

    chip.reset();

    constexpr uint32_t clock = 7670454;

    std::cout << "YM2612 created" << std::endl;
    std::cout << "sample rate = "
              << chip.sample_rate(clock)
              << std::endl;

    return 0;
}

/*
From the repository root:
% em++ -std=c++14 \
  -Isrc \
  examples/cpp/tutorials/ex02_ym2612.cpp \
  src/ymfm_opn.cpp \
  src/ymfm_adpcm.cpp \
  src/ymfm_ssg.cpp \
  src/ymfm_misc.cpp \
  -o test.js
*/