import { expect, test } from "@playwright/test";

test("critical memorization flow", async ({
  page,
  request,
  context
}, testInfo) => {
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
  await expect(
    page.getByRole("button", { name: "Soal selesai dijawab" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Soal selesai dijawab" }).click();
  await expect(page.getByText("Evaluasi jawaban")).toBeVisible();
  await page.getByRole("button", { name: "Benar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Latihan Expert" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Juz" }).click();
  await expect(page.getByText(/Petunjuk Juz/)).toBeVisible();

  await page.getByRole("button", { name: "Surah" }).click();
  await expect(page.getByText(/Petunjuk Surah/)).toBeVisible();

  await page.getByRole("button", { name: "Tambah" }).click();
  await expect(page.getByText(/Fragmen/)).toBeVisible();

  await page.getByRole("button", { name: "Ayat", exact: true }).click();
  await expect(page.getByText(/Ayat berikutnya/)).toBeVisible();

  // Progressive reveal: first click shows exactly ayah 1, staying visible
  // as later clicks accumulate more, per docs/memorization-engine.md
  // "Progressive Reveal".
  await page.getByRole("button", { name: "Lihat Ayat Pertama" }).click();
  await expect(page.getByText(/Ayat 1\/\d+ terbuka/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Lihat Ayat Berikutnya" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Lihat Ayat Berikutnya" }).click();
  await expect(page.getByText(/Ayat 2\/\d+ terbuka/)).toBeVisible();

  // Reveal is only partial here, so the assessment panel isn't shown
  // automatically yet - the independent "sudah cukup, nilai sekarang" path
  // opens it explicitly.
  await page.getByRole("button", { name: "Soal selesai dijawab" }).click();
  await expect(page.getByText("Evaluasi jawaban")).toBeVisible();
  await page.getByRole("button", { name: "Sebagian benar" }).click();
  await expect(
    page.getByRole("heading", { name: "Latihan Expert" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Soal selesai dijawab" }).click();
  await expect(page.getByText("Evaluasi jawaban")).toBeVisible();
  await page.getByRole("button", { name: "Benar", exact: true }).click();

  await page.getByRole("button", { name: "Soal selesai dijawab" }).click();
  await expect(page.getByText("Evaluasi jawaban")).toBeVisible();
  await page.getByRole("button", { name: "Belum ingat" }).click();
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
    const body = (await bank.json()) as { data: { questionId: string }[] };
    expect(body.data).toHaveLength(2);
  }).toPass({ timeout: 15_000 });

  await page.goto("/evaluation");
  await expect(
    page.getByRole("heading", { name: "Latihan Evaluasi" })
  ).toBeVisible();
  // Both the PARTIAL and the MISSED question from this run belong in the
  // evaluation bank.
  await expect(page.getByText("Bank Evaluasi (2)")).toBeVisible();

  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "Analitik" })).toBeVisible();

  await page.goto("/history");
  await expect(
    page.getByRole("heading", { name: "Riwayat Latihan" })
  ).toBeVisible();
  await expect(page.getByText("Selesai")).toBeVisible();

  await page.goto("/reader");
  await expect(page.getByRole("heading", { name: "Mushaf" })).toBeVisible();
  await page.getByRole("button", { name: "Buka" }).click();
  await expect(page.locator(".quran-text").first()).toBeVisible();
});
