#include "thermo/cycles.hpp"

#include <algorithm>
#include <cmath>
#include <functional>
#include <cstdio>
#include <stdexcept>

#include "thermo/process.hpp"

namespace thermo {

namespace {

struct CycleError : std::runtime_error {
    using std::runtime_error::runtime_error;
};

double get(const CycleParams& p, const char* key, double fallback) {
    auto it = p.find(key);
    return it != p.end() && std::isfinite(it->second) ? it->second : fallback;
}

std::string fmtK(double T) {
    char buf[32];
    std::snprintf(buf, sizeof buf, "%.1f K", T);
    return buf;
}

class Builder {
public:
    Builder(Fluid& f, CycleResult& r) : f_(f), r_(r) {}

    Fluid& fluid() { return f_; }
    const FluidInfo& info() const { return f_.info(); }

    State st(Prop a, double va, Prop b, double vb, const char* what, Phase imposed = Phase::Unknown) {
        State s = f_.stateAt(a, va, b, vb, imposed);
        if (!s.valid && imposed != Phase::Unknown) s = f_.stateAt(a, va, b, vb);
        if (!s.valid) throw CycleError(std::string("Could not evaluate ") + what);
        return s;
    }
    State sat(Prop given, double v, double Q, const char* what) { return st(given, v, Prop::Q, Q, what); }

    // Adiabatic machine from `in` to pressure `p` with isentropic efficiency `eta`.
    State machine(const State& in, double p, double eta, bool compress, const char* what) {
        if (!(eta > 0 && eta <= 1)) throw CycleError(std::string("Efficiency of ") + what + " must be in (0, 1]");
        const State iso = st(Prop::P, p, Prop::S, in.s, what);
        const double h = compress ? in.h + (iso.h - in.h) / eta : in.h - eta * (in.h - iso.h);
        return st(Prop::P, p, Prop::H, h, what);
    }

    const State& add(const std::string& id, const std::string& label, const State& s, double flow = 1.0) {
        r_.states.push_back({id, label, s, flow});
        return r_.states.back().state;
    }

    const State& at(const std::string& id) const {
        for (const auto& s : r_.states)
            if (s.id == id) return s.state;
        throw CycleError("Unknown state " + id);
    }

    void seg(const std::string& from, const std::string& to, const std::string& component, const std::string& kind,
             const std::function<Curve(Fluid&, const State&, const State&)>& path) {
        r_.segments.push_back({from, to, component, kind, path(f_, at(from), at(to))});
    }

    void metric(const std::string& key, const std::string& label, const std::string& quantity, double value,
                const std::string& group = "performance") {
        r_.metrics.push_back({key, label, quantity, group, value});
    }
    void exergy(const std::string& component, double destroyed) {
        metric("ex_" + component, component, "specific_energy", destroyed, "exergy");
    }

    void warn(const std::string& msg) { r_.warnings.push_back(msg); }

    // Counter-flow exchanger: hot stream (mass mh, pressure ph) from hHotIn to hHotOut,
    // cold stream (mc, pc) leaving at hColdOut at the hot-inlet end.
    void exchanger(const std::string& name, double mh, double ph, double hHotIn, double hHotOut, double mc, double pc,
                   double hColdOut) {
        ExchangerProfile x;
        x.name = name;
        const double Q = mh * (hHotIn - hHotOut);
        constexpr int N = 48;
        double minDT = INFINITY;
        for (int i = 0; i <= N; ++i) {
            const double q = Q * i / N;
            const bool okH = f_.update(Prop::P, ph, Prop::H, hHotIn - q / mh);
            const double Th = okH ? f_.point().T : NaN;
            const bool okC = f_.update(Prop::P, pc, Prop::H, hColdOut - q / mc);
            const double Tc = okC ? f_.point().T : NaN;
            if (!okH || !okC) continue;
            x.q.push_back(q);
            x.Thot.push_back(Th);
            x.Tcold.push_back(Tc);
            minDT = std::min(minDT, Th - Tc);
        }
        x.minApproach = std::isfinite(minDT) ? minDT : NaN;
        // Ideal (zero-approach) exchangers produce tiny negative values from round-off.
        if (x.minApproach < -0.01) {
            warn(name + ": temperature cross (minimum approach " + fmtK(x.minApproach) +
                 "), the exchanger is infeasible with these settings");
        }
        metric("pinch_" + name, name + " min. approach", "temperature_difference", x.minApproach, "design");
        r_.exchangers.push_back(std::move(x));
    }

private:
    Fluid& f_;
    CycleResult& r_;
};

Curve isobaric(Fluid& f, const State& a, const State& b) { return pathIsobaric(f, a, b); }
Curve throttle(Fluid& f, const State& a, const State& b) { return pathIsenthalpic(f, a, b); }
Curve machinePath(Fluid& f, const State& a, const State& b) { return pathPolytropic(f, a, b); }
Curve isothermal(Fluid& f, const State& a, const State& b) { return pathIsothermal(f, a, b); }

// ---------------------------------------------------------------------------------------------
// Single-stage vapour compression refrigeration / heat pump, sub- or transcritical.
void vaporCompression(Builder& b, const CycleParams& p, bool transcritical) {
    const auto& I = b.info();
    const double Te = get(p, "T_evap", 263.15);
    const double sh = std::max(0.0, get(p, "superheat", 5));
    const double eta = get(p, "eta_comp", 0.75);
    if (!(Te < I.Tcrit && Te > I.Ttriple)) throw CycleError("Evaporating temperature must lie between the triple and critical points");

    const double pe = b.sat(Prop::T, Te, 1, "evaporating pressure").p;
    const State s1 = sh > 0 ? b.st(Prop::P, pe, Prop::T, Te + sh, "compressor suction", Phase::Gas)
                            : b.sat(Prop::P, pe, 1, "compressor suction");

    State s3;
    double T0;
    if (transcritical) {
        const double ph = get(p, "p_high", 10e6);
        const double Tgc = get(p, "T_gc_out", 308.15);
        if (!(ph > pe)) throw CycleError("High-side pressure must exceed the evaporating pressure");
        if (ph < I.pcrit) b.warn("High-side pressure is below the critical pressure: the gas cooler is condensing");
        s3 = b.st(Prop::P, ph, Prop::T, Tgc, "gas cooler outlet");
        T0 = get(p, "T_ambient", Tgc - 5);
    } else {
        const double Tc = get(p, "T_cond", 313.15);
        const double sc = std::max(0.0, get(p, "subcool", 3));
        if (!(Tc < I.Tcrit)) throw CycleError("Condensing temperature is above the critical temperature; use the transcritical cycle");
        if (!(Tc > Te)) throw CycleError("Condensing temperature must exceed the evaporating temperature");
        const double pc = b.sat(Prop::T, Tc, 0, "condensing pressure").p;
        s3 = sc > 0 ? b.st(Prop::P, pc, Prop::T, Tc - sc, "condenser outlet", Phase::Liquid)
                    : b.sat(Prop::P, pc, 0, "condenser outlet");
        T0 = get(p, "T_ambient", Tc - 10);
    }
    const double Tcold = get(p, "T_cold_space", Te + 8);

    const State s2 = b.machine(s1, s3.p, eta, true, "compressor discharge");
    const State s4 = b.st(Prop::P, pe, Prop::H, s3.h, "expansion valve outlet");

    const char* hx = transcritical ? "Gas cooler" : "Condenser";
    b.add("1", "Compressor suction", s1);
    b.add("2", "Compressor discharge", s2);
    b.add("3", std::string(hx) + " outlet", s3);
    b.add("4", "Expansion valve outlet", s4);
    b.seg("1", "2", "Compressor", "compressor", machinePath);
    b.seg("2", "3", hx, "cooler", isobaric);
    b.seg("3", "4", "Expansion valve", "valve", throttle);
    b.seg("4", "1", "Evaporator", "heater", isobaric);

    const double qe = s1.h - s4.h, qc = s2.h - s3.h, w = s2.h - s1.h;
    const double cop = qe / w;
    const double carnot = T0 > Tcold ? Tcold / (T0 - Tcold) : NaN;
    b.metric("cop_cooling", "COP (cooling)", "ratio", cop);
    b.metric("cop_heating", "COP (heating)", "ratio", qc / w);
    b.metric("carnot_cop", "Carnot COP", "ratio", carnot);
    b.metric("eta_II", "Second-law efficiency", "fraction", cop / carnot);
    b.metric("q_evap", "Refrigerating effect", "specific_energy", qe);
    b.metric("q_cond", std::string(hx) + " duty", "specific_energy", qc);
    b.metric("w_comp", "Compressor work", "specific_energy", w);
    b.metric("vcc", "Volumetric cooling capacity", "volumetric_energy", qe * s1.rho);
    b.metric("pressure_ratio", "Pressure ratio", "ratio", s3.p / pe, "design");
    b.metric("T_discharge", "Discharge temperature", "temperature", s2.T, "design");
    b.metric("Q_valve", "Quality after valve", "fraction", s4.Q, "design");

    b.exergy("Compressor", T0 * (s2.s - s1.s));
    b.exergy(hx, T0 * ((s3.s - s2.s) + qc / T0));
    b.exergy("Expansion valve", T0 * (s4.s - s3.s));
    b.exergy("Evaporator", T0 * ((s1.s - s4.s) - qe / Tcold));
    if (s2.T > 423.15) b.warn("Discharge temperature exceeds 150 °C");
}

// ---------------------------------------------------------------------------------------------
// Recuperated reverse Brayton (gas refrigerator / turbo-Brayton cryocooler).
void reverseBrayton(Builder& b, const CycleParams& p) {
    const double pl = get(p, "p_low", 1e6);
    const double pr = get(p, "pressure_ratio", 2.0);
    const double Tamb = get(p, "T_ambient", 300);
    const double Tload = get(p, "T_load", 80);
    const double etaC = get(p, "eta_comp", 0.8);
    const double etaE = get(p, "eta_exp", 0.85);
    const double eps = std::clamp(get(p, "effectiveness", 0.98), 0.0, 1.0);
    const bool recover = get(p, "recover_work", 1) > 0.5;
    const double ph = pl * pr;
    if (!(pr > 1)) throw CycleError("Pressure ratio must be greater than 1");
    if (!(Tload < Tamb)) throw CycleError("Load temperature must be below ambient");

    const State s3 = b.st(Prop::P, ph, Prop::T, Tamb, "aftercooler outlet");
    const State s6 = b.st(Prop::P, pl, Prop::T, Tload, "load exchanger outlet");
    const double hHotAtCold = b.st(Prop::P, ph, Prop::T, Tload, "recuperator limit").h;
    const double hColdAtHot = b.st(Prop::P, pl, Prop::T, Tamb, "recuperator limit").h;
    const double qmax = std::min(s3.h - hHotAtCold, hColdAtHot - s6.h);
    if (!(qmax > 0)) throw CycleError("Recuperator has no driving force");
    const double q = eps * qmax;
    const State s4 = b.st(Prop::P, ph, Prop::H, s3.h - q, "expander inlet");
    const State s1 = b.st(Prop::P, pl, Prop::H, s6.h + q, "compressor suction");
    const State s5 = b.machine(s4, pl, etaE, false, "expander outlet");
    if (s5.T >= Tload) {
        throw CycleError("Expander outlet (" + fmtK(s5.T) +
                         ") is not colder than the load temperature; raise the pressure ratio or recuperator effectiveness");
    }
    const State s2 = b.machine(s1, ph, etaC, true, "compressor discharge");

    b.add("1", "Compressor suction", s1);
    b.add("2", "Compressor discharge", s2);
    b.add("3", "Aftercooler outlet", s3);
    b.add("4", "Expander inlet", s4);
    b.add("5", "Expander outlet", s5);
    b.add("6", "Load exchanger outlet", s6);
    b.seg("1", "2", "Compressor", "compressor", machinePath);
    b.seg("2", "3", "Aftercooler", "cooler", isobaric);
    b.seg("3", "4", "Recuperator (hot)", "hx", isobaric);
    b.seg("4", "5", "Expander", "expander", machinePath);
    b.seg("5", "6", "Load exchanger", "heater", isobaric);
    b.seg("6", "1", "Recuperator (cold)", "hx", isobaric);
    b.exchanger("Recuperator", 1, ph, s3.h, s4.h, 1, pl, s1.h);

    const double qload = s6.h - s5.h, wc = s2.h - s1.h, we = s4.h - s5.h;
    const double wnet = wc - (recover ? we : 0);
    const double cop = qload / wnet, carnot = Tload / (Tamb - Tload);
    b.metric("cop", "COP", "ratio", cop);
    b.metric("carnot_cop", "Carnot COP", "ratio", carnot);
    b.metric("fom", "Figure of merit (COP / Carnot)", "fraction", cop / carnot);
    b.metric("q_load", "Refrigeration", "specific_energy", qload);
    b.metric("w_comp", "Compressor work", "specific_energy", wc);
    b.metric("w_exp", "Expander work", "specific_energy", we);
    b.metric("w_net", "Net work input", "specific_energy", wnet);
    b.metric("T_exp_out", "Expander outlet temperature", "temperature", s5.T, "design");
    if (s2.h < s3.h) b.warn("Compressor discharge is colder than ambient: the aftercooler would need to heat");

    const double T0 = Tamb;
    b.exergy("Compressor", T0 * (s2.s - s1.s));
    b.exergy("Aftercooler", T0 * ((s3.s - s2.s) + (s2.h - s3.h) / T0));
    b.exergy("Recuperator", T0 * ((s4.s - s3.s) + (s1.s - s6.s)));
    b.exergy("Expander", T0 * (s5.s - s4.s) + (recover ? 0 : we));
    b.exergy("Load exchanger", T0 * ((s6.s - s5.s) - qload / Tload));
}

// ---------------------------------------------------------------------------------------------
// Closed Brayton power cycle with optional recuperator (air, helium, supercritical CO2, ...).
void brayton(Builder& b, const CycleParams& p) {
    const double pl = get(p, "p_low", 1e5);
    const double pr = get(p, "pressure_ratio", 10);
    const double T1 = get(p, "T_comp_in", 300);
    const double Tit = get(p, "T_turbine_in", 1200);
    const double etaC = get(p, "eta_comp", 0.85);
    const double etaT = get(p, "eta_turb", 0.9);
    const double eps = std::clamp(get(p, "effectiveness", 0.0), 0.0, 1.0);
    const double ph = pl * pr;
    if (!(pr > 1)) throw CycleError("Pressure ratio must be greater than 1");
    if (!(Tit > T1)) throw CycleError("Turbine inlet temperature must exceed compressor inlet temperature");

    const State s1 = b.st(Prop::P, pl, Prop::T, T1, "compressor inlet");
    const State s2 = b.machine(s1, ph, etaC, true, "compressor outlet");
    const State sT = b.st(Prop::P, ph, Prop::T, Tit, "turbine inlet");
    const State sX = b.machine(sT, pl, etaT, false, "turbine outlet");

    double q = 0;
    if (eps > 0 && sX.T > s2.T) {
        const double qmax = std::min(sX.h - b.st(Prop::P, pl, Prop::T, s2.T, "recuperator limit").h,
                                     b.st(Prop::P, ph, Prop::T, sX.T, "recuperator limit").h - s2.h);
        q = eps * std::max(0.0, qmax);
    } else if (eps > 0) {
        b.warn("Turbine exhaust is colder than compressor outlet: recuperation is not possible");
    }

    b.add("1", "Compressor inlet", s1);
    b.add("2", "Compressor outlet", s2);
    double qin;
    if (q > 0) {
        const State s3 = b.st(Prop::P, ph, Prop::H, s2.h + q, "recuperator cold outlet");
        const State s6 = b.st(Prop::P, pl, Prop::H, sX.h - q, "recuperator hot outlet");
        b.add("3", "Recuperator outlet (HP)", s3);
        b.add("4", "Turbine inlet", sT);
        b.add("5", "Turbine outlet", sX);
        b.add("6", "Recuperator outlet (LP)", s6);
        b.seg("1", "2", "Compressor", "compressor", machinePath);
        b.seg("2", "3", "Recuperator (cold)", "hx", isobaric);
        b.seg("3", "4", "Heater", "heater", isobaric);
        b.seg("4", "5", "Turbine", "turbine", machinePath);
        b.seg("5", "6", "Recuperator (hot)", "hx", isobaric);
        b.seg("6", "1", "Cooler", "cooler", isobaric);
        b.exchanger("Recuperator", 1, pl, sX.h, s6.h, 1, ph, s3.h);
        qin = sT.h - s3.h;
    } else {
        b.add("3", "Turbine inlet", sT);
        b.add("4", "Turbine outlet", sX);
        b.seg("1", "2", "Compressor", "compressor", machinePath);
        b.seg("2", "3", "Heater", "heater", isobaric);
        b.seg("3", "4", "Turbine", "turbine", machinePath);
        b.seg("4", "1", "Cooler", "cooler", isobaric);
        qin = sT.h - s2.h;
    }
    const double wt = sT.h - sX.h, wc = s2.h - s1.h, wnet = wt - wc;
    const double eta = wnet / qin, carnot = 1 - T1 / Tit;
    b.metric("eta_th", "Thermal efficiency", "fraction", eta);
    b.metric("carnot", "Carnot efficiency", "fraction", carnot);
    b.metric("eta_II", "Second-law efficiency", "fraction", eta / carnot);
    b.metric("w_net", "Net specific work", "specific_energy", wnet);
    b.metric("w_turb", "Turbine work", "specific_energy", wt);
    b.metric("w_comp", "Compressor work", "specific_energy", wc);
    b.metric("q_in", "Heat input", "specific_energy", qin);
    b.metric("bwr", "Back-work ratio", "fraction", wc / wt, "design");
    b.metric("T_turb_out", "Turbine outlet temperature", "temperature", sX.T, "design");
    if (wnet <= 0) b.warn("The cycle produces no net work");
}

// ---------------------------------------------------------------------------------------------
// Rankine cycle (steam or organic fluid).
void rankine(Builder& b, const CycleParams& p) {
    const auto& I = b.info();
    const double Tc = get(p, "T_cond", 313.15);
    const double pb = get(p, "p_boiler", 10e6);
    const double Tin = get(p, "T_turbine_in", 773.15);
    const double etaP = get(p, "eta_pump", 0.75);
    const double etaT = get(p, "eta_turb", 0.85);
    if (!(Tc < I.Tcrit)) throw CycleError("Condensing temperature must be below the critical temperature");

    const State s1 = b.sat(Prop::T, Tc, 0, "pump inlet");
    if (!(pb > s1.p)) throw CycleError("Boiler pressure must exceed the condensing pressure");
    const State s2 = b.machine(s1, pb, etaP, true, "pump outlet");
    State s3;
    if (pb < I.pcrit) {
        const State sv = b.sat(Prop::P, pb, 1, "saturated vapour");
        if (Tin > sv.T + 1e-6) {
            s3 = b.st(Prop::P, pb, Prop::T, Tin, "turbine inlet", Phase::Gas);
        } else {
            s3 = sv;
            b.warn("Turbine inlet temperature is at or below saturation; using saturated vapour (" + fmtK(sv.T) + ")");
        }
    } else {
        s3 = b.st(Prop::P, pb, Prop::T, Tin, "turbine inlet");
    }
    const State s4 = b.machine(s3, s1.p, etaT, false, "turbine outlet");

    b.add("1", "Pump inlet", s1);
    b.add("2", "Pump outlet", s2);
    b.add("3", "Turbine inlet", s3);
    b.add("4", "Turbine outlet", s4);
    b.seg("1", "2", "Pump", "pump", machinePath);
    b.seg("2", "3", "Boiler", "heater", isobaric);
    b.seg("3", "4", "Turbine", "turbine", machinePath);
    b.seg("4", "1", "Condenser", "cooler", isobaric);

    const double wt = s3.h - s4.h, wp = s2.h - s1.h, qin = s3.h - s2.h;
    const double eta = (wt - wp) / qin, carnot = 1 - s1.T / s3.T;
    b.metric("eta_th", "Thermal efficiency", "fraction", eta);
    b.metric("carnot", "Carnot efficiency", "fraction", carnot);
    b.metric("eta_II", "Second-law efficiency", "fraction", eta / carnot);
    b.metric("w_net", "Net specific work", "specific_energy", wt - wp);
    b.metric("w_turb", "Turbine work", "specific_energy", wt);
    b.metric("w_pump", "Pump work", "specific_energy", wp);
    b.metric("q_in", "Heat input", "specific_energy", qin);
    b.metric("q_out", "Heat rejected", "specific_energy", s4.h - s1.h);
    b.metric("bwr", "Back-work ratio", "fraction", wp / wt, "design");
    b.metric("Q_turb_out", "Turbine exit quality", "fraction", s4.Q, "design");
    if (s4.Q == s4.Q && s4.Q < 0.88) b.warn("Turbine exit quality is below 0.88: risk of blade erosion");
}

// ---------------------------------------------------------------------------------------------
// Shared helpers for liquefiers. Compression is modelled as isothermal at ambient temperature
// (multi-stage intercooled machine plus aftercooler) with an overall isothermal efficiency.
struct LiquefierEnds {
    State s1, s2, sr, sf, sg;
    double wcIdeal, wc;
};

LiquefierEnds liquefierEnds(Builder& b, const CycleParams& p) {
    const auto& I = b.info();
    const double ph = get(p, "p_high", 20e6);
    const double pl = get(p, "p_low", 101325);
    const double Tamb = get(p, "T_ambient", 300);
    const double etaIso = get(p, "eta_iso", 0.6);
    const double dT = std::max(0.0, get(p, "dT_warm", 0));
    if (!(ph > pl)) throw CycleError("High pressure must exceed low pressure");
    if (!(pl < I.pcrit)) throw CycleError("Low pressure must be below the critical pressure to produce liquid");
    if (!(etaIso > 0 && etaIso <= 1)) throw CycleError("Isothermal efficiency must be in (0, 1]");
    LiquefierEnds e;
    e.s1 = b.st(Prop::P, pl, Prop::T, Tamb, "compressor suction");
    e.s2 = b.st(Prop::P, ph, Prop::T, Tamb, "compressor discharge (after aftercooler)");
    e.sr = b.st(Prop::P, pl, Prop::T, Tamb - dT, "return gas at warm end");
    e.sf = b.sat(Prop::P, pl, 0, "saturated liquid");
    e.sg = b.sat(Prop::P, pl, 1, "saturated vapour");
    e.wcIdeal = Tamb * (e.s1.s - e.s2.s) - (e.s1.h - e.s2.h);
    e.wc = e.wcIdeal / etaIso;
    return e;
}

void liquefierMetrics(Builder& b, const LiquefierEnds& e, double y, double wnet, double T0) {
    const double wIdeal = T0 * (e.s1.s - e.sf.s) - (e.s1.h - e.sf.h);
    const double wPerKg = wnet / y;
    b.metric("yield", "Liquid yield", "fraction", y);
    b.metric("w_per_liquid", "Work per kg liquid", "specific_energy", wPerKg);
    b.metric("w_ideal", "Minimum work per kg liquid", "specific_energy", wIdeal);
    b.metric("fom", "Figure of merit", "fraction", wIdeal / wPerKg);
    b.metric("w_comp", "Compressor work per kg compressed", "specific_energy", e.wc);
    b.metric("T_sat", "Liquid temperature", "temperature", e.sf.T, "design");
}

void lindeHampson(Builder& b, const CycleParams& p) {
    const LiquefierEnds e = liquefierEnds(b, p);
    const double T0 = e.s1.T;
    const double y = (e.sr.h - e.s2.h) / (e.sr.h - e.sf.h);
    if (!(y > 0)) {
        throw CycleError(
            "No liquid is produced: the gas warms on throttling at this temperature (Joule-Thomson inversion). "
            "Precool below the inversion temperature or raise the pressure.");
    }
    const State s3 = b.st(Prop::P, e.s2.p, Prop::H, e.s2.h - (1 - y) * (e.sr.h - e.sg.h), "JT valve inlet");
    const State s4 = b.st(Prop::P, e.s1.p, Prop::H, s3.h, "JT valve outlet");

    b.add("1", "Compressor suction (make-up + return)", e.s1);
    b.add("2", "Compressor discharge (aftercooled)", e.s2);
    b.add("3", "JT valve inlet", s3);
    b.add("4", "JT valve outlet", s4);
    b.add("f", "Liquid product", e.sf, y);
    b.add("g", "Separator vapour", e.sg, 1 - y);
    b.add("r", "Return gas, warm end", e.sr, 1 - y);
    b.seg("1", "2", "Compressor", "compressor", isothermal);
    b.seg("2", "3", "Heat exchanger (hot)", "hx", isobaric);
    b.seg("3", "4", "JT valve", "valve", throttle);
    b.seg("4", "f", "Separator", "separator", isobaric);
    b.seg("4", "g", "Separator", "separator", isobaric);
    b.seg("g", "r", "Heat exchanger (cold)", "hx", isobaric);
    b.seg("r", "1", "Make-up / warming", "mixer", isobaric);
    b.exchanger("Heat exchanger", 1, e.s2.p, e.s2.h, s3.h, 1 - y, e.s1.p, e.sr.h);

    liquefierMetrics(b, e, y, e.wc, T0);
    b.metric("T_jt_in", "JT valve inlet temperature", "temperature", s3.T, "design");

    b.exergy("Compressor", e.wc - ((e.s2.h - e.s1.h) - T0 * (e.s2.s - e.s1.s)));
    b.exergy("Heat exchanger", T0 * ((s3.s - e.s2.s) + (1 - y) * (e.sr.s - e.sg.s)));
    b.exergy("JT valve", T0 * (s4.s - s3.s));
    b.exergy("Warm-end loss", (1 - y) * (T0 * (e.s1.s - e.sr.s) - (e.s1.h - e.sr.h)));
}

void claude(Builder& b, const CycleParams& p) {
    const LiquefierEnds e = liquefierEnds(b, p);
    const double T0 = e.s1.T;
    const double ph = e.s2.p, pl = e.s1.p;
    const double T3 = get(p, "T_exp_in", 200);
    const double x = get(p, "exp_fraction", 0.6);
    const double etaE = get(p, "eta_exp", 0.8);
    const bool recover = get(p, "recover_work", 1) > 0.5;
    if (!(x > 0 && x < 1)) throw CycleError("Expander flow fraction must be between 0 and 1");
    if (!(T3 < T0)) throw CycleError("Expander inlet temperature must be below ambient");

    const State s3 = b.st(Prop::P, ph, Prop::T, T3, "expander inlet");
    const State se = b.machine(s3, pl, etaE, false, "expander outlet");
    const double we = x * (s3.h - se.h);
    const double y = ((e.sr.h - e.s2.h) + we) / (e.sr.h - e.sf.h);
    if (!(y > 0)) throw CycleError("No liquid is produced with these settings");
    if (!(1 - x - y > 0)) throw CycleError("Expander flow fraction is too high: no flow is left for the JT stream");
    if (se.Q == se.Q) b.warn("Expander exhaust is two-phase; most turbo-expanders cannot tolerate liquid");

    // Cold return stream joins the expander exhaust at the exhaust temperature.
    const State s7 = se.Q == se.Q ? e.sg : b.st(Prop::P, pl, Prop::T, se.T, "return stream at expander exhaust", Phase::Gas);
    const State s9 = b.st(Prop::P, pl, Prop::H, e.sr.h - (e.s2.h - s3.h) / (1 - y), "return stream, HX1 inlet");
    const State s8 = b.st(Prop::P, pl, Prop::H, (x * se.h + (1 - x - y) * s7.h) / (1 - y), "mixed return stream");
    const State s4 = b.st(Prop::P, ph, Prop::H, s3.h - (1 - y) * (s9.h - s8.h) / (1 - x), "HX2 hot outlet");
    const State s5 = b.st(Prop::P, ph, Prop::H, s4.h - (1 - x - y) * (s7.h - e.sg.h) / (1 - x), "JT valve inlet");
    const State s6 = b.st(Prop::P, pl, Prop::H, s5.h, "JT valve outlet");

    b.add("1", "Compressor suction (make-up + return)", e.s1);
    b.add("2", "Compressor discharge (aftercooled)", e.s2);
    b.add("3", "HX1 outlet / expander inlet", s3);
    b.add("e", "Expander outlet", se, x);
    b.add("4", "HX2 hot outlet", s4, 1 - x);
    b.add("5", "JT valve inlet", s5, 1 - x);
    b.add("6", "JT valve outlet", s6, 1 - x);
    b.add("f", "Liquid product", e.sf, y);
    b.add("g", "Separator vapour", e.sg, 1 - x - y);
    b.add("7", "HX3 cold outlet", s7, 1 - x - y);
    b.add("8", "Mixed return", s8, 1 - y);
    b.add("9", "HX2 cold outlet", s9, 1 - y);
    b.add("r", "Return gas, warm end", e.sr, 1 - y);
    b.seg("1", "2", "Compressor", "compressor", isothermal);
    b.seg("2", "3", "HX1 (hot)", "hx", isobaric);
    b.seg("3", "e", "Expander", "expander", machinePath);
    b.seg("3", "4", "HX2 (hot)", "hx", isobaric);
    b.seg("4", "5", "HX3 (hot)", "hx", isobaric);
    b.seg("5", "6", "JT valve", "valve", throttle);
    b.seg("6", "f", "Separator", "separator", isobaric);
    b.seg("6", "g", "Separator", "separator", isobaric);
    b.seg("g", "7", "HX3 (cold)", "hx", isobaric);
    b.seg("7", "8", "Mixing", "mixer", isobaric);
    b.seg("e", "8", "Mixing", "mixer", isobaric);
    b.seg("8", "9", "HX2 (cold)", "hx", isobaric);
    b.seg("9", "r", "HX1 (cold)", "hx", isobaric);
    b.seg("r", "1", "Make-up / warming", "mixer", isobaric);
    b.exchanger("HX1", 1, ph, e.s2.h, s3.h, 1 - y, pl, e.sr.h);
    b.exchanger("HX2", 1 - x, ph, s3.h, s4.h, 1 - y, pl, s9.h);
    b.exchanger("HX3", 1 - x, ph, s4.h, s5.h, 1 - x - y, pl, s7.h);

    const double wnet = e.wc - (recover ? we : 0);
    liquefierMetrics(b, e, y, wnet, T0);
    b.metric("w_exp", "Expander work per kg compressed", "specific_energy", we);
    b.metric("T_exp_out", "Expander outlet temperature", "temperature", se.T, "design");
    b.metric("T_jt_in", "JT valve inlet temperature", "temperature", s5.T, "design");

    b.exergy("Compressor", e.wc - ((e.s2.h - e.s1.h) - T0 * (e.s2.s - e.s1.s)));
    b.exergy("HX1", T0 * ((s3.s - e.s2.s) + (1 - y) * (e.sr.s - s9.s)));
    b.exergy("HX2", T0 * ((1 - x) * (s4.s - s3.s) + (1 - y) * (s9.s - s8.s)));
    b.exergy("HX3", T0 * ((1 - x) * (s5.s - s4.s) + (1 - x - y) * (s7.s - e.sg.s)));
    b.exergy("Expander", T0 * x * (se.s - s3.s) + (recover ? 0 : we));
    b.exergy("Mixing", T0 * ((1 - y) * s8.s - x * se.s - (1 - x - y) * s7.s));
    b.exergy("JT valve", T0 * (1 - x) * (s6.s - s5.s));
    b.exergy("Warm-end loss", (1 - y) * (T0 * (e.s1.s - e.sr.s) - (e.s1.h - e.sr.h)));
}

using Solver = void (*)(Builder&, const CycleParams&);

const std::vector<std::pair<std::string, Solver>>& registry() {
    static const std::vector<std::pair<std::string, Solver>> r = {
        {"vapor_compression", [](Builder& b, const CycleParams& p) { vaporCompression(b, p, false); }},
        {"transcritical", [](Builder& b, const CycleParams& p) { vaporCompression(b, p, true); }},
        {"reverse_brayton", reverseBrayton},
        {"brayton", brayton},
        {"rankine", rankine},
        {"linde_hampson", lindeHampson},
        {"claude", claude},
    };
    return r;
}

}  // namespace

CycleResult solveCycle(const std::string& id, Fluid& fluid, const CycleParams& params) {
    CycleResult r;
    for (const auto& [name, solver] : registry()) {
        if (name != id) continue;
        Builder b(fluid, r);
        try {
            solver(b, params);
            r.ok = true;
        } catch (const std::exception& e) {
            r = CycleResult{};
            r.error = e.what();
        }
        return r;
    }
    r.error = "Unknown cycle: " + id;
    return r;
}

std::vector<std::string> cycleIds() {
    std::vector<std::string> ids;
    for (const auto& [name, solver] : registry()) ids.push_back(name);
    return ids;
}

}  // namespace thermo
