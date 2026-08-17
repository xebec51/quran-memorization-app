import { LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { productConfig } from "@/lib/config";

export function AuthForm({
  mode,
  error
}: {
  mode: "login" | "register";
  error?: string | null;
}) {
  return (
    <Card className="mx-auto max-w-md">
      <p className="mb-2 text-sm font-medium text-[var(--primary)]">
        {productConfig.name}
      </p>
      <h1 className="text-2xl font-semibold">
        {mode === "login" ? "Masuk" : "Buat Akun"}
      </h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {productConfig.tagline}
      </p>
      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {error}
        </p>
      ) : null}
      <form
        action={`/api/auth/${mode}`}
        method="post"
        className="mt-5 grid gap-4"
      >
        {mode === "register" ? (
          <label className="grid gap-1 text-sm font-medium">
            Nama
            <input
              name="name"
              className="rounded-md border border-[var(--border)] px-3 py-2"
              autoComplete="name"
            />
          </label>
        ) : null}
        <label className="grid gap-1 text-sm font-medium">
          Email
          <input
            name="email"
            type="email"
            required
            className="rounded-md border border-[var(--border)] px-3 py-2"
            autoComplete="email"
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Kata sandi
          <input
            name="password"
            type="password"
            required
            minLength={10}
            className="rounded-md border border-[var(--border)] px-3 py-2"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
          />
        </label>
        <Button type="submit">
          {mode === "login" ? (
            <LogIn aria-hidden className="h-4 w-4" />
          ) : (
            <UserPlus aria-hidden className="h-4 w-4" />
          )}
          {mode === "login" ? "Masuk" : "Daftar"}
        </Button>
      </form>
    </Card>
  );
}
