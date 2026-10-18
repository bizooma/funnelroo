import { forwardRef } from "react";
import PersonaCard from "./PersonaCard";

// PersonaExportRoot: the card rendered in a fixed ~1100px landscape composition
// for PDF capture and print. The `.persona-export` class (index.css) forces the
// reference 3-column (or 2-column when there is no right column) grid regardless
// of the browser viewport, so capture and print never stack columns.
function PersonaExportRoot({ data, meta }, ref) {
  return (
    <div ref={ref} className="persona-export" style={{ width: 1100, background: "#ffffff" }}>
      <PersonaCard data={data} meta={meta} />
    </div>
  );
}

export default forwardRef(PersonaExportRoot);