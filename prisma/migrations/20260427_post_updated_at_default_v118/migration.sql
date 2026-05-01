-- v118: make Post.updatedAt safe for databases that already contain posts.
-- `@updatedAt` updates the field through Prisma, but existing rows also need
-- a database default when the column is introduced.
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Post" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
