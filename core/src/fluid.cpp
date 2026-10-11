#include "thermo/fluid.hpp"

#include <cmath>
#include <map>
#include <sstream>

#include "CoolProp/AbstractState.h"
#include "CoolProp/CoolProp.h"

namespace thermo {

double Point::get(Prop prop) const {
    switch (prop) {
        case Prop::T: return T;
        case Prop::P: return p;
        case Prop::D: return rho;
        case Prop::V: return 1.0 / rho;
        case Prop::H: return h;
        case Prop::S: return s;
        case Prop::Q: return Q;
        case Prop::U: return NaN;  // not carried on curve points
    }
    return NaN;
}

namespace {

CoolProp::parameters toParam(Prop p) {
    switch (p) {
        case Prop::T: return CoolProp::iT;
        case Prop::P: return CoolProp::iP;
        case Prop::D:
        case Prop::V: return CoolProp::iDmass;
        case Prop::H: return CoolProp::iHmass;
        case Prop::S: return CoolProp::iSmass;
        case Prop::U: return CoolProp::iUmass;
        case Prop::Q: return CoolProp::iQ;
    }
    return CoolProp::iT;
}

CoolProp::phases toCoolPropPhase(Phase phase) {
    switch (phase) {
        case Phase::Liquid: return CoolProp::iphase_liquid;
        case Phase::Gas: return CoolProp::iphase_gas;
        case Phase::TwoPhase: return CoolProp::iphase_twophase;
        case Phase::Supercritical: return CoolProp::iphase_supercritical;
        case Phase::SupercriticalGas: return CoolProp::iphase_supercritical_gas;
        case Phase::SupercriticalLiquid: return CoolProp::iphase_supercritical_liquid;
        default: return CoolProp::iphase_not_imposed;
    }
}

Phase fromCoolPropPhase(CoolProp::phases phase) {
    switch (phase) {
        case CoolProp::iphase_liquid: return Phase::Liquid;
        case CoolProp::iphase_gas: return Phase::Gas;
        case CoolProp::iphase_twophase: return Phase::TwoPhase;
        case CoolProp::iphase_supercritical: return Phase::Supercritical;
        case CoolProp::iphase_supercritical_gas: return Phase::SupercriticalGas;
        case CoolProp::iphase_supercritical_liquid: return Phase::SupercriticalLiquid;
        case CoolProp::iphase_critical_point: return Phase::CriticalPoint;
        default: return Phase::Unknown;
    }
}

template <class F>
double tryGet(F&& f) {
    try {
        const double v = f();
        return std::isfinite(v) ? v : NaN;
    } catch (...) {
        return NaN;
    }
}

std::string fluidParam(const std::string& name, const char* key) {
    try {
        return CoolProp::get_fluid_param_string(name, key);
    } catch (...) {
        return {};
    }
}

}  // namespace

Fluid::Fluid(const std::string& name) {
    as_.reset(CoolProp::AbstractState::factory("HEOS", name));
    auto& as = *as_;
    info_.name = as.fluid_names().at(0);
    info_.aliases = fluidParam(info_.name, "aliases");
    info_.cas = fluidParam(info_.name, "CAS");
    info_.ashrae34 = fluidParam(info_.name, "ASHRAE34");
    if (info_.ashrae34 == "UNKNOWN") info_.ashrae34.clear();
    info_.formula = fluidParam(info_.name, "formula");
    info_.molarMass = tryGet([&] { return as.molar_mass(); });
    info_.Tcrit = tryGet([&] { return as.T_critical(); });
    info_.pcrit = tryGet([&] { return as.p_critical(); });
    info_.rhocrit = tryGet([&] { return as.rhomass_critical(); });
    info_.Ttriple = tryGet([&] { return as.Ttriple(); });
    info_.Tmin = tryGet([&] { return as.Tmin(); });
    info_.Tmax = tryGet([&] { return as.Tmax(); });
    info_.pmax = tryGet([&] { return as.pmax(); });
    info_.acentric = tryGet([&] { return as.acentric_factor(); });
    info_.gwp100 = tryGet([&] { return as.keyed_output(CoolProp::iGWP100); });
    info_.odp = tryGet([&] { return as.keyed_output(CoolProp::iODP); });
    info_.hasMeltingLine = as.has_melting_line();
    if (!(info_.gwp100 >= 0)) info_.gwp100 = NaN;
    if (!(info_.odp >= 0)) info_.odp = NaN;

    if (update(Prop::D, info_.rhocrit, Prop::T, info_.Tcrit)) {
        info_.hcrit = as.hmass();
        info_.scrit = as.smass();
    }
    const double Tt = std::isfinite(info_.Ttriple) ? info_.Ttriple : info_.Tmin;
    if (saturated(Prop::T, Tt, 0)) info_.ptriple = as.p();
}

Fluid::~Fluid() = default;

bool Fluid::update(Prop a, double va, Prop b, double vb) { return update(a, va, b, vb, Phase::Unknown); }

bool Fluid::update(Prop a, double va, Prop b, double vb, Phase imposed) {
    if (!std::isfinite(va) || !std::isfinite(vb)) {
        lastError_ = "non-finite input";
        return false;
    }
    if (a == Prop::V) va = 1.0 / va;
    if (b == Prop::V) vb = 1.0 / vb;
    double v1 = 0, v2 = 0;
    const auto pair = CoolProp::generate_update_pair(toParam(a), va, toParam(b), vb, v1, v2);
    if (pair == CoolProp::INPUT_PAIR_INVALID) {
        lastError_ = "unsupported input pair";
        return false;
    }
    auto& as = *as_;
    const bool impose = imposed != Phase::Unknown;
    try {
        if (impose) as.specify_phase(toCoolPropPhase(imposed));
        as.update(pair, v1, v2);
        if (impose) as.unspecify_phase();
    } catch (const std::exception& e) {
        if (impose) as.unspecify_phase();
        lastError_ = e.what();
        return false;
    }
    if (!std::isfinite(as.T()) || !std::isfinite(as.rhomass())) {
        lastError_ = "solver returned non-finite state";
        return false;
    }
    return true;
}

bool Fluid::saturated(Prop given, double value, double Q) { return update(given, value, Prop::Q, Q); }

Point Fluid::point() const {
    auto& as = *as_;
    Point pt;
    pt.T = as.T();
    pt.p = as.p();
    pt.rho = as.rhomass();
    pt.h = tryGet([&] { return as.hmass(); });
    pt.s = tryGet([&] { return as.smass(); });
    pt.Q = as.phase() == CoolProp::iphase_twophase ? as.Q() : NaN;
    return pt;
}

State Fluid::state() const {
    auto& as = *as_;
    State st;
    st.valid = true;
    st.phase = fromCoolPropPhase(as.phase());
    st.T = as.T();
    st.p = as.p();
    st.rho = as.rhomass();
    st.h = tryGet([&] { return as.hmass(); });
    st.s = tryGet([&] { return as.smass(); });
    st.u = tryGet([&] { return as.umass(); });
    st.Z = tryGet([&] { return as.compressibility_factor(); });
    if (st.phase == Phase::TwoPhase) {
        st.Q = as.Q();
        st.sigma = tryGet([&] { return as.surface_tension(); });
        // Bulk two-phase cp/cv/w are undefined; transport properties likewise.
        return st;
    }
    st.cp = tryGet([&] { return as.cpmass(); });
    st.cv = tryGet([&] { return as.cvmass(); });
    st.w = tryGet([&] { return as.speed_sound(); });
    st.mu = tryGet([&] { return as.viscosity(); });
    st.k = tryGet([&] { return as.conductivity(); });
    st.Pr = (st.mu == st.mu && st.k == st.k && st.cp == st.cp) ? st.cp * st.mu / st.k : NaN;
    st.beta = tryGet([&] { return as.isobaric_expansion_coefficient(); });
    st.kappaT = tryGet([&] { return as.isothermal_compressibility(); });
    st.muJT = tryGet([&] { return as.first_partial_deriv(CoolProp::iT, CoolProp::iP, CoolProp::iHmass); });
    return st;
}

Point Fluid::pointAt(Prop a, double va, Prop b, double vb, Phase imposed) {
    return update(a, va, b, vb, imposed) ? point() : Point{};
}

State Fluid::stateAt(Prop a, double va, Prop b, double vb, Phase imposed) {
    return update(a, va, b, vb, imposed) ? state() : State{};
}

double Fluid::meltingTemperature(double p) const {
    if (!info_.hasMeltingLine) return NaN;
    return tryGet([&] { return as_->melting_line(CoolProp::iT, CoolProp::iP, p); });
}

Fluid& getFluid(const std::string& name) {
    static std::map<std::string, std::unique_ptr<Fluid>> cache;
    auto it = cache.find(name);
    if (it != cache.end()) return *it->second;
    auto fluid = std::make_unique<Fluid>(name);
    auto& ref = *fluid;
    cache.emplace(name, std::move(fluid));
    return ref;
}

std::vector<FluidInfo> listFluids() {
    std::vector<FluidInfo> out;
    std::stringstream ss(CoolProp::get_global_param_string("FluidsList"));
    std::string name;
    while (std::getline(ss, name, ',')) {
        try {
            out.push_back(getFluid(name).info());
        } catch (...) {
            // Skip fluids whose EOS fails to initialise.
        }
    }
    return out;
}

const char* phaseName(Phase phase) {
    switch (phase) {
        case Phase::Liquid: return "liquid";
        case Phase::Gas: return "gas";
        case Phase::TwoPhase: return "two-phase";
        case Phase::Supercritical: return "supercritical";
        case Phase::SupercriticalGas: return "supercritical gas";
        case Phase::SupercriticalLiquid: return "supercritical liquid";
        case Phase::CriticalPoint: return "critical point";
        default: return "unknown";
    }
}

}  // namespace thermo
