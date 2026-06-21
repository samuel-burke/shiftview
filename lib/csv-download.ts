// File-download helpers that work on iOS Safari (tab and installed PWA) as well
// as desktop.
//
// Two iOS pitfalls this avoids:
//  1. Revoking the object URL synchronously after click() leaves Safari on a
//     blank/white screen, because the blob is gone before it is read. We defer
//     the revoke instead.
//  2. window.open() after an awaited fetch is blocked by iOS (it is no longer a
//     user gesture), which also showed up as a stuck blank tab. A programmatic
//     anchor click is not gated that way, so we always use an anchor.
//
// The anchor must be attached to the document for the click to register on iOS.

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** Download a client-built blob (e.g. a CSV assembled in the browser). */
export function downloadCSV(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  // Give the browser time to read the blob before releasing it. Revoking
  // immediately is what left iOS Safari on a white screen.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Download a file straight from a same-origin URL — e.g. a server export
 * endpoint that sets Content-Disposition. No fetch/blob round-trip, so there is
 * no awaited gesture to lose and nothing to revoke.
 */
export function downloadFromUrl(url: string, filename: string): void {
  triggerDownload(url, filename);
}
