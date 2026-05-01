ALTER TABLE "Comment"
ADD COLUMN "replyToCommentId" INTEGER;

CREATE INDEX "Comment_postId_replyToCommentId_createdAt_idx"
ON "Comment"("postId", "replyToCommentId", "createdAt");

ALTER TABLE "Comment"
ADD CONSTRAINT "Comment_replyToCommentId_fkey"
FOREIGN KEY ("replyToCommentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
