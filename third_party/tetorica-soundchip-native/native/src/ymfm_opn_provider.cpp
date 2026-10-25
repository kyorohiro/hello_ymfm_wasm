// Native provider for the adapters' extern-template declarations. Keep these
// definitions in the provider translation unit: optimized GCC/MSVC builds may
// inline the upstream uses without otherwise emitting callable definitions.
// The pinned upstream source remains unchanged.
#include "../../vendor/ymfm/ymfm_opn.cpp"

namespace ymfm {
template class fm_engine_base<opn_registers>;
template class fm_channel<opn_registers>;
template class fm_operator<opn_registers>;
template class fm_engine_base<opna_registers>;
template class fm_channel<opna_registers>;
template class fm_operator<opna_registers>;
}
