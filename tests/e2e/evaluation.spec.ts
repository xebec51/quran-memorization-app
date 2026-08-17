import { expect, type APIRequestContext, test } from "@playwright/test";

test("a MISSED question appears in the evaluation bank, prioritized over PARTIAL", async ({
  request
}, testInfo) => {
  const { cookie, questionIds } = await setupAssessedQuestions(
    request,
    testInfo.project.name
  );

  const bankResponse = await request.get("/api/evaluation/bank", {
    headers: { cookie }
  });
  expect(bankResponse.ok()).toBe(true);
  const bank = (await bankResponse.json()).data as {
    questionId: string;
    lastResult: string;
  }[];

  expect(bank.map((item) => item.questionId).sort()).toEqual(
    [...questionIds.missed, ...questionIds.partial].sort()
  );
  // CORRECT questions never appear.
  expect(
    bank.some((item) => questionIds.correct.includes(item.questionId))
  ).toBe(false);
  // MISSED sorts before PARTIAL.
  const firstPartialIndex = bank.findIndex(
    (item) => item.lastResult === "PARTIAL"
  );
  const lastMissedIndex = bank
    .map((item) => item.lastResult)
    .lastIndexOf("MISSED");
  if (firstPartialIndex >= 0 && lastMissedIndex >= 0) {
    expect(lastMissedIndex).toBeLessThan(firstPartialIndex);
  }
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
  const bankResponse = await request.get("/api/evaluation/bank", {
    headers: { cookie }
  });
  const bank = (await bankResponse.json()).data as {
    questionId: string;
    lastResult: string;
  }[];
  const entry = bank.find((item) => item.questionId === questionId);
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

  const negative = await request.post("/api/evaluation/attempt", {
    headers: { cookie },
    data: { questionId, result: "MISSED", belCount: -1, tuntunCount: 0 }
  });
  expect(negative.status()).toBe(422);

  const nonInteger = await request.post("/api/evaluation/attempt", {
    headers: { cookie },
    data: { questionId, result: "MISSED", belCount: 1.5, tuntunCount: 0 }
  });
  expect(nonInteger.status()).toBe(422);

  const zeroIsValid = await request.post("/api/evaluation/attempt", {
    headers: { cookie },
    data: { questionId, result: "CORRECT", belCount: 0, tuntunCount: 0 }
  });
  expect(zeroIsValid.ok()).toBe(true);

  const unknownQuestion = await request.post("/api/evaluation/attempt", {
    headers: { cookie },
    data: {
      questionId: "not-a-real-question-id",
      result: "CORRECT",
      belCount: 0,
      tuntunCount: 0
    }
  });
  expect(unknownQuestion.status()).toBe(404);
});

async function submitAttempt(
  request: APIRequestContext,
  cookie: string,
  questionId: string,
  result: "CORRECT" | "PARTIAL" | "MISSED",
  belCount: number,
  tuntunCount: number
) {
  const response = await request.post("/api/evaluation/attempt", {
    headers: { cookie },
    data: { questionId, result, belCount, tuntunCount }
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).data as { id: string };
}

/**
 * Registers a user, allocates one package, and assesses its 4 questions
 * as MISSED/MISSED/PARTIAL/CORRECT so the evaluation bank has a known,
 * non-trivial starting state to test against.
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

  await assess(request, cookie, q1.id, "MISSED");
  await assess(request, cookie, q2.id, "MISSED");
  await assess(request, cookie, q3.id, "PARTIAL");
  await assess(request, cookie, q4.id, "CORRECT");

  return {
    cookie,
    questionIds: {
      missed: [q1.id, q2.id],
      partial: [q3.id],
      correct: [q4.id]
    }
  };
}

async function assess(
  request: APIRequestContext,
  cookie: string,
  questionId: string,
  assessment: "CORRECT" | "PARTIAL" | "MISSED"
) {
  const response = await request.post("/api/memorization/assessment", {
    headers: { cookie },
    data: { questionId, assessment }
  });
  expect(response.ok()).toBe(true);
}
