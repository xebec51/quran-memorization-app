import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-55",
        variant === "primary" &&
          "bg-[var(--primary)] text-white hover:brightness-95",
        variant === "secondary" &&
          "border border-[var(--border)] bg-white text-[var(--foreground)] hover:bg-slate-50",
        variant === "ghost" && "text-[var(--foreground)] hover:bg-slate-100",
        variant === "danger" &&
          "bg-[var(--danger)] text-white hover:brightness-95",
        className
      )}
      {...props}
    />
  );
}
