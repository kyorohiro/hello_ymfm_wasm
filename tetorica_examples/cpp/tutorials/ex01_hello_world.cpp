/**
 * It is a minimal setup check.
 */
#include <iostream>
#include "ymfm.h"
#include "ymfm_opn.h"

int main()
{
    std::cout << "ymfm loaded" << std::endl;
    std::cout << "ACCESS_CLASSES = "
              << ymfm::ACCESS_CLASSES
              << std::endl;

    return 0;
}
/*
From the repository root:
% em++ -std=c++14 \
  -Isrc \
  tetorica_examples/cpp/tutorials/ex01_hello_world.cpp \
  src/ymfm_adpcm.cpp \
  src/ymfm_misc.cpp \
  src/ymfm_opl.cpp \
  src/ymfm_opm.cpp \
  src/ymfm_opn.cpp \
  src/ymfm_opq.cpp \
  src/ymfm_opz.cpp \
  src/ymfm_pcm.cpp \
  src/ymfm_ssg.cpp \
  -o test.js
*/