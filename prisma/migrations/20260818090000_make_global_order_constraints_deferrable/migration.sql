-- Makes QuranVerse.globalOrder and QuranWord.globalOrder uniqueness
-- DEFERRABLE INITIALLY DEFERRED, so Postgres only checks uniqueness at
-- transaction COMMIT instead of after every individual row write.
--
-- Why: syncQuranData's bulk globalOrder reassignment (re-sorting every
-- verse/word into canonical order on each sync) can transiently "collide"
-- mid-batch - row A takes the globalOrder value row B is about to vacate,
-- in whatever order the UPSERT statements happen to execute - even though
-- the FINAL state after all rows are written is fully unique. The
-- previous approach handled this by DROP INDEX-ing the unique constraint
-- for the sync transaction's duration and recreating it at the end, but
-- DROP INDEX takes an ACCESS EXCLUSIVE lock on the table for as long as
-- the transaction is open (potentially minutes, for a full 604-page
-- sync), blocking every concurrent read (reveal, question generation,
-- reader page) for the whole sync.
--
-- A deferred constraint gets the same safety property (the final state
-- must be unique or the whole transaction rolls back - a genuine data
-- problem still cannot be masked) without ever dropping the index, so
-- upserts only take ordinary row-level locks and concurrent reads are
-- never blocked.
--
-- Prisma's schema DSL has no attribute for "deferrable" - schema.prisma
-- still just declares `globalOrder Int @unique`, which remains accurate
-- (the column IS unique) but does not capture the deferred-checking
-- behavior. This migration file is the source of truth for that; a
-- future `prisma migrate dev`/schema diff will not know to preserve it
-- if the constraint is ever dropped and recreated some other way.

ALTER TABLE "QuranVerse" DROP CONSTRAINT IF EXISTS "QuranVerse_globalOrder_key";
DROP INDEX IF EXISTS "QuranVerse_globalOrder_key";
ALTER TABLE "QuranVerse" ADD CONSTRAINT "QuranVerse_globalOrder_key"
  UNIQUE ("globalOrder") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "QuranWord" DROP CONSTRAINT IF EXISTS "QuranWord_globalOrder_key";
DROP INDEX IF EXISTS "QuranWord_globalOrder_key";
ALTER TABLE "QuranWord" ADD CONSTRAINT "QuranWord_globalOrder_key"
  UNIQUE ("globalOrder") DEFERRABLE INITIALLY DEFERRED;
