// Native OPL/OPLL adapters declare these templates extern. Supply complete
// definitions alongside the unchanged provider rather than relying on the
// provider's incidental, optimizer-dependent implicit instantiations.
#include "../../vendor/ymfm/ymfm_opl.cpp"

namespace ymfm {
template class fm_engine_base<opll_registers>;
template class fm_channel<opll_registers>;
template class fm_operator<opll_registers>;
template class fm_engine_base<opl_registers>;
template class fm_channel<opl_registers>;
template class fm_operator<opl_registers>;
template class fm_engine_base<opl2_registers>;
template class fm_channel<opl2_registers>;
template class fm_operator<opl2_registers>;
template class fm_engine_base<opl3_registers>;
template class fm_channel<opl3_registers>;
template class fm_operator<opl3_registers>;
}
