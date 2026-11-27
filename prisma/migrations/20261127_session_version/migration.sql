-- Bumped on sign-out so JWTs minted from pre-sign-out cookies (e.g. by
-- in-flight session refreshes) are rejected by requireOwner.
ALTER TABLE "Owner" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
