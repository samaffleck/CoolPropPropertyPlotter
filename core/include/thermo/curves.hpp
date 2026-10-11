#pragma once

#include <functional>
#include <optional>

#include "thermo/fluid.hpp"
#include "thermo/types.hpp"

namespace thermo {

struct SaturationCurves {
    // Liquid branch from the triple point up to the critical point, then the vapour branch back
    // down: one closed polyline, convenient for drawing and filling the dome.
    Curve dome;
    std::size_t criticalIndex = 0;  // vertex index of the critical point within `dome`
    // Melting line (p, T) from the triple point upward, empty when the fluid has none.
    Curve melting;
};

SaturationCurves saturationCurves(Fluid& fluid, int pointsPerBranch = 160);

// Temperature and pressure ranges spanned by a viewport (clamped to the fluid's valid range).
// Computing it costs a few dozen flashes, so compute once per chart and reuse for every isoline.
struct Domain {
    double Tmin = NaN, Tmax = NaN, pmin = NaN, pmax = NaN;
};
Domain viewportDomain(Fluid& fluid, const Viewport& vp);

// An isoline of `prop` held at `value`, sampled adaptively so it is smooth in the given viewport.
Curve isoline(Fluid& fluid, Prop prop, double value, const Viewport& vp, const Domain& domain);
Curve isoline(Fluid& fluid, Prop prop, double value, const Viewport& vp);

// Adaptive 1-D sampler. `eval(t)` returns a point or nullopt where the state does not exist.
// The interval is refined wherever the curve bends in display space or changes phase.
using Evaluator = std::function<std::optional<Point>(double)>;
Curve sampleAdaptive(const Evaluator& eval, double t0, double t1, const Viewport& vp, int initialSegments = 48,
                     int maxDepth = 10);

}  // namespace thermo
