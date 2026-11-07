// SPDX-License-Identifier: BSD-3-Clause
// Compile upstream's C99 hardware/system headers without source adaptations.
// The existing marked SID implementation is linked from sid_rsid_chip.cpp.
#include "../../third_party/chips-m6581/m6581.h"
#define CHIPS_IMPL
#include "../../third_party/chips-c64/upstream/chips/chips_common.h"
#include "../../third_party/chips-m6502/upstream/m6502.h"
#include "../../third_party/chips-c64/upstream/chips/m6526.h"
#include "../../third_party/chips-c64/upstream/chips/m6569.h"
#include "../../third_party/chips-c64/upstream/chips/kbd.h"
#include "../../third_party/chips-c64/upstream/chips/mem.h"
#include "../../third_party/chips-c64/upstream/chips/clk.h"
#include "../../third_party/chips-c64/upstream/systems/c1530.h"
#include "../../third_party/chips-c64/upstream/chips/m6522.h"
#include "../../third_party/chips-c64/upstream/systems/c1541.h"
#include "../../third_party/chips-c64/upstream/systems/c64.h"
uint64_t tetorica_rsid_machine_tick(c64_t* machine, uint64_t pins) { return _c64_tick(machine, pins); }
