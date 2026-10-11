#include "thermo/curves.hpp"

#include <algorithm>
#include <cmath>

#include "CoolProp/AbstractState.h"

namespace thermo {

namespace {

constexpr double kMinPressure = 1e-3;  // Pa; lower clamp for log-spaced sweeps

struct Sample {
    double t;
    std::optional<Point> pt;
    double x = NaN, y = NaN;  // normalised viewport coordinates
};

class Projector {
public:
    explicit Projector(const Viewport& vp) : vp_(vp) {
        x0_ = axis(vp.xMin, vp.xLog);
        x1_ = axis(vp.xMax, vp.xLog);
        y0_ = axis(vp.yMin, vp.yLog);
        y1_ = axis(vp.yMax, vp.yLog);
    }

    void project(Sample& s) const {
        if (!s.pt) return;
        s.x = (axis(s.pt->get(vp_.x), vp_.xLog) - x0_) / (x1_ - x0_);
        s.y = (axis(s.pt->get(vp_.y), vp_.yLog) - y0_) / (y1_ - y0_);
    }

private:
    static double axis(double v, bool log) {
        if (!log) return v;
        return v > 0 ? std::log10(v) : NaN;
    }
    const Viewport& vp_;
    double x0_, x1_, y0_, y1_;
};

bool usable(const Sample& s) { return s.pt && std::isfinite(s.x) && std::isfinite(s.y); }
bool twoPhase(const Sample& s) { return s.pt && s.pt->Q == s.pt->Q; }

// Bitmask of which viewport edges a point lies beyond (Cohen-Sutherland style).
int outcode(const Sample& s, double margin = 0.05) {
    int code = 0;
    if (s.x < -margin) code |= 1;
    if (s.x > 1 + margin) code |= 2;
    if (s.y < -margin) code |= 4;
    if (s.y > 1 + margin) code |= 8;
    return code;
}

class AdaptiveSampler {
public:
    AdaptiveSampler(const Evaluator& eval, const Viewport& vp, int maxDepth)
        : eval_(eval), proj_(vp), tol_(vp.tolerance), maxDepth_(maxDepth) {}

    Sample sample(double t) const {
        Sample s{t, eval_(t)};
        if (s.pt && !s.pt->valid()) s.pt.reset();
        proj_.project(s);
        return s;
    }

    void refine(const Sample& a, const Sample& b, int depth, std::vector<Sample>& out) const {
        if (depth >= maxDepth_) return;
        const Sample m = sample(0.5 * (a.t + b.t));
        // The midpoint has been paid for either way, so it is always kept.
        if (!needsSplit(a, m, b)) {
            out.push_back(m);
            return;
        }
        refine(a, m, depth + 1, out);
        out.push_back(m);
        refine(m, b, depth + 1, out);
    }

private:
    bool needsSplit(const Sample& a, const Sample& m, const Sample& b) const {
        const bool ua = usable(a), um = usable(m), ub = usable(b);
        if (!ua && !ub) return um;           // a valid island may hide inside
        if (ua != ub || !um) return true;    // locate the edge of the valid region
        if (twoPhase(a) != twoPhase(b)) return true;  // locate the phase boundary (kink)
        if (outcode(a) & outcode(m) & outcode(b)) return false;  // entirely off-screen
        const double dx = b.x - a.x, dy = b.y - a.y;
        const double len2 = dx * dx + dy * dy;
        if (len2 > 0.04 * 0.04) return true;  // keep a minimum on-screen resolution
        // Perpendicular distance of the midpoint from the chord.
        double dev;
        if (len2 < 1e-24) {
            dev = std::hypot(m.x - a.x, m.y - a.y);
        } else {
            dev = std::abs(dx * (m.y - a.y) - dy * (m.x - a.x)) / std::sqrt(len2);
        }
        return dev > tol_;
    }

    const Evaluator& eval_;
    Projector proj_;
    double tol_;
    int maxDepth_;
};

double clamp(double v, double lo, double hi) { return std::min(std::max(v, lo), hi); }

double logLerp(double a, double b, double t) { return std::exp(std::log(a) + t * (std::log(b) - std::log(a))); }

// Sample over log(p) between p0 and p1.
Curve sampleLogP(const std::function<std::optional<Point>(double)>& atP, double p0, double p1, const Viewport& vp,
                 int segments = 48) {
    if (!(p1 > p0)) return {};
    const double l0 = std::log(p0), l1 = std::log(p1);
    return sampleAdaptive([&](double l) { return atP(std::exp(l)); }, l0, l1, vp, segments);
}

std::optional<Point> flash(Fluid& f, Prop a, double va, Prop b, double vb, Phase imposed = Phase::Unknown) {
    if (!f.update(a, va, b, vb, imposed)) return std::nullopt;
    return f.point();
}

void appendJoined(Curve& dst, const Curve& src) {
    if (src.empty()) return;
    if (dst.empty()) {
        dst.append(src);
        return;
    }
    // Skip the first vertex of `src` if it duplicates the last one of `dst`.
    const Point last = dst.at(dst.size() - 1), first = src.at(0);
    const bool dup = std::abs(last.T - first.T) < 1e-9 * std::max(1.0, std::abs(first.T)) &&
                     std::abs(last.p - first.p) < 1e-9 * std::max(1.0, std::abs(first.p)) &&
                     std::abs(last.rho - first.rho) < 1e-9 * std::max(1.0, std::abs(first.rho));
    dst.data.insert(dst.data.end(), src.data.begin() + (dup ? Curve::kStride : 0), src.data.end());
}

Curve isobar(Fluid& f, double p, const Domain& d, const Viewport& vp) {
    const auto& I = f.info();
    const double T0 = d.Tmin, T1 = d.Tmax;
    if (!(T1 > T0)) return {};
    const auto single = [&](Phase phase) {
        return [&f, p, phase](double T) { return flash(f, Prop::P, p, Prop::T, T, phase); };
    };
    if (!(p < I.pcrit) || !(p > I.ptriple)) return sampleAdaptive(single(Phase::Unknown), T0, T1, vp);

    const auto liq = flash(f, Prop::P, p, Prop::Q, 0);
    const auto vap = flash(f, Prop::P, p, Prop::Q, 1);
    if (!liq || !vap) return sampleAdaptive(single(Phase::Unknown), T0, T1, vp);
    const double Ts = liq->T;

    Curve out;
    if (T0 < Ts) {
        const auto liquid = single(Phase::Liquid);
        appendJoined(out, sampleAdaptive(
                              [&](double T) { return T >= Ts ? liq : liquid(T); }, T0, std::min(Ts, T1), vp));
    }
    if (Ts >= T0 && Ts <= T1) {
        appendJoined(out, sampleAdaptive([&](double q) { return flash(f, Prop::P, p, Prop::Q, q); }, 0, 1, vp, 8));
    }
    if (T1 > Ts) {
        const auto gas = single(Phase::Gas);
        appendJoined(out, sampleAdaptive([&](double T) { return T <= Ts ? vap : gas(T); }, std::max(Ts, T0), T1, vp));
    }
    return out;
}

Curve isotherm(Fluid& f, double T, const Domain& d, const Viewport& vp) {
    const auto& I = f.info();
    if (!(d.pmax > d.pmin)) return {};
    const auto single = [&](Phase phase) {
        return [&f, T, phase](double p) { return flash(f, Prop::T, T, Prop::P, p, phase); };
    };
    if (!(T < I.Tcrit) || T < I.Ttriple) return sampleLogP(single(Phase::Unknown), d.pmin, d.pmax, vp);

    const auto liq = flash(f, Prop::T, T, Prop::Q, 0);
    const auto vap = flash(f, Prop::T, T, Prop::Q, 1);
    if (!liq || !vap) return sampleLogP(single(Phase::Unknown), d.pmin, d.pmax, vp);
    const double ps = liq->p;

    Curve out;
    if (d.pmin < ps) {
        const auto gas = single(Phase::Gas);
        appendJoined(out, sampleLogP([&](double p) { return p >= ps ? vap : gas(p); }, d.pmin, std::min(ps, d.pmax), vp));
    }
    if (ps >= d.pmin && ps <= d.pmax) {
        appendJoined(out, sampleAdaptive([&](double q) { return flash(f, Prop::T, T, Prop::Q, 1 - q); }, 0, 1, vp, 8));
    }
    if (d.pmax > ps) {
        const auto liquid = single(Phase::Liquid);
        appendJoined(out,
                     sampleLogP([&](double p) { return p <= ps ? liq : liquid(p); }, std::max(ps, d.pmin), d.pmax, vp));
    }
    return out;
}

}  // namespace

Curve sampleAdaptive(const Evaluator& eval, double t0, double t1, const Viewport& vp, int initialSegments,
                     int maxDepth) {
    Curve curve;
    if (!(t1 > t0) || initialSegments < 1) return curve;
    AdaptiveSampler sampler(eval, vp, maxDepth);

    std::vector<Sample> samples;
    samples.reserve(static_cast<std::size_t>(initialSegments) * 4);
    Sample prev = sampler.sample(t0);
    samples.push_back(prev);
    for (int i = 1; i <= initialSegments; ++i) {
        const double t = t0 + (t1 - t0) * static_cast<double>(i) / initialSegments;
        Sample next = sampler.sample(t);
        sampler.refine(prev, next, 0, samples);
        samples.push_back(next);
        prev = next;
    }

    for (const auto& s : samples) {
        if (usable(s)) {
            curve.push(*s.pt);
        } else {
            curve.breakLine();
        }
    }
    // Drop a trailing break row.
    while (curve.endsWithBreak()) curve.data.resize(curve.data.size() - Curve::kStride);
    return curve;
}

Domain viewportDomain(Fluid& f, const Viewport& vp) {
    const auto& I = f.info();
    Domain d;
    if (vp.x == Prop::T) d.Tmin = vp.xMin, d.Tmax = vp.xMax;
    if (vp.y == Prop::T) d.Tmin = vp.yMin, d.Tmax = vp.yMax;
    if (vp.x == Prop::P) d.pmin = vp.xMin, d.pmax = vp.xMax;
    if (vp.y == Prop::P) d.pmin = vp.yMin, d.pmax = vp.yMax;

    if (!(d.Tmax > d.Tmin) || !(d.pmax > d.pmin)) {
        // Probe a grid over the viewport to find the T and p it spans.
        constexpr int N = 7;
        double Tlo = INFINITY, Thi = -INFINITY, plo = INFINITY, phi = -INFINITY;
        const auto at = [](double lo, double hi, bool log, double t) {
            return log ? logLerp(lo, hi, t) : lo + (hi - lo) * t;
        };
        for (int i = 0; i < N; ++i) {
            for (int j = 0; j < N; ++j) {
                const double x = at(vp.xMin, vp.xMax, vp.xLog, static_cast<double>(i) / (N - 1));
                const double y = at(vp.yMin, vp.yMax, vp.yLog, static_cast<double>(j) / (N - 1));
                if (!f.update(vp.x, x, vp.y, y)) continue;
                const Point pt = f.point();
                Tlo = std::min(Tlo, pt.T), Thi = std::max(Thi, pt.T);
                plo = std::min(plo, pt.p), phi = std::max(phi, pt.p);
            }
        }
        if (!(d.Tmax > d.Tmin)) {
            if (Thi > Tlo) {
                const double pad = 0.1 * (Thi - Tlo);
                d.Tmin = Tlo - pad, d.Tmax = Thi + pad;
            } else {
                d.Tmin = I.Tmin, d.Tmax = I.Tmax;
            }
        }
        if (!(d.pmax > d.pmin)) {
            if (phi > plo) {
                d.pmin = plo / 3, d.pmax = phi * 3;
            } else {
                d.pmin = std::max(I.ptriple, 1.0), d.pmax = I.pmax;
            }
        }
    }
    const double Tlow = std::isfinite(I.Ttriple) ? std::min(I.Ttriple, I.Tmin) : I.Tmin;
    d.Tmin = clamp(d.Tmin, Tlow, I.Tmax);
    d.Tmax = clamp(d.Tmax, Tlow, I.Tmax);
    d.pmin = clamp(d.pmin, kMinPressure, I.pmax);
    d.pmax = clamp(d.pmax, kMinPressure, I.pmax);
    return d;
}

Curve isoline(Fluid& f, Prop prop, double value, const Viewport& vp) {
    return isoline(f, prop, value, vp, viewportDomain(f, vp));
}

Curve isoline(Fluid& f, Prop prop, double value, const Viewport& vp, const Domain& d) {
    if (!std::isfinite(value)) return {};
    const auto& I = f.info();
    switch (prop) {
        case Prop::P: return isobar(f, value, d, vp);
        case Prop::T: return isotherm(f, value, d, vp);
        case Prop::H:
        case Prop::S:
        case Prop::U:
            return sampleLogP([&](double p) { return flash(f, prop, value, Prop::P, p); }, d.pmin, d.pmax, vp);
        case Prop::D:
        case Prop::V: {
            const double rho = prop == Prop::V ? 1.0 / value : value;
            return sampleAdaptive([&](double T) { return flash(f, Prop::D, rho, Prop::T, T); }, d.Tmin, d.Tmax, vp);
        }
        case Prop::Q: {
            const double T0 = std::max(d.Tmin, I.Ttriple);
            const double T1 = std::min(d.Tmax, I.Tcrit * (1 - 1e-7));
            Curve c = sampleAdaptive([&](double T) { return flash(f, Prop::Q, value, Prop::T, T); }, T0, T1, vp, 32);
            // Every quality line ends at the critical point.
            if (d.Tmax >= I.Tcrit) {
                if (auto cp = flash(f, Prop::D, I.rhocrit, Prop::T, I.Tcrit)) c.push(*cp);
            }
            return c;
        }
    }
    return {};
}

SaturationCurves saturationCurves(Fluid& f, int n) {
    SaturationCurves out;
    const auto& I = f.info();
    const double Tt = std::isfinite(I.Ttriple) ? std::max(I.Ttriple, I.Tmin) : I.Tmin;
    const double Tc = I.Tcrit;
    if (!(Tc > Tt) || n < 2) return out;

    std::vector<double> Ts;
    Ts.reserve(static_cast<std::size_t>(n));
    for (int i = 0; i < n; ++i) {
        // Quadratic clustering towards the critical point, where the dome is steepest.
        const double u = static_cast<double>(i) / n;
        Ts.push_back(Tc - (Tc - Tt) * (1 - u) * (1 - u));
    }

    for (double T : Ts) {
        if (auto pt = flash(f, Prop::T, T, Prop::Q, 0)) out.dome.push(*pt);
    }
    if (auto cp = flash(f, Prop::D, I.rhocrit, Prop::T, Tc)) {
        Point c = *cp;
        c.Q = NaN;
        out.criticalIndex = out.dome.size();
        out.dome.push(c);
    }
    for (auto it = Ts.rbegin(); it != Ts.rend(); ++it) {
        if (auto pt = flash(f, Prop::T, *it, Prop::Q, 1)) out.dome.push(*pt);
    }

    if (I.hasMeltingLine) {
        auto& as = f.backend();
        double pmin = NaN, pmax = NaN;
        try {
            pmin = as.melting_line(CoolProp::iP_min, CoolProp::iT, 0);
            pmax = as.melting_line(CoolProp::iP_max, CoolProp::iT, 0);
        } catch (...) {
        }
        pmin = std::max(std::isfinite(pmin) ? pmin : I.ptriple, I.ptriple);
        pmax = std::min(std::isfinite(pmax) ? pmax : I.pmax, I.pmax);
        if (pmax > pmin && pmin > 0) {
            constexpr int M = 80;
            for (int i = 0; i <= M; ++i) {
                const double p = logLerp(pmin, pmax, static_cast<double>(i) / M);
                const double T = f.meltingTemperature(p);
                if (!std::isfinite(T)) continue;
                Point pt;
                if (auto liq = flash(f, Prop::P, p, Prop::T, T, Phase::Liquid)) {
                    pt = *liq;
                } else {
                    pt.T = T, pt.p = p;
                }
                out.melting.push(pt);
            }
        }
    }
    return out;
}

}  // namespace thermo
