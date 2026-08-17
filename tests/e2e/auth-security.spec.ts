import { expect, test, type TestInfo } from "@playwright/test";

/**
 * A unique synthetic x-forwarded-for value per (project, scenario, run),
 * drawn from TEST-NET-3 (203.0.113.0/24, RFC 5737 - reserved for
 * documentation/testing, never a real routable address). Local `next dev`
 * has no real proxy in front of it, so clientIp() (lib/auth/rate-limit.ts)
 * reads whatever a client sends directly - this is what lets each
 * rate-limit-sensitive scenario get its own per-IP counter without ever
 * touching the production LOGIN_IP_MAX_ATTEMPTS threshold, and without
 * chromium/mobile or repeated local runs polluting each other's counters
 * (Date.now()/Math.random() in the seed means a rerun within the same
 * 10-minute window still gets a fresh address instead of reusing stale
 * AuthRateLimit rows from a prior run).
 */
function testNetIp(testInfo: TestInfo, scenario: string): string {
  const seed = `${testInfo.project.name}:${scenario}:${Date.now()}:${Math.random()}`;
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `203.0.113.${1 + (hash % 254)}`;
}

test("malformed JSON returns 400, not 500, across API routes", async ({
  request
}, testInfo) => {
  const headers = { "x-forwarded-for": testNetIp(testInfo, "malformed-json") };
  // A Buffer body is sent as the exact raw bytes given - a string `data`
  // value is NOT sent verbatim (Playwright JSON.stringifies it even when
  // it's already a string, e.g. "{not valid json" becomes the 17-byte
  // JSON document "\"{not valid json\"" - a valid JSON *string*, which
  // parses fine and only fails the object-shape check downstream). A
  // Buffer is the only `data` type that reaches the server as genuinely
  // malformed bytes.
  const registerResponse = await request.post("/api/auth/register", {
    headers: { "content-type": "application/json", ...headers },
    data: Buffer.from("{not valid json")
  });
  expect(registerResponse.status()).toBe(400);
  expect((await registerResponse.json()).error.code).toBe("MALFORMED_JSON");

  const loginResponse = await request.post("/api/auth/login", {
    headers: { "content-type": "application/json", ...headers },
    data: Buffer.from("[unterminated")
  });
  expect(loginResponse.status()).toBe(400);
});

test("duplicate email registration returns 409 with a safe message", async ({
  request
}, testInfo) => {
  const headers = { "x-forwarded-for": testNetIp(testInfo, "duplicate-email") };
  const email = `dup-${testInfo.project.name}-${Date.now()}@example.com`;
  const first = await request.post("/api/auth/register", {
    headers,
    data: { email, password: "e2e-password-123", name: "First" }
  });
  expect(first.ok()).toBe(true);

  const second = await request.post("/api/auth/register", {
    headers,
    data: { email, password: "a-different-password-456", name: "Second" }
  });
  expect(second.status()).toBe(409);
  const body = (await second.json()) as {
    error: { code: string; message: string };
  };
  // Safe = does not confirm/deny anything beyond "this request conflicts" -
  // no password hash, no internal id, no stack trace.
  expect(body.error.code).toBeTruthy();
  expect(body.error.message).not.toMatch(/hash|stack|prisma|internal/i);
});

test("many wrong-password attempts against one account never block that account's own correct login", async ({
  request
}, testInfo) => {
  const headers = {
    "x-forwarded-for": testNetIp(testInfo, "many-wrong-attempts")
  };
  const email = `victim-${testInfo.project.name}-${Date.now()}@example.com`;
  const realPassword = "the-real-password-123";
  const register = await request.post("/api/auth/register", {
    headers,
    data: { email, password: realPassword, name: "Victim" }
  });
  expect(register.ok()).toBe(true);

  // Deliberately more than LOGIN_ACCOUNT_MAX_FAILURES (10) wrong guesses -
  // simulates an attacker who only knows the victim's email. Each
  // response is either 401 (still under the account threshold) or 429
  // (over it) - both are the account counter doing its job correctly;
  // this loop's purpose is just to reliably cross the threshold before
  // the real assertion below. This IP is dedicated to this one test (see
  // testNetIp), so these 12 attempts alone can never spuriously trip
  // LOGIN_IP_MAX_ATTEMPTS (60) meant for genuine flood protection.
  for (let i = 0; i < 12; i += 1) {
    const attempt = await request.post("/api/auth/login", {
      headers,
      data: { email, password: `wrong-guess-${i}` }
    });
    expect([401, 429]).toContain(attempt.status());
  }

  const realLogin = await request.post("/api/auth/login", {
    headers,
    data: { email, password: realPassword }
  });
  expect(realLogin.ok()).toBe(true);
  expect(realLogin.status()).toBe(200);
});

test("a successful login resets the account's failure counter", async ({
  request
}, testInfo) => {
  const headers = {
    "x-forwarded-for": testNetIp(testInfo, "reset-failure-counter")
  };
  const email = `reset-${testInfo.project.name}-${Date.now()}@example.com`;
  const realPassword = "the-real-password-456";
  await request.post("/api/auth/register", {
    headers,
    data: { email, password: realPassword, name: "Reset" }
  });

  // 9 failures - just under the 10-failure threshold, so this account is
  // not yet blocked. credentialsSchema requires password.min(10), so
  // these must clear that length or they get rejected by validation
  // (422) before ever reaching the credential check this test verifies.
  for (let i = 0; i < 9; i += 1) {
    const attempt = await request.post("/api/auth/login", {
      headers,
      data: { email, password: `wrong-password-${i}` }
    });
    expect(attempt.status()).toBe(401);
  }

  // Succeeding must clear those 9 failures, not just avoid adding to them.
  const success = await request.post("/api/auth/login", {
    headers,
    data: { email, password: realPassword }
  });
  expect(success.ok()).toBe(true);

  // If the counter had NOT reset, 9 (pre) + 9 (post) = 18 would already be
  // well past the threshold of 10, and this loop would start seeing 429
  // long before the 9th iteration. If it DID reset, all 9 stay 401. This
  // test's dedicated IP (18 login attempts total) also stays comfortably
  // under the production LOGIN_IP_MAX_ATTEMPTS of 60 on its own.
  for (let i = 0; i < 9; i += 1) {
    const attempt = await request.post("/api/auth/login", {
      headers,
      data: { email, password: `wrong-password-again-${i}` }
    });
    expect(attempt.status()).toBe(401);
  }
});
