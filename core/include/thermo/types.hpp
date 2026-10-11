#pragma once

#include <cstddef>
#include <limits>
#include <string>
#include <vector>

namespace thermo {

inline constexpr double NaN = std::numeric_limits<double>::quiet_NaN();

// Thermodynamic coordinates the library understands. All values are SI and mass based.
enum class Prop : int {
    T = 0,  // temperature            [K]
    P = 1,  // pressure               [Pa]
    D = 2,  // density                [kg/m3]
    V = 3,  // specific volume        [m3/kg]
    H = 4,  // specific enthalpy      [J/kg]
    S = 5,  // specific entropy       [J/kg/K]
    U = 6,  // specific int. energy   [J/kg]
    Q = 7,  // vapour quality         [-], NaN outside the two-phase region
};

enum class Phase : int {
    Liquid = 0,
    Gas = 1,
    TwoPhase = 2,
    Supercritical = 3,
    SupercriticalGas = 4,
    SupercriticalLiquid = 5,
    CriticalPoint = 6,
    Unknown = 7,
};

// Lightweight point used for curves: the coordinates any chart axis may need.
struct Point {
    double T = NaN, p = NaN, rho = NaN, h = NaN, s = NaN, Q = NaN;

    [[nodiscard]] double get(Prop prop) const;
    [[nodiscard]] bool valid() const { return T == T && p == p && h == h && s == s && rho == rho; }
};

// Full state with derived and transport properties.
struct State {
    bool valid = false;
    Phase phase = Phase::Unknown;
    double T = NaN, p = NaN, rho = NaN, h = NaN, s = NaN, u = NaN, Q = NaN;
    double cp = NaN, cv = NaN, w = NaN;       // heat capacities [J/kg/K], speed of sound [m/s]
    double mu = NaN, k = NaN, Pr = NaN;       // viscosity [Pa s], conductivity [W/m/K], Prandtl [-]
    double Z = NaN;                           // compressibility factor [-]
    double beta = NaN;                        // isobaric expansion coefficient [1/K]
    double kappaT = NaN;                      // isothermal compressibility [1/Pa]
    double muJT = NaN;                        // Joule-Thomson coefficient [K/Pa]
    double sigma = NaN;                       // surface tension [N/m] (two-phase only)

    [[nodiscard]] Point point() const { return {T, p, rho, h, s, Q}; }
};

// Polyline in thermodynamic space, stored flat as [T, p, rho, h, s, Q] per vertex so it can be
// handed to JavaScript as a single Float64Array. A row of NaNs marks a break between segments.
struct Curve {
    static constexpr std::size_t kStride = 6;
    std::vector<double> data;

    [[nodiscard]] std::size_t size() const { return data.size() / kStride; }
    [[nodiscard]] bool empty() const { return data.empty(); }
    void push(const Point& pt) { data.insert(data.end(), {pt.T, pt.p, pt.rho, pt.h, pt.s, pt.Q}); }
    // Break rows are identified by a NaN temperature (Q is legitimately NaN for single-phase points).
    [[nodiscard]] bool endsWithBreak() const { return !data.empty() && !(data[data.size() - kStride] == data[data.size() - kStride]); }
    void breakLine() {
        if (!data.empty() && !endsWithBreak()) data.insert(data.end(), kStride, NaN);
    }
    void append(const Curve& other) { data.insert(data.end(), other.data.begin(), other.data.end()); }
    [[nodiscard]] Point at(std::size_t i) const {
        const double* d = &data[i * kStride];
        return {d[0], d[1], d[2], d[3], d[4], d[5]};
    }
};

// Chart axes, used to drive adaptive refinement in display space and to bound sampling domains.
struct Viewport {
    Prop x = Prop::S, y = Prop::T;
    bool xLog = false, yLog = false;
    double xMin = 0, xMax = 1, yMin = 0, yMax = 1;
    double tolerance = 1.5e-3;  // max chord deviation, fraction of the viewport
};

}  // namespace thermo
