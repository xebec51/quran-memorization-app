import { describe, expect, it } from "vitest";
import { createCyclePlan, validateCyclePlan } from "@/lib/memorization/cycle/plan";
import { SeededRandomSource } from "@/lib/memorization/random";
import { syntheticCyclePages } from "../fixtures/cycle-pages";

describe("cycle plan invariants", () => {
  it("creates 151 four-question packages with all juz bands", () => {
    const plan = createCyclePlan(syntheticCyclePages(), "seed-a", new SeededRandomSource("seed-a"));
    validateCyclePlan(plan);
    expect(plan.packages).toHaveLength(151);
    for (const pkg of plan.packages) {
      expect(pkg.questions).toHaveLength(4);
      expect(new Set(pkg.questions.map((question) => question.juzBand))).toEqual(new Set(["A", "B", "C"]));
    }
  });

  it("consumes 604 unique primary pages without repeats", () => {
    const plan = createCyclePlan(syntheticCyclePages(), "seed-b", new SeededRandomSource("seed-b"));
    const pages = plan.packages.flatMap((pkg) => pkg.questions.map((question) => question.pageNumber));
    expect(pages).toHaveLength(604);
    expect(new Set(pages).size).toBe(604);
  });

  it("respects exact wildcard quotas", () => {
    const plan = createCyclePlan(syntheticCyclePages(), "seed-c", new SeededRandomSource("seed-c"));
    expect(plan.wildcardQuotas).toEqual({ A: 51, B: 50, C: 50 });
    const wildcardCounts = { A: 0, B: 0, C: 0 };
    for (const question of plan.packages.flatMap((pkg) => pkg.questions)) {
      if (question.slot === "WILDCARD") wildcardCounts[question.juzBand] += 1;
    }
    expect(wildcardCounts).toEqual(plan.wildcardQuotas);
  });

  it("is reproducible with seeded RNG and changes with a new seed", () => {
    const first = createCyclePlan(syntheticCyclePages(), "fixed", new SeededRandomSource("fixed"));
    const second = createCyclePlan(syntheticCyclePages(), "fixed", new SeededRandomSource("fixed"));
    const third = createCyclePlan(syntheticCyclePages(), "different", new SeededRandomSource("different"));
    expect(second.packages[0].questions).toEqual(first.packages[0].questions);
    expect(third.packages[0].questions).not.toEqual(first.packages[0].questions);
  });

  it("starts a new cycle plan that may reuse pages", () => {
    const first = createCyclePlan(syntheticCyclePages(), "cycle-1", new SeededRandomSource("cycle-1"));
    const second = createCyclePlan(syntheticCyclePages(), "cycle-2", new SeededRandomSource("cycle-2"));
    const firstPages = new Set(first.packages.flatMap((pkg) => pkg.questions.map((question) => question.pageNumber)));
    const secondPages = new Set(second.packages.flatMap((pkg) => pkg.questions.map((question) => question.pageNumber)));
    expect(firstPages.size).toBe(604);
    expect(secondPages.size).toBe(604);
    expect([...firstPages].every((page) => secondPages.has(page))).toBe(true);
  });
});
