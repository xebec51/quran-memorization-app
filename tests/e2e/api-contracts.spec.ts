import { expect, type APIRequestContext, test } from "@playwright/test";

test("public package DTO omits hidden answer metadata and allocation is POST-only", async ({
  request
}, testInfo) => {
  const { cookie } = await registerApiUser(request, testInfo.project.name);

  const getResponse = await request.get("/api/memorization/next-package", {
    headers: { cookie }
  });
  expect(getResponse.status()).toBe(405);

  const response = await request.post("/api/memorization/next-package", {
    headers: { cookie },
    data: {}
  });
  expect(response.ok()).toBe(true);
  expect(response.headers()["server-timing"]).toContain("auth_session");
  const body = (await response.json()) as {
    data: { questions: Record<string, unknown>[] };
  };
  const question = body.data.questions[0];

  expect(Object.keys(question).sort()).toEqual([
    "assessment",
    "availableHints",
    "fragmentText",
    "hints",
    "id",
    "order",
    "reveal",
    "totalQuestions"
  ]);
  expect(question).not.toHaveProperty("page");
  expect(question).not.toHaveProperty("juz");
  expect(question).not.toHaveProperty("surah");
  expect(question).not.toHaveProperty("anchorVerseId");
  expect(question).not.toHaveProperty("anchorVerseKey");

  // reveal carries only counts/verses actually opened so far - never the
  // unopened answer text (docs/memorization-engine.md "Hidden Metadata
  // Rule"). A freshly allocated question has revealed nothing yet.
  const reveal = question.reveal as {
    revealedAyahCount: number;
    totalAyahCount: number;
    isComplete: boolean;
    verses: unknown[];
  };
  expect(Object.keys(reveal).sort()).toEqual([
    "isComplete",
    "revealedAyahCount",
    "totalAyahCount",
    "verses"
  ]);
  expect(reveal.revealedAyahCount).toBe(0);
  expect(reveal.isComplete).toBe(false);
  expect(reveal.verses).toEqual([]);
  expect(reveal.totalAyahCount).toBeGreaterThan(0);
});

test("hint and assessment mutation responses stay minimal and idempotent", async ({
  request
}, testInfo) => {
  const { cookie, pkg } = await registerApiUser(request, testInfo.project.name);
  expect(pkg).not.toBeNull();
  const questionId = pkg!.questions[0].id;

  const hintResponse = await request.post("/api/memorization/hint", {
    headers: { cookie },
    data: { questionId, type: "JUZ" }
  });
  expect(hintResponse.ok()).toBe(true);
  const hintBody = (await hintResponse.json()) as {
    data: Record<string, unknown>;
  };
  expect(Object.keys(hintBody.data).sort()).toEqual([
    "availableHints",
    "hint",
    "hintCounts",
    "questionId"
  ]);
  expect(hintBody.data).not.toHaveProperty("question");

  // Assessment is gated on a complete reveal (submitAssessment rejects
  // otherwise with 409 REVEAL_INCOMPLETE) - reveal fully before grading.
  await revealFully(request, cookie, questionId);

  const firstAssessment = await request.post("/api/memorization/assessment", {
    headers: { cookie },
    data: { questionId, belCount: 0, tuntunCount: 0 }
  });
  expect(firstAssessment.ok()).toBe(true);
  expect(await firstAssessment.json()).toEqual({
    data: {
      questionId,
      assessment: "CORRECT",
      belCount: 0,
      tuntunCount: 0,
      packageCompleted: false
    }
  });

  const duplicateAssessment = await request.post(
    "/api/memorization/assessment",
    {
      headers: { cookie },
      data: { questionId, belCount: 0, tuntunCount: 0 }
    }
  );
  expect(duplicateAssessment.ok()).toBe(true);
  expect(await duplicateAssessment.json()).toEqual({
    data: {
      questionId,
      assessment: "CORRECT",
      belCount: 0,
      tuntunCount: 0,
      packageCompleted: false
    }
  });

  // An assessment is immutable once saved: a resubmission with a
  // DIFFERENT bel/tuntun pair must conflict, not silently overwrite
  // graded history.
  const conflictingAssessment = await request.post(
    "/api/memorization/assessment",
    {
      headers: { cookie },
      data: { questionId, belCount: 1, tuntunCount: 0 }
    }
  );
  expect(conflictingAssessment.status()).toBe(409);
});

test("concurrent package allocation returns one in-progress package", async ({
  request
}, testInfo) => {
  const { cookie } = await registerApiUser(
    request,
    `${testInfo.project.name}-concurrent`,
    false
  );

  const [left, right] = await Promise.all([
    request.post("/api/memorization/next-package", {
      headers: { cookie },
      data: {}
    }),
    request.post("/api/memorization/next-package", {
      headers: { cookie },
      data: {}
    })
  ]);
  expect(left.ok()).toBe(true);
  expect(right.ok()).toBe(true);

  const leftBody = (await left.json()) as {
    data: { id: string; questions: unknown[] };
  };
  const rightBody = (await right.json()) as {
    data: { id: string; questions: unknown[] };
  };
  expect(leftBody.data.id).toBe(rightBody.data.id);
  expect(leftBody.data.questions).toHaveLength(4);
  expect(rightBody.data.questions).toHaveLength(4);
});

async function revealFully(
  request: APIRequestContext,
  cookie: string,
  questionId: string
) {
  let count = 0;
  while (true) {
    const response = await request.post("/api/memorization/reveal", {
      headers: { cookie },
      data: { questionId, expectedRevealedCount: count }
    });
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { data: { isComplete: boolean } };
    count += 1;
    if (body.data.isComplete) return;
  }
}

async function registerApiUser(
  request: APIRequestContext,
  label: string,
  allocatePackage = true
) {
  const email = `api-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const register = await request.post("/api/auth/register", {
    data: { email, password: "e2e-password-123", name: "API" }
  });
  expect(register.ok()).toBe(true);
  const cookieHeader = register.headers()["set-cookie"];
  expect(cookieHeader).toBeTruthy();
  const [cookie] = cookieHeader.split(";");
  if (!allocatePackage) return { cookie, pkg: null };

  const packageResponse = await request.post("/api/memorization/next-package", {
    headers: { cookie },
    data: {}
  });
  expect(packageResponse.ok()).toBe(true);
  const packageBody = (await packageResponse.json()) as {
    data: { id: string; questions: { id: string }[] };
  };
  return { cookie, pkg: packageBody.data };
}
