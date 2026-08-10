import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";

export default function RegisterPage() {
  return (
    <div className="pb-20">
      <AuthForm mode="register" />
      <p className="mt-4 text-center text-sm text-[var(--muted)]">
        Sudah punya akun? <Link className="font-medium text-[var(--primary)]" href="/login">Masuk</Link>
      </p>
    </div>
  );
}
