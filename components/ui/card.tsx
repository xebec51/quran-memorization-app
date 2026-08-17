import { cn } from "@/lib/utils";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={cn(
        "rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm",
        className
      )}
      {...props}
    />
  );
}
