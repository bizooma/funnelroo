import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

// US Letter landscape, 11 x 8.5 in, in PDF points (1 in = 72 pt).
const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 18; // 0.25 in
const CONTENT_W = PAGE_W - MARGIN * 2; // 756 pt
const CONTENT_H = PAGE_H - MARGIN * 2; // 576 pt
const EXPORT_WIDTH = 1100; // logical px width of the export card
const CAPTURE_SCALE = 3; // ~3x for crisp text (resolution only; not a substitute for larger final text)
const TARGET_BODY_PT = 10;
const TARGET_CAPTION_PT = 8;

function slug(name) {
  return (name || "persona")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function decodeImage(img) {
  return new Promise((resolve) => {
    if (img.complete && img.naturalWidth > 0) return resolve();
    const done = () => resolve();
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
    // Don't block forever on a stuck image; the readiness check below reports it.
    setTimeout(done, 5000);
  });
}

async function waitForReady(rootEl) {
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  } catch {
    /* fonts.ready is best-effort */
  }
  const imgs = Array.from(rootEl.querySelectorAll("img"));
  await Promise.all(imgs.map(decodeImage));
}

function imagesOk(rootEl) {
  return Array.from(rootEl.querySelectorAll("img")).every(
    (img) => img.complete && img.naturalWidth > 0
  );
}

// Decide whether the card fits on one readable page, and at what scale. We
// measure the actual card width and height, compute the real
// PDF-points-per-logical-pixel scale, then read the export typography variables
// (set on .persona-export) to get the actual body and caption font sizes — not
// an assumed default. The card fits only if the final body and caption text
// meet the 10pt / 8pt targets at that scale.
function readVarPx(cs, name, fallback) {
  const v = parseFloat(cs.getPropertyValue(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function measureFit(rootEl) {
  const card = rootEl.querySelector(".persona-card") || rootEl;
  const cardWidthPx = card.offsetWidth || EXPORT_WIDTH;
  const cardHeightPx = card.offsetHeight || rootEl.offsetHeight || 0;
  const scale = Math.min(CONTENT_W / cardWidthPx, CONTENT_H / cardHeightPx);
  const cs = getComputedStyle(card);
  const bodyPx = readVarPx(cs, "--pc-body", 13);
  const captionPx = readVarPx(cs, "--pc-caption", 11);
  const finalBodyPt = bodyPx * scale;
  const finalCaptionPt = captionPx * scale;
  const fits =
    finalBodyPt >= TARGET_BODY_PT && finalCaptionPt >= TARGET_CAPTION_PT;
  return { fits, scale, cardHeightPx, finalBodyPt, finalCaptionPt };
}

async function capture(rootEl) {
  return html2canvas(rootEl, {
    scale: CAPTURE_SCALE,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
    windowWidth: 1280, // evaluate media queries against a wide viewport
    width: EXPORT_WIDTH,
    onclone: (doc) => {
      // The live portal is off-screen; reposition the clone's copy so the
      // capture renders the card at its natural origin.
      const el = /** @type {HTMLElement | null} */ (doc.querySelector(".persona-print-portal"));
      if (el) {
        el.style.position = "static";
        el.style.left = "auto";
        el.style.top = "auto";
        el.style.width = EXPORT_WIDTH + "px";
        el.style.opacity = "1";
        el.style.zIndex = "auto";
        el.style.pointerEvents = "auto";
      }
    },
  });
}

// Returns { overflow: true } when the card is too tall for one readable page
// (caller shows the overflow guidance instead of producing a cramped file).
// Throws on a capture/image failure so the caller can report it honestly.
export async function exportPersonaPdf(rootEl, name) {
  if (!rootEl) throw new Error("Card not ready");
  await waitForReady(rootEl);
  if (!imagesOk(rootEl)) {
    throw new Error("A card image failed to load. The PDF was not created.");
  }
  const fit = measureFit(rootEl);
  if (!fit.fits) {
    return { overflow: true };
  }
  const canvas = await capture(rootEl);
  if (!canvas || !canvas.width || !canvas.height) {
    throw new Error("Capture failed. The PDF was not created.");
  }
  const logicalW = canvas.width / CAPTURE_SCALE;
  const logicalH = canvas.height / CAPTURE_SCALE;
  const drawW = logicalW * fit.scale;
  const drawH = logicalH * fit.scale;
  const x = (PAGE_W - drawW) / 2;
  const y = (PAGE_H - drawH) / 2;

  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, 0, PAGE_W, PAGE_H, "F");
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", x, y, drawW, drawH, undefined, "FAST");
  pdf.save(`persona-${slug(name)}.pdf`);
  return { overflow: false };
}