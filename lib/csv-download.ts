// On iOS PWA (standalone mode) the anchor download hijacks the only window and
// leaves the user stuck in a full-screen file preview. Opening a _blank tab
// instead gives them a dismissible preview. Every other platform gets a normal
// anchor download.
function isIosPwa(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function downloadCSV(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  if (isIosPwa()) {
    window.open(url, "_blank");
    // Revoke after a short delay so the new tab has time to load the blob.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } else {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
