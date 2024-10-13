export const metadata = {
  title: "Property Plotter",
  description: "Web tool for plotting thermophysical properties of fluid systems.",
};

import Link from "next/link";

export default function PropertyPlotter() {
  return (
    <div className="flex flex-col h-screen">

      {/* Main Content - Property Plotter */}
      <main className="flex-grow mt-1">
        <iframe
          src="/wasm_app/hello_world_.html"  // Path to the HTML file in the public folder
          className="w-full h-full"
          style={{ border: "none" }}
          title="Property Plotter Web Tool"
        ></iframe>
      </main>

      {/* Footer */}
      <footer className="bg-gray-800 text-white p-2 text-center flex-shrink-0">
        <div className="container mx-auto">
          <p>© 2024 CoolProp Thermophysical Property Plotter</p>
        </div>
      </footer>
    </div>
  );
}
