import { expect, type APIRequestContext, test } from "@playwright/test";

type RevealBody = {
  questionId: string;
  revealedAyahCount: number;
  totalAyahCount: number;
  isComplete: boolean;
  verses: { verseKey: string; text: string }[];
};

async function reveal(
  request: APIRequestContext,
  cookie: string,
  questionId: string,
  expectedRevealedCount: number
) {
  const response = await request.post("/api/memorization/reveal", {
    headers: { cookie },
    data: { questionId, expectedRevealedCount }
  });
  const json = (await response.json()) as { data: RevealBody };
  return { response, body: json.data };
}

test("progressive reveal accumulates ayahs one at a time and completes at the page boundary", async ({
  request
}, testInfo) => {
  const { cookie, pkg } = await registerApiUser(request, testInfo.project.name);
  const question = pkg.questions[0];
  const total = question.reveal.totalAyahCount as number;
  expect(total).toBeGreaterThan(0);

  const first = await reveal(request, cookie, question.id, 0);
  expect(first.response.ok()).toBe(true);
  expect(first.body.revealedAyahCount).toBe(1);
  expect(first.body.verses).toHaveLength(1);

  for (let count = 1; count < total; count += 1) {
    const step = await reveal(request, cookie, question.id, count);
    expect(step.body.revealedAyahCount).toBe(count + 1);
    expect(step.body.verses).toHaveLength(count + 1);
    // Already-revealed ayahs stay visible - the previous verse's key must
    // still be present in the accumulated list.
    expect(step.body.verses[0].verseKey).toBe(first.body.verses[0].verseKey);
  }

  const finalStep = await reveal(request, cookie, question.id, total - 1);
  expect(finalStep.body.isComplete).toBe(true);
  expect(finalStep.body.revealedAyahCount).toBe(total);
});

test("a duplicate reveal request (double-click / retry) does not double-advance", async ({
  request
}, testInfo) => {
  const { cookie, pkg } = await registerApiUser(
    request,
    `${testInfo.project.name}-dup`
  );
  const question = pkg.questions[0];

  const first = await reveal(request, cookie, question.id, 0);
  expect(first.body.revealedAyahCount).toBe(1);

  // Same expectedRevealedCount sent twice in a row (client didn't observe
  // the first response yet, or a network retry re-sent the same request).
  const duplicate = await reveal(request, cookie, question.id, 0);
  expect(duplicate.response.ok()).toBe(true);
  expect(duplicate.body.revealedAyahCount).toBe(1);
  expect(duplicate.body.verses).toHaveLength(1);
  expect(duplicate.body.verses[0].verseKey).toBe(first.body.verses[0].verseKey);
});

test("revealing past completion is a no-op, not an error", async ({
  request
}, testInfo) => {
  const { cookie, pkg } = await registerApiUser(
    request,
    `${testInfo.project.name}-past`
  );
  const question = pkg.questions[0];
  const total = question.reveal.totalAyahCount as number;

  let last: RevealBody | null = null;
  for (let count = 0; count < total; count += 1) {
    last = (await reveal(request, cookie, question.id, count)).body;
  }
  expect(last?.isComplete).toBe(true);

  const overReveal = await reveal(request, cookie, question.id, total);
  expect(overReveal.response.ok()).toBe(true);
  expect(overReveal.body.revealedAyahCount).toBe(total);
  expect(overReveal.body.verses).toHaveLength(total);
});

test("reveal progress and hint history survive a refresh (re-fetching the current package)", async ({
  request
}, testInfo) => {
  const { cookie, pkg } = await registerApiUser(
    request,
    `${testInfo.project.name}-resume`
  );
  const question = pkg.questions[0];

  await request.post("/api/memorization/hint", {
    headers: { cookie },
    data: { questionId: question.id, type: "JUZ" }
  });
  const { body: revealed } = await reveal(request, cookie, question.id, 0);

  // Simulate a refresh: re-fetch via next-package. An in-progress package
  // is returned as-is (not re-allocated), and its questions must carry
  // exactly the reveal/hint state that was there before the "refresh".
  const refreshed = await request.post("/api/memorization/next-package", {
    headers: { cookie },
    data: {}
  });
  const refreshedBody = (await refreshed.json()).data as {
    activeQuestionId: string;
    questions: {
      id: string;
      hints: { type: string; text: string }[];
      reveal: RevealBody;
    }[];
  };
  const refreshedQuestion = refreshedBody.questions.find(
    (item) => item.id === question.id
  )!;

  expect(refreshedQuestion.reveal.revealedAyahCount).toBe(1);
  expect(refreshedQuestion.reveal.verses).toEqual(revealed.verses);
  expect(refreshedQuestion.hints).toHaveLength(1);
  expect(refreshedQuestion.hints[0].type).toBe("JUZ");
  // The refreshed question is not yet assessed, so it stays the auto-selected one.
  expect(refreshedBody.activeQuestionId).toBe(question.id);
});

test("reveal completes cleanly across several random packages (page/surah boundary robustness)", async ({
  request
}, testInfo) => {
  // Up to 3 packages x 4 questions x every ayah on the page, each a
  // separate sequential API call - comfortably exceeds the 60s default
  // under real network latency (see docs/... perf notes), not because
  // anything is actually slow to the point of being broken.
  test.setTimeout(180_000);
  const { cookie } = await registerApiUser(
    request,
    `${testInfo.project.name}-boundary`,
    false
  );

  // Package pages are drawn randomly from the 604-page cycle plan; running
  // several packages exercises a broad, uncontrolled sample of pages -
  // including some of the ~113 pages that end one surah and start the
  // next - without needing to force a specific one.
  for (let packageIndex = 0; packageIndex < 3; packageIndex += 1) {
    const pkgResponse = await request.post("/api/memorization/next-package", {
      headers: { cookie },
      data: {}
    });
    const pkg = (await pkgResponse.json()).data as {
      questions: { id: string; reveal: RevealBody }[];
    };

    for (const question of pkg.questions) {
      const total = question.reveal.totalAyahCount;
      let last: RevealBody | null = null;
      for (let count = 0; count < total; count += 1) {
        const step = await reveal(request, cookie, question.id, count);
        expect(step.response.ok()).toBe(true);
        last = step.body;
      }
      expect(last?.isComplete).toBe(true);
      expect(last?.verses).toHaveLength(total);
      await request.post("/api/memorization/assessment", {
        headers: { cookie },
        data: { questionId: question.id, assessment: "CORRECT" }
      });
    }
  }
});

async function registerApiUser(
  request: APIRequestContext,
  label: string,
  allocatePackage = true
) {
  const email = `reveal-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const register = await request.post("/api/auth/register", {
    data: { email, password: "e2e-password-123", name: "Reveal" }
  });
  expect(register.ok()).toBe(true);
  const cookieHeader = register.headers()["set-cookie"];
  const [cookie] = cookieHeader.split(";");
  if (!allocatePackage) return { cookie, pkg: null as never };

  const packageResponse = await request.post("/api/memorization/next-package", {
    headers: { cookie },
    data: {}
  });
  expect(packageResponse.ok()).toBe(true);
  const packageBody = (await packageResponse.json()) as {
    data: { questions: { id: string; reveal: RevealBody }[] };
  };
  return { cookie, pkg: packageBody.data };
}
