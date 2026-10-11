#pragma once

#include <memory>
#include <string>
#include <vector>

#include "thermo/types.hpp"

namespace CoolProp {
class AbstractState;
}

namespace thermo {

struct FluidInfo {
    std::string name;
    std::string aliases;   // comma separated
    std::string cas;
    std::string ashrae34;  // safety class, e.g. "A1", empty if unknown
    std::string formula;
    double molarMass = NaN;  // kg/mol
    double Tcrit = NaN, pcrit = NaN, rhocrit = NaN, hcrit = NaN, scrit = NaN;
    double Ttriple = NaN, ptriple = NaN;
    double Tmin = NaN, Tmax = NaN, pmax = NaN;
    double acentric = NaN;
    double gwp100 = NaN, odp = NaN;
    bool hasMeltingLine = false;
};

// A pure fluid backed by CoolProp's Helmholtz-energy (HEOS) backend.
// Not thread safe: each instance owns a single mutable AbstractState.
class Fluid {
public:
    explicit Fluid(const std::string& name);
    ~Fluid();
    Fluid(const Fluid&) = delete;
    Fluid& operator=(const Fluid&) = delete;

    [[nodiscard]] const FluidInfo& info() const { return info_; }

    // Flash from any two independent properties. Returns false (never throws) on failure.
    bool update(Prop a, double va, Prop b, double vb);
    // Same, restricted to a known single phase to avoid phase-determination cost and ambiguity
    // right at saturation. Pass Phase::Unknown to let CoolProp decide.
    bool update(Prop a, double va, Prop b, double vb, Phase imposed);
    bool saturated(Prop given, double value, double Q);

    // Read the current state (after a successful update).
    [[nodiscard]] Point point() const;
    [[nodiscard]] State state() const;

    // Convenience: flash and read in one call. Invalid result on failure.
    Point pointAt(Prop a, double va, Prop b, double vb, Phase imposed = Phase::Unknown);
    State stateAt(Prop a, double va, Prop b, double vb, Phase imposed = Phase::Unknown);

    [[nodiscard]] double meltingTemperature(double p) const;  // NaN when unavailable
    [[nodiscard]] const std::string& lastError() const { return lastError_; }

    CoolProp::AbstractState& backend() { return *as_; }

private:
    std::unique_ptr<CoolProp::AbstractState> as_;
    FluidInfo info_;
    std::string lastError_;
};

// Cached fluid instances, keyed by CoolProp name or alias.
Fluid& getFluid(const std::string& name);
std::vector<FluidInfo> listFluids();

const char* phaseName(Phase phase);

}  // namespace thermo
