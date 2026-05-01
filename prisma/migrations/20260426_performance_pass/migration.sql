-- v93 performance indexes for high-traffic lists.
CREATE INDEX IF NOT EXISTS "Post_authorId_status_communityId_createdAt_idx" ON "Post"("authorId", "status", "communityId", "createdAt");
CREATE INDEX IF NOT EXISTS "Post_status_visibility_createdAt_idx" ON "Post"("status", "visibility", "createdAt");
CREATE INDEX IF NOT EXISTS "Post_type_status_createdAt_idx" ON "Post"("type", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Post_communityId_type_status_createdAt_idx" ON "Post"("communityId", "type", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Comment_postId_deletedAt_createdAt_idx" ON "Comment"("postId", "deletedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "CommunityMember_userId_status_communityId_idx" ON "CommunityMember"("userId", "status", "communityId");
