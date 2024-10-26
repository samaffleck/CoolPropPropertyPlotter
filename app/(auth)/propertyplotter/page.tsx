export const metadata = {
  title: "ThermoPlot",
  description: "Web tool for plotting thermophysical properties of fluid systems.",
};

import Link from "next/link";

export default function PropertyPlotter() {
  return (
    <div className="flex flex-col h-screen ml-48"> {/* Add left margin for sidebar space */}

      {/* Main Content - Property Plotter */}
      <main className="flex-grow mt-1">
        <iframe
          src="/wasm_app/hello_world_.html"  // Path to the HTML file in the public folder
          className="w-full h-full"
          style={{ border: "none" }}
          title="Property Plotter Web Tool"
        ></iframe>
      </main>

    </div>
  );
}

