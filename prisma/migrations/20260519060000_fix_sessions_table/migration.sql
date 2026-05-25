-- Drop the sessions table created by Prisma with wrong column names
-- connect-pg-simple will recreate it with the correct schema (sid, sess, expire)
DROP TABLE IF EXISTS "sessions";
