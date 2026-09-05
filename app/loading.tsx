export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-6 motion-safe:animate-pulse"
    >
      <span className="sr-only">Memuat halaman...</span>
      <div className="space-y-3">
        <div className="h-8 w-48 rounded-md bg-slate-200" />
        <div className="h-4 w-full max-w-xl rounded bg-slate-100" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            aria-hidden
            className="h-28 rounded-xl border border-slate-200 bg-white"
          />
        ))}
      </div>
      <div
        aria-hidden
        className="h-64 rounded-xl border border-slate-200 bg-white"
      />
    </div>
  );
}
