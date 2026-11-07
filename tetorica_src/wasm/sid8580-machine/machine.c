// SPDX-License-Identifier: BSD-3-Clause
// Original pinned C64/CPU/CIA/VIC, with the new compatibility SID endpoint.
#include "sid_endpoint.h"
#define CHIPS_IMPL
#include "../../../third_party/chips-c64/upstream/chips/chips_common.h"
#include "../../../third_party/chips-m6502/upstream/m6502.h"
#include "../../../third_party/chips-c64/upstream/chips/m6526.h"
#include "../../../third_party/chips-c64/upstream/chips/m6569.h"
#include "../../../third_party/chips-c64/upstream/chips/kbd.h"
#include "../../../third_party/chips-c64/upstream/chips/mem.h"
#include "../../../third_party/chips-c64/upstream/chips/clk.h"
#include "../../../third_party/chips-c64/upstream/systems/c1530.h"
#include "../../../third_party/chips-c64/upstream/chips/m6522.h"
#include "../../../third_party/chips-c64/upstream/systems/c1541.h"
#include "../../../third_party/chips-c64/upstream/systems/c64.h"
uint64_t tetorica_sid8580_machine_tick(c64_t* machine,uint64_t pins){return _c64_tick(machine,pins);}
