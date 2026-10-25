// Explicitly provide the templates used by Native OPM adapters independently
// of whether the optimized upstream generator inlines its own calls.
#include "../../vendor/ymfm/ymfm_opm.cpp"

namespace ymfm {
template class fm_engine_base<opm_registers>;
template class fm_channel<opm_registers>;
template class fm_operator<opm_registers>;
}
