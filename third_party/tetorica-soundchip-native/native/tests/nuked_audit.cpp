// Copyright 2026 Tetorica contributors. BSD-3-Clause; see LICENSE.
// libstdc++'s <stdlib.h> forwards std::malloc/free into the global namespace.
// Parse it before the unchanged wrapper defines its test allocation macros,
// otherwise those macros also rewrite the standard-library using declarations.
// This translation unit belongs only to the allocation-audited test fixture.
#include <stdlib.h>
#include "../reference/tauri/native_genesis_nuked.cpp"
