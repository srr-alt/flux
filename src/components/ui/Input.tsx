import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

/** Canonical field styling: recessed against bg-surface panels, accent
 * border on focus (the global :focus-visible outline covers keyboard nav). */
const BASE =
  "rounded-xl border border-white/10 bg-page px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted transition-colors duration-100 focus:border-series-1 focus:outline-none";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Leading icon rendered inside the field. */
  icon?: LucideIcon;
}

export function Input({ icon: Icon, className = "", ...rest }: InputProps) {
  if (!Icon) {
    return <input className={`${BASE} ${className}`} {...rest} />;
  }
  return (
    <div className={`relative ${className}`}>
      <Icon
        size={13}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
      />
      <input className={`${BASE} w-full pl-8`} {...rest} />
    </div>
  );
}

export function Textarea({
  className = "",
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${BASE} ${className}`} {...rest} />;
}
