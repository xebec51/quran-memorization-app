import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { authFormErrorMessage } from "@/lib/auth/form-error";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="pb-20">
      <AuthForm mode="login" error={authFormErrorMessage(error)} />
      <p className="mt-4 text-center text-sm text-[var(--muted)]">
        Belum punya akun? <Link className="font-medium text-[var(--primary)]" href="/register">Daftar</Link>
      </p>
    </div>
  );
}
