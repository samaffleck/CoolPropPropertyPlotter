#include "thermo/process.hpp"

#include <cmath>
#include <functional>
#include <optional>

namespace thermo {

namespace {

double holdValue(const State& s, Prop prop) {
    switch (prop) {
        case Prop::T: return s.T;
        case Prop::P: return s.p;
        case Prop::D: return s.rho;
        case Prop::V: return 1.0 / s.rho;
        case Prop::H: return s.h;
        case Prop::S: return s.s;
        case Prop::U: return s.u;
        case Prop::Q: return s.Q;
    }
    return NaN;
}

// Sweep a parameter from a to b (linearly, or in log space), flashing with a held property.
Curve sweep(const State& a, const State& b, int n, const std::function<std::optional<Point>(double)>& at, double t0,
            double t1, bool log) {
    Curve c;
    c.push(a.point());
    const double l0 = log ? std::log(t0) : t0, l1 = log ? std::log(t1) : t1;
    for (int i = 1; i < n; ++i) {
        const double u = static_cast<double>(i) / n;
        const double l = l0 + u * (l1 - l0);
        if (auto pt = at(log ? std::exp(l) : l)) c.push(*pt);
    }
    c.push(b.point());
    return c;
}

std::optional<Point> flashPoint(Fluid& f, Prop a, double va, Prop b, double vb) {
    if (!f.update(a, va, b, vb)) return std::nullopt;
    return f.point();
}

}  // namespace

Curve pathIsobaric(Fluid& f, const State& a, const State& b, int n) {
    const double p = a.p;
    return sweep(a, b, n, [&](double h) { return flashPoint(f, Prop::P, p, Prop::H, h); }, a.h, b.h, false);
}

Curve pathIsenthalpic(Fluid& f, const State& a, const State& b, int n) {
    const double h = a.h;
    return sweep(a, b, n, [&](double p) { return flashPoint(f, Prop::H, h, Prop::P, p); }, a.p, b.p, true);
}

Curve pathIsentropic(Fluid& f, const State& a, const State& b, int n) {
    const double s = a.s;
    return sweep(a, b, n, [&](double p) { return flashPoint(f, Prop::S, s, Prop::P, p); }, a.p, b.p, true);
}

Curve pathIsothermal(Fluid& f, const State& a, const State& b, int n) {
    const double T = a.T;
    return sweep(a, b, n, [&](double s) { return flashPoint(f, Prop::T, T, Prop::S, s); }, a.s, b.s, false);
}

Curve pathIsochoric(Fluid& f, const State& a, const State& b, int n) {
    const double rho = a.rho;
    return sweep(a, b, n, [&](double T) { return flashPoint(f, Prop::D, rho, Prop::T, T); }, a.T, b.T, false);
}

Curve pathPolytropic(Fluid& f, const State& a, const State& b, int n) {
    Curve c;
    c.push(a.point());
    const double l0 = std::log(a.p), l1 = std::log(b.p);
    for (int i = 1; i < n; ++i) {
        const double u = static_cast<double>(i) / n;
        if (auto pt = flashPoint(f, Prop::P, std::exp(l0 + u * (l1 - l0)), Prop::H, a.h + u * (b.h - a.h))) c.push(*pt);
    }
    c.push(b.point());
    return c;
}

Curve pathStraight(const State& a, const State& b) {
    Curve c;
    c.push(a.point());
    c.push(b.point());
    return c;
}

ProcessResult runProcess(Fluid& f, const State& start, const ProcessSpec& spec, int n) {
    ProcessResult r;
    if (!start.valid) {
        r.error = "Start state is not defined";
        return r;
    }
    const auto fail = [&](const std::string& msg) {
        r.ok = false;
        r.error = msg + (f.lastError().empty() ? "" : ": " + f.lastError());
        return r;
    };

    Prop hold = Prop::P;
    switch (spec.kind) {
        case ProcessKind::Isobaric: hold = Prop::P; break;
        case ProcessKind::Isothermal: hold = Prop::T; break;
        case ProcessKind::Isentropic: hold = Prop::S; break;
        case ProcessKind::Isenthalpic: hold = Prop::H; break;
        case ProcessKind::Isochoric: hold = Prop::D; break;
        case ProcessKind::Compression:
        case ProcessKind::Expansion: {
            if (spec.target != Prop::P) return fail("Compressors and expanders are specified by outlet pressure");
            const double eta = spec.efficiency;
            if (!(eta > 0 && eta <= 1)) return fail("Isentropic efficiency must be in (0, 1]");
            const State iso = f.stateAt(Prop::P, spec.value, Prop::S, start.s);
            if (!iso.valid) return fail("Could not find isentropic outlet state");
            const bool compress = spec.kind == ProcessKind::Compression;
            if (compress && spec.value < start.p) return fail("Compression outlet pressure is below inlet pressure");
            if (!compress && spec.value > start.p) return fail("Expansion outlet pressure is above inlet pressure");
            const double h2 = compress ? start.h + (iso.h - start.h) / eta : start.h - eta * (start.h - iso.h);
            r.end = f.stateAt(Prop::P, spec.value, Prop::H, h2);
            if (!r.end.valid) return fail("Could not find outlet state");
            r.path = eta >= 1 ? pathIsentropic(f, start, r.end, n / 2) : pathPolytropic(f, start, r.end, n / 2);
            r.q = 0;
            r.w = start.h - r.end.h;
            r.ok = true;
            return r;
        }
    }

    if (spec.target == hold) return fail("Target property is held constant by this process");
    const double hv = holdValue(start, hold);
    r.end = f.stateAt(hold, hv, spec.target, spec.value);
    if (!r.end.valid) return fail("No state satisfies the target");

    switch (spec.kind) {
        case ProcessKind::Isobaric:
            r.path = pathIsobaric(f, start, r.end, n);
            r.q = r.end.h - start.h;
            r.w = 0;
            break;
        case ProcessKind::Isothermal:
            r.path = pathIsothermal(f, start, r.end, n);
            r.q = start.T * (r.end.s - start.s);
            r.w = r.q - (r.end.h - start.h);
            break;
        case ProcessKind::Isentropic:
            r.path = pathIsentropic(f, start, r.end, n / 2);
            r.q = 0;
            r.w = start.h - r.end.h;
            break;
        case ProcessKind::Isenthalpic:
            r.path = pathIsenthalpic(f, start, r.end, n / 2);
            r.q = 0;
            r.w = 0;
            break;
        case ProcessKind::Isochoric:
            r.path = pathIsochoric(f, start, r.end, n);
            // Reversible steady flow: w = -integral(v dp) = -v (p2 - p1).
            r.w = -(r.end.p - start.p) / start.rho;
            r.q = (r.end.h - start.h) + r.w;
            break;
        default: break;
    }
    r.ok = true;
    return r;
}

}  // namespace thermo
