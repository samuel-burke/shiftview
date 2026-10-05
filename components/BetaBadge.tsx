// Small "Beta" pill shown next to the ShiftView wordmark while the product is
// in public beta. Remove the component's usages to drop the label everywhere.
export default function BetaBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`ml-2 inline-flex items-center rounded-full border border-slate-700 px-1.5 py-px align-middle text-[10px] font-semibold uppercase leading-[14px] tracking-wider text-slate-400 ${className}`}
    >
      Beta
    </span>
  );
}
