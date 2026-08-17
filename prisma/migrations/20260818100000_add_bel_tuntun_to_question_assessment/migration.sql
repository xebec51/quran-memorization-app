-- Additive, nullable columns: existing QuestionAssessment rows are left
-- completely untouched (belCount/tuntunCount simply read NULL for them).
-- Never edit or backfill this migration - see prisma/schema.prisma's
-- QuestionAssessment model comment for why old rows keep their original
-- assessment value forever rather than being reinterpreted.
ALTER TABLE "QuestionAssessment" ADD COLUMN "belCount" INTEGER;
ALTER TABLE "QuestionAssessment" ADD COLUMN "tuntunCount" INTEGER;
