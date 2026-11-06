-- Preserve each submitted translation as a version so an approved Meta template
-- remains usable while a newer edit is waiting for approval.
ALTER TABLE "TemplateTranslation"
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "TemplateTranslation"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

DROP INDEX "TemplateTranslation_templateId_language_key";

CREATE INDEX "TemplateTranslation_templateId_language_createdAt_idx"
ON "TemplateTranslation"("templateId", "language", "createdAt");

CREATE UNIQUE INDEX "TemplateTranslation_templateId_language_revision_key"
ON "TemplateTranslation"("templateId", "language", "revision");

ALTER TABLE "TemplateTranslation"
DROP COLUMN "contentSid";
