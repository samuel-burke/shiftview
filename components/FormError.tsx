// A form's error line, with its line always reserved: the form keeps its
// height when a message shows or clears, so nothing under it jumps. (A
// message longer than one line still wraps.) The alert itself is only in the
// page while there's a message, which is when screen readers announce it.
export default function FormError({
  id,
  message,
  size = "xs",
  className = "",
}: {
  id?: string;
  message: React.ReactNode;
  size?: "xs" | "sm";
  className?: string;
}) {
  const text = size === "sm" ? "min-h-5 text-sm leading-5" : "min-h-4 text-xs leading-4";
  return (
    <div className={`${text} text-red-400 ${className}`}>
      {message ? <div id={id} role="alert">{message}</div> : null}
    </div>
  );
}
