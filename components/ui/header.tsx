"use client";

import Link from "next/link";
import Logo from "./logo";

export default function Header() {
  return (
    <header className="z-30 h-full w-28 fixed top-0 left-0 border-r border-gray-700">
      <div className="flex flex-col h-full bg-black-800 shadow-lg">
        {/* Site branding */}
        <div className="w-full flex items-center justify-center border-b border-gray-700 py-6">
          <div className="w-10 h-10 flex items-center justify-center">
            <Logo />
          </div>
        </div>

        {/* Navigation links */}
        <ul className="flex flex-col flex-1 items-center w-full mt-4">
          <li className="w-full">
            <Link
              href="/propertyplotter"
              className="block w-full text-center py-3 font-semibold text-gray-100 bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 border-t border-b border-gray-700 transition-all hover:text-white"
            >
              ThermoPlot
            </Link>
          </li>
          {/* Additional links can be added here */}
        </ul>
      </div>
    </header>
  );
}
