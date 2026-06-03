// On iOS PWA (standalone mode), the standard anchor-click download causes a
// full-screen file preview with no way back. Using the Web Share API instead
// shows the native share sheet, which is dismissible. Falls back to the
// traditional anchor download on platforms that don't support file sharing.
export async function downloadCSV(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: "text/csv" });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: filename });
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
