import { expect, type Page, test } from "@playwright/test";

test("critical memorization flow", async ({
  page,
  request,
  context
}, testInfo) => {
  // Revealing through the entire boundary page (not just the primary page)
  // for all 4 questions is real additional work versus the old, shorter
  // (buggy) boundary - give this room accordingly.
  test.setTimeout(240_000);
  const email = `e2e-${testInfo.project.name}-${Date.now()}@example.com`;
  const password = "e2e-password-123";

  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Tasmiq — Latihan Musabaqah Hifzhil Qur'an"
    })
  ).toBeVisible();

  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Buat Akun" })).toBeVisible();
  await page.getByLabel("Nama").fill("E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(password);

  const register = await request.post("/api/auth/register", {
    data: { email, password, name: "E2E" }
  });
  expect(register.ok()).toBe(true);
  const cookieHeader = register.headers()["set-cookie"];
  expect(cookieHeader).toBeTruthy();
  const [nameValue] = cookieHeader.split(";");
  const separatorIndex = nameValue.indexOf("=");
  await context.addCookies([
    {
      name: nameValue.slice(0, separatorIndex),
      value: nameValue.slice(separatorIndex + 1),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    }
  ]);

  await page.goto("/memorization");
  await page
    .getByRole("button", { name: "Mulai latihan" })
    .click({ timeout: 30_000 });

  await expect(page.getByText(/Paket 1/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Pertanyaan").getByRole("button")).toHaveCount(
    4
  );

  // Grading is gated on a complete reveal - there is no "grade early"
  // shortcut anymore, so "Evaluasi jawaban" must not be visible yet.
  await expect(page.getByText("Evaluasi jawaban")).toHaveCount(0);

  // Question 1: exercise every hint type (independent of reveal progress),
  // then reveal fully and grade "Benar".
  await page.getByRole("button", { name: "Juz" }).click();
  await expect(page.getByText(/Petunjuk Juz/)).toBeVisible();

  await page.getByRole("button", { name: "Surah" }).click();
  await expect(page.getByText(/Petunjuk Surah/)).toBeVisible();

  await page.getByRole("button", { name: "Tambah" }).click();
  await expect(page.getByText(/Fragmen/)).toBeVisible();

  // While attempting to switch to another question before this one's
  // reveal is complete is disallowed: the other question buttons are
  // disabled.
  await expect(
    page.getByLabel("Pertanyaan").getByRole("button", { name: /^Soal 2/ })
  ).toBeDisabled();

  // Progressive reveal: first click shows exactly ayah 1, staying visible
  // as later clicks accumulate more.
  await page.getByRole("button", { name: "Lihat Ayat Pertama" }).click();
  await expect(page.getByText(/Ayat 1\/\d+ terbuka/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Lihat Ayat Berikutnya" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Lihat Ayat Berikutnya" }).click();
  await expect(page.getByText(/Ayat 2\/\d+ terbuka/)).toBeVisible();

  // Reveal is only partial here - grading must still be unavailable, both
  // visually and (proven separately in reveal.spec.ts) server-side.
  await expect(page.getByText("Evaluasi jawaban")).toHaveCount(0);

  await revealFully(page);
  await expect(page.getByText("Evaluasi jawaban")).toBeVisible();
  await submitBelTuntun(page, 0, 0);
  await expect(
    page.getByRole("heading", { name: "Latihan Expert" })
  ).toBeVisible();

  // Questions 2-4: reveal fully then submit bel/tuntun counts - 0/0
  // derives to CORRECT, anything else derives to MISSED (see
  // lib/memorization/assessment.ts's deriveAssessment).
  await revealFully(page);
  await expect(page.getByText("Evaluasi jawaban")).toBeVisible();
  await submitBelTuntun(page, 1, 0);
  await expect(
    page.getByRole("heading", { name: "Latihan Expert" })
  ).toBeVisible();

  await revealFully(page);
  await expect(page.getByText("Evaluasi jawaban")).toBeVisible();
  await submitBelTuntun(page, 0, 0);

  await revealFully(page);
  await expect(page.getByText("Evaluasi jawaban")).toBeVisible();
  await submitBelTuntun(page, 0, 2);
  await expect(
    page.getByRole("heading", { name: "Paket selesai" })
  ).toBeVisible();

  // The assessment button triggers a fire-and-forget keepalive fetch (the
  // UI updates optimistically before the server confirms), so navigating
  // to /evaluation right after seeing "Paket selesai" can race the actual
  // write landing. Poll the API directly (shares the session cookie with
  // the page via context.addCookies above) until it does, instead of
  // trusting client-side network-event timing.
  await expect(async () => {
    const bank = await request.get("/api/evaluation/bank");
    const body = (await bank.json()) as {
      data: { items: { questionId: string }[]; nextCursor: string | null };
    };
    expect(body.data.items).toHaveLength(2);
  }).toPass({ timeout: 15_000 });

  await page.goto("/evaluation");
  await expect(
    page.getByRole("heading", { name: "Latihan Evaluasi" })
  ).toBeVisible();
  // Both the PARTIAL and the MISSED question from this run belong in the
  // evaluation bank. The bank is paginated (no total count in the
  // heading, since a loaded-page count would be misleading once there
  // are more pages than are currently fetched) - assert on the actual
  // rendered items instead.
  await expect(
    page.getByRole("heading", { name: "Bank Evaluasi" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Latih soal (belum ingat|sebagian benar)/
    })
  ).toHaveCount(2);

  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "Analitik" })).toBeVisible();

  await page.goto("/history");
  await expect(
    page.getByRole("heading", { name: "Riwayat Latihan" })
  ).toBeVisible();
  await expect(page.getByText("Selesai")).toBeVisible();

  // Opening a history entry reveals the fragment and the full answer for
  // an already-assessed question - all 4 questions in this run were
  // assessed, so the first <summary> is guaranteed to expand into real
  // content, not the "belum dinilai" fallback. Scoped to this one
  // <details> element throughout: a closed <details> still keeps its
  // content in the DOM (native browser behavior, just visually hidden),
  // so an unscoped page-wide getByText matches every question's
  // "Jawaban (N ayat):" text regardless of which one is actually open.
  const soal1History = page.locator("details", { hasText: "Soal 1:" }).first();
  await soal1History.locator("summary").click();
  await expect(soal1History.locator(".quran-text").first()).toBeVisible();
  await expect(soal1History.getByText(/^Jawaban \(\d+ ayat\):/)).toBeVisible();

  await page.goto("/reader");
  await expect(page.getByRole("heading", { name: "Mushaf" })).toBeVisible();
  await page.getByRole("button", { name: "Buka" }).click();
  await expect(page.locator(".quran-text").first()).toBeVisible();
});

test("'Soal selesai dijawab' reveals everything and opens grading without manual per-ayah clicks", async ({
  page,
  request,
  context
}, testInfo) => {
  test.setTimeout(120_000);
  const email = `e2e-finish-${testInfo.project.name}-${Date.now()}@example.com`;
  const password = "e2e-password-123";

  const register = await request.post("/api/auth/register", {
    data: { email, password, name: "E2E Finish" }
  });
  expect(register.ok()).toBe(true);
  const cookieHeader = register.headers()["set-cookie"];
  const [nameValue] = cookieHeader.split(";");
  const separatorIndex = nameValue.indexOf("=");
  await context.addCookies([
    {
      name: nameValue.slice(0, separatorIndex),
      value: nameValue.slice(separatorIndex + 1),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    }
  ]);

  await page.goto("/memorization");
  await page
    .getByRole("button", { name: "Mulai latihan" })
    .click({ timeout: 30_000 });
  await expect(page.getByText(/Paket 1/)).toBeVisible({ timeout: 30_000 });

  // Available immediately, before any ayah has been opened - no manual
  // "Lihat Ayat Pertama" click first.
  await expect(
    page.getByRole("button", { name: "Lihat Ayat Pertama" })
  ).toBeVisible();
  const finishButton = page.getByRole("button", {
    name: "Soal selesai dijawab"
  });
  await expect(finishButton).toBeVisible();
  await finishButton.click();

  // The gate is unchanged - grading only appears once reveal is
  // genuinely complete, it's just reached via one click instead of many.
  await expect(page.getByText("Evaluasi jawaban")).toBeVisible({
    timeout: 60_000
  });
  await expect(
    page.getByText(/^Ayat \d+\/\d+ terbuka - halaman/)
  ).toBeVisible();

  await submitBelTuntun(page, 0, 0);
  await expect(
    page.getByRole("heading", { name: "Latihan Expert" })
  ).toBeVisible();
});

/** Fills the bel/tuntun inputs and submits the assessment form. */
async function submitBelTuntun(
  page: Page,
  belCount: number,
  tuntunCount: number
) {
  await page.getByLabel("Jumlah bel").fill(String(belCount));
  await page.getByLabel("Jumlah tuntun").fill(String(tuntunCount));
  await page.getByRole("button", { name: "Simpan evaluasi" }).click();
}

/**
 * Clicks the reveal button repeatedly until "Evaluasi jawaban" appears -
 * the panel only shows once reveal.isComplete (see
 * components/memorization/memorization-app.tsx). Waits for the button to
 * be back in its stable "Lihat Ayat ..." label before each click, rather
 * than just checking its presence: while a reveal request is in flight
 * the label briefly reads "Membuka...", which would otherwise make a
 * bare count()-based loop mistake an in-flight request for completion
 * and exit early.
 */
async function revealFully(page: Page) {
  const gradingPanel = page.getByText("Evaluasi jawaban");
  const revealButton = page.getByRole("button", {
    name: /^Lihat Ayat (Pertama|Berikutnya)$/
  });
  let guard = 0;
  while (guard < 60) {
    if ((await gradingPanel.count()) > 0) return;
    try {
      await expect(revealButton).toBeVisible({ timeout: 10_000 });
    } catch {
      // The last reveal click may have completed the boundary between the
      // two checks above (transitioning straight from "Membuka..." to the
      // grading panel) - re-check before treating this as a real failure.
      if ((await gradingPanel.count()) > 0) return;
      throw new Error(
        "revealFully: neither the reveal button nor the grading panel is present"
      );
    }
    await revealButton.click();
    guard += 1;
  }
  throw new Error("revealFully did not reach completion within 60 clicks");
}
