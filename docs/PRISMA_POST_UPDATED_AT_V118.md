# v118 — Safe Prisma push for Post.updatedAt

Fixed a dev bootstrap failure where `prisma db push` could not add the required `Post.updatedAt` column to an existing database containing posts.

## Problem

Prisma refused to execute this change:

- `Post.updatedAt` was required;
- existing `Post` rows had no value for the new column;
- `@updatedAt` is handled by Prisma on writes, but it is not enough as a database default for existing rows during `db push`.

## Fix

`Post.updatedAt` now has both behaviors:

```prisma
updatedAt DateTime @default(now()) @updatedAt
```

This lets Prisma backfill existing rows safely during schema sync and still update the field automatically on future writes.

## What not to do

Do not use:

```bash
prisma db push --force-reset
```

That would drop the local database and delete existing data.

## Recommended command

After pulling this version, run:

```bash
cmd /c "npx prisma generate && npx prisma db push"
```

or simply start dev again if the project bootstrap already runs Prisma automatically.
