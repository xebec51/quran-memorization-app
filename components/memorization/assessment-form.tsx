"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Objective MHQ-style scoring instead of a subjective three-way choice:
 * the user reports how many bel (bell rings) and tuntun (prompts) the
 * recitation needed. Zero of both derives to CORRECT server-side (see
 * lib/memorization/assessment.ts's deriveAssessment); anything else
 * derives to MISSED and the question becomes eligible for evaluation
 * practice - there is no separate "grade" choice to make here.
 *
 * Shared by the main memorization flow (components/memorization/
 * memorization-app.tsx) and evaluation practice mode
 * (components/evaluation/evaluation-app.tsx) so the two grading UIs can
 * never drift apart the way the old three-button grading form and this
 * bel/tuntun form once did.
 */
export function AssessmentForm({
  onAssess,
  pending = false
}: {
  onAssess: (belCount: number, tuntunCount: number) => void;
  pending?: boolean;
}) {
  const [belCount, setBelCount] = useState("0");
  const [tuntunCount, setTuntunCount] = useState("0");
  const [validationError, setValidationError] = useState<string | null>(null);

  function submit() {
    const parsedBel = Number.parseInt(belCount, 10);
    const parsedTuntun = Number.parseInt(tuntunCount, 10);
    if (!Number.isInteger(parsedBel) || parsedBel < 0) {
      setValidationError("Jumlah bel harus bilangan bulat 0 atau lebih.");
      return;
    }
    if (!Number.isInteger(parsedTuntun) || parsedTuntun < 0) {
      setValidationError("Jumlah tuntun harus bilangan bulat 0 atau lebih.");
      return;
    }
    setValidationError(null);
    onAssess(parsedBel, parsedTuntun);
  }

  return (
    <div className="grid gap-3">
      {validationError ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {validationError}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium">
          Jumlah bel
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={belCount}
            onChange={(event) => setBelCount(event.target.value)}
            aria-invalid={validationError ? true : undefined}
            className="min-h-11 rounded-md border border-[var(--border)] px-3 py-2"
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Jumlah tuntun
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={tuntunCount}
            onChange={(event) => setTuntunCount(event.target.value)}
            aria-invalid={validationError ? true : undefined}
            className="min-h-11 rounded-md border border-[var(--border)] px-3 py-2"
          />
        </label>
      </div>
      <Button onClick={submit} disabled={pending}>
        <CheckCircle2 aria-hidden className="h-4 w-4" />{" "}
        {pending ? "Menyimpan..." : "Simpan evaluasi"}
      </Button>
    </div>
  );
}

/**
 * Shown the instant a reveal click fires (pending state flips
 * synchronously before the network call even starts), right where the
 * incoming ayah will render - the real content still only ever arrives
 * from the server (it cannot be shown before the server confirms it,
 * without leaking the hidden answer to the client early), but this makes
 * the click itself feel immediate instead of doing nothing until the
 * round trip resolves.
 */
export function RevealSkeletonRow() {
  return (
    <div className="grid animate-pulse gap-2" aria-hidden>
      <div className="h-3 w-40 rounded bg-slate-200" />
      <div className="ml-auto h-8 w-4/5 rounded bg-slate-200" />
    </div>
  );
}
