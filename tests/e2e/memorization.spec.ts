import { expect, test } from "@playwright/test";

test("critical memorization flow", async ({ page, request, context }, testInfo) => {
  const email = `e2e-${testInfo.project.name}-${Date.now()}@example.com`;
  const password = "e2e-password-123";

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Quran Memorization" })).toBeVisible();

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
  await page.getByRole("button", { name: "Mulai latihan" }).click({ timeout: 30_000 });

  await expect(page.getByText(/Paket 1/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Pertanyaan").getByRole("button")).toHaveCount(4);

  await page.getByRole("button", { name: "Juz" }).click();
  await expect(page.getByText(/Petunjuk Juz/)).toBeVisible();

  await page.getByRole("button", { name: "Surah" }).click();
  await expect(page.getByText(/Petunjuk Surah/)).toBeVisible();

  await page.getByRole("button", { name: "Tambah" }).click();
  await expect(page.getByText(/Fragmen/)).toBeVisible();

  await page.getByRole("button", { name: "Ayat" }).click();
  await expect(page.getByText(/Ayat berikutnya/)).toBeVisible();

  await page.getByRole("button", { name: "Lihat Jawaban" }).click();
  await expect(page.getByText(/Halaman/)).toBeVisible();
  await page.getByRole("button", { name: "Sebagian benar" }).click();
  await expect(page.getByText(/Soal|Latihan Expert/)).toBeVisible();

  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "Analitik" })).toBeVisible();

  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "Riwayat Latihan" })).toBeVisible();

  await page.goto("/reader");
  await expect(page.getByRole("heading", { name: "Mushaf" })).toBeVisible();
  await page.getByRole("button", { name: "Buka" }).click();
  await expect(page.locator(".quran-text").first()).toBeVisible();
});
