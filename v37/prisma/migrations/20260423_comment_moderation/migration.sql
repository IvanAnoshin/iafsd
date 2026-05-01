ALTER TABLE "Comment"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'visible',
  ADD COLUMN "moderationReason" TEXT,
  ADD COLUMN "reportCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "hiddenAt" TIMESTAMP(3);

CREATE TABLE "CommentReport" (
  "id" SERIAL NOT NULL,
  "reporterUserId" INTEGER NOT NULL,
  "commentId" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "details" TEXT,
  "status" TEXT NOT NULL DEFAULT 'new',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommentReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommentReport_reporterUserId_commentId_key" ON "CommentReport"("reporterUserId", "commentId");
CREATE INDEX "Comment_status_createdAt_idx" ON "Comment"("postId", "status", "createdAt");
CREATE INDEX "CommentReport_commentId_createdAt_idx" ON "CommentReport"("commentId", "createdAt");
CREATE INDEX "CommentReport_status_createdAt_idx" ON "CommentReport"("status", "createdAt");

ALTER TABLE "CommentReport" ADD CONSTRAINT "CommentReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommentReport" ADD CONSTRAINT "CommentReport_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
