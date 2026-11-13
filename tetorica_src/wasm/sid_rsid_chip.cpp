// SPDX-License-Identifier: BSD-3-Clause
// Reuse the existing SID adaptation, including its C++ thread-safe shared table.
#define CHIPS_IMPL
#include "../../third_party/chips-m6581/m6581.h"
extern "C" int tetorica_rsid_manual_write(m6581_t* sid, unsigned reg, unsigned value) {
    if (reg > 24 || value > 255) return 0;
    uint64_t pins = M6581_CS | reg; M6581_SET_DATA(pins, value);
    _m6581_write(sid, pins); return 1;
}
