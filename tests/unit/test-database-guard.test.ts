import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCAL_TEST_DATABASE_URL,
  UnsafeTestDatabaseUrlError,
  assertLocalDatabaseUrl,
  resolveTestDatabaseUrl
} from "@/lib/db/test-database-guard";

describe("test database guard", () => {
  it("rejects a real Neon connection string", () => {
    const neonUrl =
      "postgresql://neondb_owner:secret@ep-lucky-rice-az2nrrhr-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
    expect(() => assertLocalDatabaseUrl(neonUrl)).toThrow(
      UnsafeTestDatabaseUrlError
    );
    expect(() => resolveTestDatabaseUrl(neonUrl)).toThrow(
      /not localhost\/127\.0\.0\.1/
    );
  });

  it("rejects any other non-local hostname", () => {
    for (const url of [
      "postgresql://user:pass@db.production.example.com/app",
      "postgresql://user:pass@10.0.0.5/app",
      "postgresql://user:pass@some-rds-instance.amazonaws.com:5432/app"
    ]) {
      expect(() => assertLocalDatabaseUrl(url)).toThrow(
        UnsafeTestDatabaseUrlError
      );
    }
  });

  it("rejects an unparseable URL", () => {
    expect(() => assertLocalDatabaseUrl("not a url at all")).toThrow(
      UnsafeTestDatabaseUrlError
    );
  });

  it("rejects a local host with no database name", () => {
    expect(() =>
      assertLocalDatabaseUrl("postgresql://ci:ci@localhost")
    ).toThrow(UnsafeTestDatabaseUrlError);
  });

  it("accepts localhost and 127.0.0.1 with a database name", () => {
    expect(assertLocalDatabaseUrl("postgresql://ci:ci@localhost:5433/ci")).toBe(
      "postgresql://ci:ci@localhost:5433/ci"
    );
    expect(assertLocalDatabaseUrl("postgresql://ci:ci@127.0.0.1:5433/ci")).toBe(
      "postgresql://ci:ci@127.0.0.1:5433/ci"
    );
  });

  it("resolveTestDatabaseUrl falls back to the fixed local default when no candidate is given", () => {
    expect(resolveTestDatabaseUrl(undefined)).toBe(
      DEFAULT_LOCAL_TEST_DATABASE_URL
    );
    expect(resolveTestDatabaseUrl("")).toBe(DEFAULT_LOCAL_TEST_DATABASE_URL);
  });

  it("resolveTestDatabaseUrl returns an explicit valid local candidate unchanged", () => {
    expect(
      resolveTestDatabaseUrl("postgresql://ci:ci@127.0.0.1:9999/ci_alt")
    ).toBe("postgresql://ci:ci@127.0.0.1:9999/ci_alt");
  });

  it("resolveTestDatabaseUrl never falls back to a non-local candidate", () => {
    expect(() =>
      resolveTestDatabaseUrl(
        "postgresql://neondb_owner:secret@ep-example-pooler.aws.neon.tech/neondb"
      )
    ).toThrow(UnsafeTestDatabaseUrlError);
  });
});
