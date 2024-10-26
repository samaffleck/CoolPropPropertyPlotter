export const metadata = {
  title: "ThermoPlot",
  description: "ThermoPlot is a interactive graphical calculator for plotting \
  thermophysical and thermodynamic data for pure fluids. Simply select a fluid \
  and visualise the temperature-entropy and pressure-enthalpy diagrams.",
};

import PageIllustration from "@/components/page-illustration";
import Hero from "@/components/hero-home";
import Features from "@/components/features";
import Cta from "@/components/cta";

export default function Home() {
  return (
    <>
      <Hero />
    </>
  );
}
