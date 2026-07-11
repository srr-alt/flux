import type { ButtonHTMLAttributes } from "react";
import { RefreshCw } from "lucide-react";

/** Icon size rule of thumb across the app: 11-12px inside sm/text-xs
 * contexts, 13-14px inside md buttons and panel chrome, 15px sidebar nav,
 * 20px EmptyState. */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "soft" | "secondary" | "ghost" | "danger" | "dangerSoft";
  size?: "sm" | "md";
  /** Shows a spinner and disables the button. */
  loading?: boolean;
}

const VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-series-1 font-medium text-white hover:bg-series-1/85",
  soft: "bg-series-1/15 font-medium text-series-1 hover:bg-series-1/25",
  secondary: "border border-border text-ink-secondary hover:bg-white/10 hover:text-ink-primary",
  ghost: "text-ink-secondary hover:bg-white/10 hover:text-ink-primary",
  danger: "bg-status-critical font-medium text-white hover:bg-status-critical/85",
  dangerSoft: "text-status-critical hover:bg-status-critical/15",
};

const SIZES: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md transition-colors duration-100 disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading && <RefreshCw size={size === "sm" ? 11 : 13} className="animate-spin" />}
      {children}
    </button>
  );
}
