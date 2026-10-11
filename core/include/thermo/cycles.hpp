#pragma once

#include <map>
#include <string>
#include <vector>

#include "thermo/fluid.hpp"
#include "thermo/types.hpp"

namespace thermo {

struct CycleState {
    std::string id;     // short label shown on the chart, e.g. "1", "2s", "f"
    std::string label;  // description, e.g. "Compressor suction"
    State state;
    double flow = 1.0;  // mass flow relative to the reference stream
};

struct CycleSegment {
    std::string from, to;  // CycleState ids
    std::string component; // e.g. "Compressor", "Recuperator (hot)"
    std::string kind;      // compressor|expander|valve|hx|heater|cooler|separator|mixer|pump|turbine
    Curve path;
};

struct Metric {
    std::string key;
    std::string label;
    std::string quantity;  // unit family used by the UI: temperature, pressure, specific_energy, ...
    std::string group;     // performance | exergy | design
    double value = NaN;
};

// Counter-flow heat exchanger temperature profile for a T-Q diagram.
struct ExchangerProfile {
    std::string name;
    std::vector<double> q;      // cumulative duty per kg of reference flow [J/kg], from hot inlet end
    std::vector<double> Thot;   // [K]
    std::vector<double> Tcold;  // [K]
    double minApproach = NaN;   // [K]
};

struct CycleResult {
    bool ok = false;
    std::string error;
    std::vector<CycleState> states;
    std::vector<CycleSegment> segments;
    std::vector<Metric> metrics;
    std::vector<ExchangerProfile> exchangers;
    std::vector<std::string> warnings;
};

using CycleParams = std::map<std::string, double>;

// Solve a named cycle. Parameters are SI; missing parameters fall back to defaults in cycles.cpp.
CycleResult solveCycle(const std::string& id, Fluid& fluid, const CycleParams& params);

std::vector<std::string> cycleIds();

}  // namespace thermo
