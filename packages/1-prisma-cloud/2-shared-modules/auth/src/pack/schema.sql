-- GENERATED FILE - DO NOT EDIT (pnpm generate:schema)
-- Flat, idempotent DDL of the auth pack migration graph applied to an
-- empty database. Consumed only by the testing export; deploys run the
-- real migration step.

-- Create schema "auth"
CREATE SCHEMA IF NOT EXISTS "auth";

-- Create schema "public"
CREATE SCHEMA IF NOT EXISTS "public";

-- create table "account"
CREATE TABLE IF NOT EXISTS "auth"."account" (
  "accessToken" text,
  "accessTokenExpiresAt" "timestamptz",
  "accountId" text NOT NULL,
  "createdAt" "timestamptz" DEFAULT (now()) NOT NULL,
  "id" text NOT NULL,
  "idToken" text,
  "password" text,
  "providerId" text NOT NULL,
  "refreshToken" text,
  "refreshTokenExpiresAt" "timestamptz",
  "scope" text,
  "updatedAt" "timestamptz" NOT NULL,
  "userId" text NOT NULL,
  PRIMARY KEY ("id")
);

-- create table "jwks"
CREATE TABLE IF NOT EXISTS "auth"."jwks" (
  "createdAt" "timestamptz" NOT NULL,
  "expiresAt" "timestamptz",
  "id" text NOT NULL,
  "privateKey" text NOT NULL,
  "publicKey" text NOT NULL,
  PRIMARY KEY ("id")
);

-- create table "session"
CREATE TABLE IF NOT EXISTS "auth"."session" (
  "createdAt" "timestamptz" DEFAULT (now()) NOT NULL,
  "expiresAt" "timestamptz" NOT NULL,
  "id" text NOT NULL,
  "impersonatedBy" text,
  "ipAddress" text,
  "token" text NOT NULL,
  "updatedAt" "timestamptz" NOT NULL,
  "userAgent" text,
  "userId" text NOT NULL,
  PRIMARY KEY ("id")
);

-- create table "user"
CREATE TABLE IF NOT EXISTS "auth"."user" (
  "banExpires" "timestamptz",
  "banReason" text,
  "banned" bool,
  "createdAt" "timestamptz" DEFAULT (now()) NOT NULL,
  "email" text NOT NULL,
  "emailVerified" bool NOT NULL,
  "id" text NOT NULL,
  "image" text,
  "name" text NOT NULL,
  "role" text,
  "updatedAt" "timestamptz" DEFAULT (now()) NOT NULL,
  PRIMARY KEY ("id")
);

-- create table "verification"
CREATE TABLE IF NOT EXISTS "auth"."verification" (
  "createdAt" "timestamptz" DEFAULT (now()) NOT NULL,
  "expiresAt" "timestamptz" NOT NULL,
  "id" text NOT NULL,
  "identifier" text NOT NULL,
  "updatedAt" "timestamptz" DEFAULT (now()) NOT NULL,
  "value" text NOT NULL,
  PRIMARY KEY ("id")
);

-- add unique constraint "session_token_key"
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_token_key' AND conrelid = 'auth.session'::regclass
  ) THEN
    EXECUTE $ddl$ALTER TABLE "auth"."session" ADD CONSTRAINT "session_token_key" UNIQUE ("token")$ddl$;
  END IF;
END $$;

-- add unique constraint "user_email_key"
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_email_key' AND conrelid = 'auth.user'::regclass
  ) THEN
    EXECUTE $ddl$ALTER TABLE "auth"."user" ADD CONSTRAINT "user_email_key" UNIQUE ("email")$ddl$;
  END IF;
END $$;

-- create index "account_userId_idx"
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "auth"."account" ("userId");

-- create index "session_userId_idx"
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "auth"."session" ("userId");

-- create index "verification_identifier_idx"
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "auth"."verification" ("identifier");

-- add FK "account_userId_fkey"
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'account_userId_fkey' AND conrelid = 'auth.account'::regclass
  ) THEN
    EXECUTE $ddl$ALTER TABLE "auth"."account"
ADD CONSTRAINT "account_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "auth"."user" ("id")
ON DELETE CASCADE$ddl$;
  END IF;
END $$;

-- add FK "session_userId_fkey"
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_userId_fkey' AND conrelid = 'auth.session'::regclass
  ) THEN
    EXECUTE $ddl$ALTER TABLE "auth"."session"
ADD CONSTRAINT "session_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "auth"."user" ("id")
ON DELETE CASCADE$ddl$;
  END IF;
END $$;
