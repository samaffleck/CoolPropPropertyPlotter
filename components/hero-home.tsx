"use client";

import { useEffect, useState } from 'react';
import Image from "next/image";
import ToolDemoImg from "@/public/images/tool_demo.svg";
import ToolDemoImg2 from "@/public/images/tool_demo2.png";
import Link from "next/link";
import Slider from "react-slick";

export default function HeroHome() {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return null; // Render nothing on the server to avoid mismatch
  }

  // Slider settings
  const settings = {
    dots: true,              // Enable dots for navigation
    infinite: true,          // Infinite loop through slides
    speed: 500,              // Transition speed in milliseconds
    slidesToShow: 1,         // Show one slide at a time
    slidesToScroll: 1,       // Scroll one slide at a time
    autoplay: true,          // Enable autoplay
    autoplaySpeed: 3000,     // Autoplay interval
    cssEase: "ease-in-out",  // Smooth transition effect
    arrows: false,           // Disable next/previous arrows
  };

  return (
    <section className="ml-48 bg-black-800"> {/* Updated background color to match sidebar */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Hero content */}
        <div className="py-12 md:py-20">
          {/* Section header */}
          <div className="pb-12 text-center md:pb-20">
            <h1
              className="animate-[gradient_6s_linear_infinite] bg-[linear-gradient(to_right,theme(colors.gray.200),theme(colors.indigo.200),theme(colors.gray.50),theme(colors.indigo.300),theme(colors.gray.200))] bg-[length:200%_auto] bg-clip-text pb-5 font-nacelle text-4xl font-semibold text-transparent md:text-5xl"
              data-aos="fade-up"
            >
              Thermophysical Properties of Fluids
            </h1>
            <div className="mx-auto max-w-3xl">
              <p
                className="mb-8 text-xl text-indigo-200/65"
                data-aos="fade-up"
                data-aos-delay={200}
              >
                Plot the thermophysical properties of pure fluids from your browser.
              </p>

              {/* Image Slider */}
              <div>
                <Image
                  className="max-w-none"
                  src={ToolDemoImg2}
                  width={760}
                  height={465}
                  alt="Tool demo"
                />
              </div>
              <div className="flex justify-center pb-4 md:pb-16" data-aos="fade-up">
              </div>
                <div data-aos="fade-up" data-aos-delay={400}>
                  <a className="btn group mb-4 w-full bg-gradient-to-t from-indigo-600 to-indigo-500 bg-[length:100%_100%] bg-[bottom] text-white shadow-[inset_0px_1px_0px_0px_theme(colors.white/.16)] hover:bg-[length:100%_150%] sm:mb-0 sm:w-auto">
                    <Link href="/propertyplotter">
                      Try ThermoPlot
                    </Link>
                  </a>
                </div>
              </div>
          </div>

          <div className="border-t py-8 [border-image:linear-gradient(to_right,transparent,theme(colors.slate.400/.25),transparent)1] md:py-20">
            {/* Section header */}
            <div className="mx-auto max-w-3xl pb-4 text-center md:pb-12">
              <div className="inline-flex items-center gap-3 pb-3 before:h-px before:w-8 before:bg-gradient-to-r before:from-transparent before:to-indigo-200/50 after:h-px after:w-8 after:bg-gradient-to-l after:from-transparent after:to-indigo-200/50">
                <span className="inline-flex bg-gradient-to-r from-indigo-500 to-indigo-200 bg-clip-text text-transparent">
                  Built from the CoolProp library
                </span>
              </div>
              <h2 className="animate-[gradient_6s_linear_infinite] bg-[linear-gradient(to_right,theme(colors.gray.200),theme(colors.indigo.200),theme(colors.gray.50),theme(colors.indigo.300),theme(colors.gray.200))] bg-[length:200%_auto] bg-clip-text pb-4 font-nacelle text-3xl font-semibold text-transparent md:text-4xl">
                Advanced Equation of State Models
              </h2>
              <p className="text-lg text-indigo-200/65">
                The powerful CoolProp C++ library is used to calculate precise thermophysical properties. CoolProp provides equations of state for 122 pure fluids, making it an industry-leading tool for accurate fluid property predictions. Learn more about CoolProp and its extensive capabilities by visiting the official website:  
                <a href="http://www.coolprop.org" className="text-indigo-400 underline hover:text-indigo-600">
                  www.coolprop.org
                </a>.
              </p>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
