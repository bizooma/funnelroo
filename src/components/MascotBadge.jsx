import React from "react";

// Shows the Roo mascot if uploaded, otherwise a friendly text placeholder.
// We never invent a replacement mascot — the user uploads the approved image.
/** @param {{ size?: number; src?: string; className?: string }} props */
export function MascotBadge({ size = 40, src, className = "" }) {
  if (src) {
    return (
      <img
        src={src}
        alt="Roo mascot"
        style={{ width: size, height: size }}
        className={`rounded-full object-cover ring-2 ring-white shadow-sm ${className}`}
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className={`rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center font-bold shadow-sm ${className}`}
    >
      R
    </div>
  );
}