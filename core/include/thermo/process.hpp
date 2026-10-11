#pragma once

#include <string>

#include "thermo/fluid.hpp"
#include "thermo/types.hpp"

namespace thermo {

enum class ProcessKind : int {
    Isobaric = 0,     // heat exchange at constant pressure (heater, cooler, condenser, evaporator)
    Isothermal = 1,   // reversible isothermal compression/expansion
    Isentropic = 2,   // reversible adiabatic compression/expansion
    Isenthalpic = 3,  // throttling: JT valve, expansion valve
    Isochoric = 4,    // constant volume heating/cooling
    Compression = 5,  // adiabatic compressor/pump with isentropic efficiency, target pressure
    Expansion = 6,    // adiabatic turbine/expander with isentropic efficiency, target pressure
};

struct ProcessSpec {
    ProcessKind kind = ProcessKind::Isobaric;
    Prop target = Prop::T;     // property that defines the end of the process
    double value = NaN;        // target value (SI)
    double efficiency = 1.0;   // isentropic efficiency for Compression / Expansion
};

// Steady-flow energy balance per unit mass, sign convention: heat into the fluid and work done
// BY the fluid are positive (q - w = h2 - h1).
struct ProcessResult {
    bool ok = false;
    std::string error;
    State end;
    Curve path;
    double q = NaN;  // J/kg
    double w = NaN;  // J/kg
};

ProcessResult runProcess(Fluid& fluid, const State& start, const ProcessSpec& spec, int pathPoints = 64);

// Path helpers, also used by the cycle solvers. Each returns a polyline from a to b.
Curve pathIsobaric(Fluid& f, const State& a, const State& b, int n = 48);
Curve pathIsenthalpic(Fluid& f, const State& a, const State& b, int n = 32);
Curve pathIsentropic(Fluid& f, const State& a, const State& b, int n = 32);
Curve pathIsothermal(Fluid& f, const State& a, const State& b, int n = 48);
Curve pathIsochoric(Fluid& f, const State& a, const State& b, int n = 48);
// Non-ideal adiabatic machine: enthalpy varies linearly with ln(p) between the end states.
Curve pathPolytropic(Fluid& f, const State& a, const State& b, int n = 32);
// Constant-pressure path through the two-phase region at fixed T (separator legs, mixing).
Curve pathStraight(const State& a, const State& b);

}  // namespace thermo
