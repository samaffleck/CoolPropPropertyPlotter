"use client";

import Link from "next/link";

import { useEffect, useState } from 'react';

export default function PropertyPlotter() {
  const [showPopup, setShowPopup] = useState(false);

  useEffect(() => {
    // Set the page title dynamically without returning JSX
    document.title = "ThermoPlot";

    const hasSeenPopup = localStorage.getItem('hasSeenBookmarkPopup');
    if (!hasSeenPopup) {
      setShowPopup(true);
      localStorage.setItem('hasSeenBookmarkPopup', 'true');
    }
  }, []); // The empty dependency array ensures this runs once on mount

  const closePopup = () => {
    setShowPopup(false);
  };

  return (
    <div className="flex flex-col h-screen ml-28"> {/* Add left margin for sidebar space */}

      {/* Main Content - Property Plotter */}
      <main className="flex-grow mt-1">
        <iframe
          src="/wasm_app/hello_world_.html"  // Path to the HTML file in the public folder
          className="w-full h-full"
          style={{ border: "none" }}
          title="Property Plotter Web Tool"
        ></iframe>
      </main>

      {/* Pop-up Message */}
      {showPopup && (
        <div className="fixed top-4 right-4 bg-black p-4 border border-gray-300 rounded shadow-lg">
          <p className="text-sm">Don't forget to bookmark this page for easy access!</p>
          <button
            onClick={closePopup}
            className="mt-2 text-blue-500 text-xs hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

