import { expect, type APIRequestContext, test } from "@playwright/test";

type RevealBody = {
  revealedAyahCount: number;
  totalAyahCount: number;
  isComplete: boolean;
  verses: { verseKey: string; text: string }[];
};

type SessionDto = RevealBody & { questionId: string; fragmentText: string };

async function revealMainQuestionFully(
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
    const body = (await response.json()).data as RevealBody;
    count += 1;
    if (body.isComplete) return;
  }
}

async function assess(
  request: APIRequestContext,
  cookie: string,
  questionId: string,
  belCount: number,
  tuntunCount: number
) {
  await revealMainQuestionFully(request, cookie, questionId);
  const response = await request.post("/api/memorization/assessment", {
    headers: { cookie },
    data: { questionId, belCount, tuntunCount }
  });
  expect(response.ok()).toBe(true);
}

/**
 * Registers a user, allocates one package, and assesses its 4 questions
 * - three with nonzero bel/tuntun (derives to MISSED) and one with 0/0
 * (derives to CORRECT), each fully revealed first per the
 * reveal-completeness gate - so the evaluation bank has a known,
 * non-trivial starting state to test against. PARTIAL is no longer
 * reachable from a new submission (see lib/memorization/service.ts's
 * deriveAssessment) - `partial` stays empty and exists only so callers
 * that used to read it don't need restructuring.
 */
async function setupAssessedQuestions(
  request: APIRequestContext,
  label: string
) {
  const email = `evaluation-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const register = await request.post("/api/auth/register", {
    data: { email, password: "e2e-password-123", name: "Evaluation" }
  });
  expect(register.ok()).toBe(true);
  const cookieHeader = register.headers()["set-cookie"];
  const [cookie] = cookieHeader.split(";");

  const pkgResponse = await request.post("/api/memorization/next-package", {
    headers: { cookie },
    data: {}
  });
  const pkg = (await pkgResponse.json()).data as {
    questions: { id: string }[];
  };
  const [q1, q2, q3, q4] = pkg.questions;

  await assess(request, cookie, q1.id, 2, 1);
  await assess(request, cookie, q2.id, 1, 0);
  await assess(request, cookie, q3.id, 0, 1);
  await assess(request, cookie, q4.id, 0, 0);

  return {
    cookie,
    questionIds: {
      missed: [q1.id, q2.id, q3.id],
      partial: [] as string[],
      correct: [q4.id]
    }
  };
}

/** Creates (or resumes) an evaluation session and reveals it to completion. */
async function startAndRevealEvaluationSession(
  request: APIRequestContext,
  cookie: string,
  questionId: string
) {
  const sessionResponse = await request.post("/api/evaluation/session", {
    headers: { cookie },
    data: { questionId }
  });
  expect(sessionResponse.ok()).toBe(true);
  let session = (await sessionResponse.json()).data as SessionDto;
  while (!session.isComplete) {
    const revealResponse = await request.post("/api/evaluation/reveal", {
      headers: { cookie },
      data: { questionId, expectedRevealedCount: session.revealedAyahCount }
    });
    expect(revealResponse.ok()).toBe(true);
    session = (await revealResponse.json()).data as SessionDto;
  }
  return session;
}

async function submitAttempt(
  request: APIRequestContext,
  cookie: string,
  questionId: string,
  result: "CORRECT" | "PARTIAL" | "MISSED",
  belCount: number,
  tuntunCount: number,
  clientRequestId = `${questionId}-${Date.now()}-${Math.random().toString(36).slice(2)}`
) {
  await startAndRevealEvaluationSession(request, cookie, questionId);
  const response = await request.post("/api/evaluation/attempt", {
    headers: { cookie },
    data: { questionId, result, belCount, tuntunCount, clientRequestId }
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).data as { id: string };
}

test("a MISSED question appears in the evaluation bank, prioritized over PARTIAL", async ({
  request
}, testInfo) => {
  const { cookie, questionIds } = await setupAssessedQuestions(
    request,
    testInfo.project.name
  );

  const bankResponse = await request.get("/api/evaluation/bank?limit=20", {
    headers: { cookie }
  });
  expect(bankResponse.ok()).toBe(true);
  const bank = (await bankResponse.json()).data as {
    items: { questionId: string; lastResult: string }[];
    nextCursor: string | null;
  };

  expect(bank.items.map((item) => item.questionId).sort()).toEqual(
    [...questionIds.missed, ...questionIds.partial].sort()
  );
  // CORRECT questions never appear.
  expect(
    bank.items.some((item) => questionIds.correct.includes(item.questionId))
  ).toBe(false);
  // MISSED sorts before PARTIAL.
  const firstPartialIndex = bank.items.findIndex(
    (item) => item.lastResult === "PARTIAL"
  );
  const lastMissedIndex = bank.items
    .map((item) => item.lastResult)
    .lastIndexOf("MISSED");
  if (firstPartialIndex >= 0 && lastMissedIndex >= 0) {
    expect(lastMissedIndex).toBeLessThan(firstPartialIndex);
  }
});

test("evaluation bank shows the immutable original fragment, never one extended by hints", async ({
  request
}, testInfo) => {
  const email = `evaluation-frag-${testInfo.project.name}-${Date.now()}@example.com`;
  const register = await request.post("/api/auth/register", {
    data: { email, password: "e2e-password-123", name: "Frag" }
  });
  const cookieHeader = register.headers()["set-cookie"];
  const [cookie] = cookieHeader.split(";");

  // Search a handful of packages for a question whose fragment can
  // actually grow (a short first ayah has nothing left to extend).
  let target: { id: string; original: string } | null = null;
  for (let attempt = 0; attempt < 6 && !target; attempt += 1) {
    const pkgResponse = await request.post("/api/memorization/next-package", {
      headers: { cookie },
      data: {}
    });
    const pkg = (await pkgResponse.json()).data as {
      questions: { id: string; fragmentText: string }[];
    };
    for (const question of pkg.questions) {
      if (target) {
        await assess(request, cookie, question.id, 0, 0);
        continue;
      }
      const hintResponse = await request.post("/api/memorization/hint", {
        headers: { cookie },
        data: { questionId: question.id, type: "EXTEND_FRAGMENT" }
      });
      const extended = (await hintResponse.json()).data?.fragmentText as
        string | undefined;
      if (extended && extended !== question.fragmentText) {
        target = { id: question.id, original: question.fragmentText };
        await assess(request, cookie, question.id, 1, 0);
      } else {
        await assess(request, cookie, question.id, 0, 0);
      }
    }
  }
  expect(
    target,
    "expected at least one extendable fragment within 6 packages"
  ).not.toBeNull();

  const bankResponse = await request.get("/api/evaluation/bank?limit=50", {
    headers: { cookie }
  });
  const bank = (await bankResponse.json()).data as {
    items: { questionId: string; fragmentText: string }[];
  };
  const bankItem = bank.items.find((item) => item.questionId === target!.id);
  expect(bankItem?.fragmentText).toBe(target!.original);
});

test("evaluation session rejects a question whose main-cycle assessment is CORRECT", async ({
  request
}, testInfo) => {
  const { cookie, questionIds } = await setupAssessedQuestions(
    request,
    `${testInfo.project.name}-correct-rejected`
  );

  const sessionResponse = await request.post("/api/evaluation/session", {
    headers: { cookie },
    data: { questionId: questionIds.correct[0] }
  });
  expect(sessionResponse.status()).toBe(409);
  const body = (await sessionResponse.json()).error as { code: string };
  expect(body.code).toBe("EVALUATION_NOT_ELIGIBLE");

  // The attempt endpoint independently rejects it too, in case a client
  // ever calls it directly without going through /session first.
  const attemptResponse = await request.post("/api/evaluation/attempt", {
    headers: { cookie },
    data: {
      questionId: questionIds.correct[0],
      result: "CORRECT",
      belCount: 0,
      tuntunCount: 0,
      clientRequestId: "correct-question-direct-attempt"
    }
  });
  expect(attemptResponse.status()).toBe(409);
});

test("submitting an evaluation attempt before its reveal is complete is rejected", async ({
  request
}, testInfo) => {
  const { cookie, questionIds } = await setupAssessedQuestions(
    request,
    `${testInfo.project.name}-incomplete`
  );
  const questionId = questionIds.missed[0];

  const sessionResponse = await request.post("/api/evaluation/session", {
    headers: { cookie },
    data: { questionId }
  });
  expect(sessionResponse.ok()).toBe(true);

  // No reveal at all yet.
  const beforeAnyReveal = await request.post("/api/evaluation/attempt", {
    headers: { cookie },
    data: {
      questionId,
      result: "MISSED",
      belCount: 0,
      tuntunCount: 0,
      clientRequestId: "incomplete-before-any-reveal"
    }
  });
  expect(beforeAnyReveal.status()).toBe(409);
  expect((await beforeAnyReveal.json()).error.code).toBe("REVEAL_INCOMPLETE");

  // One ayah revealed, still not complete (the fixture packages always
  // span more than one ayah to the next-page boundary).
  await request.post("/api/evaluation/reveal", {
    headers: { cookie },
    data: { questionId, expectedRevealedCount: 0 }
  });
  const partiallyRevealed = await request.post("/api/evaluation/attempt", {
    headers: { cookie },
    data: {
      questionId,
      result: "MISSED",
      belCount: 0,
      tuntunCount: 0,
      clientRequestId: "incomplete-partial-reveal"
    }
  });
  expect(partiallyRevealed.status()).toBe(409);

  // Now finish revealing - submission must succeed.
  await startAndRevealEvaluationSession(request, cookie, questionId);
  const complete = await request.post("/api/evaluation/attempt", {
    headers: { cookie },
    data: {
      questionId,
      result: "MISSED",
      belCount: 0,
      tuntunCount: 0,
      clientRequestId: "incomplete-now-complete"
    }
  });
  expect(complete.ok()).toBe(true);
});

test("evaluation attempts never overwrite the main-cycle assessment and are kept as separate history", async ({
  request
}, testInfo) => {
  const { cookie, questionIds } = await setupAssessedQuestions(
    request,
    `${testInfo.project.name}-retry`
  );
  const questionId = questionIds.missed[0];

  const attempt1 = await submitAttempt(
    request,
    cookie,
    questionId,
    "PARTIAL",
    2,
    1
  );
  const attempt2 = await submitAttempt(
    request,
    cookie,
    questionId,
    "CORRECT",
    0,
    0
  );
  expect(attempt1.id).not.toBe(attempt2.id);

  const historyResponse = await request.get(
    "/api/evaluation/history?limit=20",
    { headers: { cookie } }
  );
  const history = (await historyResponse.json()).data as {
    items: { id: string; questionId: string; result: string }[];
    summary: {
      totalAttempts: number;
      totalBelCount: number;
      totalTuntunCount: number;
    };
  };
  const attemptsForQuestion = history.items.filter(
    (item) => item.questionId === questionId
  );
  expect(attemptsForQuestion).toHaveLength(2);
  expect(attemptsForQuestion.map((item) => item.result).sort()).toEqual([
    "CORRECT",
    "PARTIAL"
  ]);
  expect(history.summary.totalAttempts).toBe(2);
  expect(history.summary.totalBelCount).toBe(2);
  expect(history.summary.totalTuntunCount).toBe(1);

  // The bank still lists it as MISSED - evaluation never touched QuestionAssessment.
  const bankResponse = await request.get("/api/evaluation/bank?limit=20", {
    headers: { cookie }
  });
  const bank = (await bankResponse.json()).data as {
    items: { questionId: string; lastResult: string }[];
  };
  const entry = bank.items.find((item) => item.questionId === questionId);
  expect(entry?.lastResult).toBe("MISSED");
});

test("belCount and tuntunCount must be non-negative integers", async ({
  request
}, testInfo) => {
  const { cookie, questionIds } = await setupAssessedQuestions(
    request,
    `${testInfo.project.name}-validate`
  );
  const questionId = questionIds.missed[0];
  await startAndRevealEvaluationSession(request, cookie, questionId);

  const negative = await request.post("/api/evaluation/attempt", {
    headers: { cookie },
    data: {
      questionId,
      result: "MISSED",
      belCount: -1,
      tuntunCount: 0,
      clientRequestId: "validate-negative"
    }
  });
  expect(negative.status()).toBe(422);

  const nonInteger = await request.post("/api/evaluation/attempt", {
    headers: { cookie },
    data: {
      questionId,
      result: "MISSED",
      belCount: 1.5,
      tuntunCount: 0,
      clientRequestId: "validate-non-integer"
    }
  });
  expect(nonInteger.status()).toBe(422);

  // result:"CORRECT" here is the practice OUTCOME the user is
  // self-reporting, not the question's main-cycle assessment (which is
  // MISSED) - a MISSED/PARTIAL question can legitimately be evaluated as
  // recalled correctly this time.
  const zeroIsValid = await request.post("/api/evaluation/attempt", {
    headers: { cookie },
    data: {
      questionId,
      result: "CORRECT",
      belCount: 0,
      tuntunCount: 0,
      clientRequestId: "validate-zero"
    }
  });
  expect(zeroIsValid.ok()).toBe(true);

  const unknownQuestion = await request.post("/api/evaluation/attempt", {
    headers: { cookie },
    data: {
      questionId: "not-a-real-question-id",
      result: "CORRECT",
      belCount: 0,
      tuntunCount: 0,
      clientRequestId: "validate-unknown-question"
    }
  });
  expect(unknownQuestion.status()).toBe(404);
});

test("a duplicate submission (same clientRequestId) is deduped, not double-counted", async ({
  request
}, testInfo) => {
  const { cookie, questionIds } = await setupAssessedQuestions(
    request,
    `${testInfo.project.name}-dedupe`
  );
  const questionId = questionIds.missed[0];
  // Must be unique per test run, not just per call within this test: this
  // suite runs against a persistent (not reset-per-run) dev database, and
  // a literal fixed string would collide with a row left over from a
  // previous run of this exact test, silently deduping against stale data
  // for the wrong question instead of exercising the same-run duplicate
  // path this test means to check.
  const clientRequestId = `dup-key-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const first = await submitAttempt(
    request,
    cookie,
    questionId,
    "PARTIAL",
    3,
    2,
    clientRequestId
  );
  // Same key again - simulates a double-click or a client retry after a
  // dropped response for the same logical submission. The evaluation
  // session was already consumed/deleted by the first submit, so this
  // must succeed purely from the cached-attempt lookup, without needing
  // a session to exist.
  const secondResponse = await request.post("/api/evaluation/attempt", {
    headers: { cookie },
    data: {
      questionId,
      result: "PARTIAL",
      belCount: 3,
      tuntunCount: 2,
      clientRequestId
    }
  });
  expect(secondResponse.ok()).toBe(true);
  const second = (await secondResponse.json()).data as { id: string };
  expect(second.id).toBe(first.id);

  // Same key, but a DIFFERENT payload this time - must conflict, not
  // silently return either the old or a new result.
  const conflictResponse = await request.post("/api/evaluation/attempt", {
    headers: { cookie },
    data: {
      questionId,
      result: "CORRECT",
      belCount: 0,
      tuntunCount: 0,
      clientRequestId
    }
  });
  expect(conflictResponse.status()).toBe(409);
  expect((await conflictResponse.json()).error.code).toBe(
    "EVALUATION_ATTEMPT_CONFLICT"
  );

  const historyResponse = await request.get(
    "/api/evaluation/history?limit=20",
    { headers: { cookie } }
  );
  const history = (await historyResponse.json()).data as {
    items: { id: string; questionId: string }[];
    summary: { totalAttempts: number; totalBelCount: number };
  };
  expect(
    history.items.filter((item) => item.questionId === questionId)
  ).toHaveLength(1);
  expect(history.summary.totalAttempts).toBe(1);
  expect(history.summary.totalBelCount).toBe(3);
});

test("bank and history pagination are stable across pages (no skipped or duplicated rows)", async ({
  request
}, testInfo) => {
  // 8 main-cycle questions fully revealed and assessed, plus 3 evaluation
  // sessions fully revealed and submitted, each against the larger
  // (correct) page+1 boundary - comfortably exceeds the 60s default.
  test.setTimeout(240_000);
  const email = `evaluation-page-${testInfo.project.name}-${Date.now()}@example.com`;
  const register = await request.post("/api/auth/register", {
    data: { email, password: "e2e-password-123", name: "Page" }
  });
  const cookieHeader = register.headers()["set-cookie"];
  const [cookie] = cookieHeader.split(";");

  const missedIds: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const pkgResponse = await request.post("/api/memorization/next-package", {
      headers: { cookie },
      data: {}
    });
    const pkg = (await pkgResponse.json()).data as {
      questions: { id: string }[];
    };
    for (const question of pkg.questions) {
      await assess(request, cookie, question.id, 1, 0);
      missedIds.push(question.id);
    }
  }
  expect(missedIds.length).toBe(8);

  const seenBankIds = new Set<string>();
  let bankCursor: string | null = null;
  let bankPages = 0;
  do {
    const url: string = bankCursor
      ? `/api/evaluation/bank?limit=3&cursor=${encodeURIComponent(bankCursor)}`
      : "/api/evaluation/bank?limit=3";
    const response = await request.get(url, { headers: { cookie } });
    const page = (await response.json()).data as {
      items: { questionId: string }[];
      nextCursor: string | null;
    };
    bankPages += 1;
    for (const item of page.items) {
      expect(seenBankIds.has(item.questionId)).toBe(false);
      seenBankIds.add(item.questionId);
    }
    bankCursor = page.nextCursor;
  } while (bankCursor && bankPages < 10);
  expect([...seenBankIds].sort()).toEqual([...missedIds].sort());

  // Submit 3 evaluation attempts, then paginate history with a small limit.
  for (const questionId of missedIds.slice(0, 3)) {
    await submitAttempt(request, cookie, questionId, "PARTIAL", 1, 1);
  }
  const seenHistoryIds = new Set<string>();
  let historyCursor: string | null = null;
  let historyPages = 0;
  do {
    const url: string = historyCursor
      ? `/api/evaluation/history?limit=2&cursor=${encodeURIComponent(historyCursor)}`
      : "/api/evaluation/history?limit=2";
    const response = await request.get(url, { headers: { cookie } });
    const page = (await response.json()).data as {
      items: { id: string }[];
      nextCursor: string | null;
      summary?: unknown;
    };
    historyPages += 1;
    // Summary is only meaningful (and only sent) on the first page.
    if (historyPages === 1) {
      expect(page.summary).toBeDefined();
    } else {
      expect(page.summary).toBeUndefined();
    }
    for (const item of page.items) {
      expect(seenHistoryIds.has(item.id)).toBe(false);
      seenHistoryIds.add(item.id);
    }
    historyCursor = page.nextCursor;
  } while (historyCursor && historyPages < 10);
  expect(seenHistoryIds.size).toBe(3);
});
