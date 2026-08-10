import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";

export default function LoginPage() {
  return (
    <div className="pb-20">
      <AuthForm mode="login" />
      <p className="mt-4 text-center text-sm text-[var(--muted)]">
        Belum punya akun? <Link className="font-medium text-[var(--primary)]" href="/register">Daftar</Link>
      </p>
    </div>
  );
}
