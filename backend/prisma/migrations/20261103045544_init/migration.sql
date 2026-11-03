-- CreateEnum
CREATE TYPE "SkillLevel" AS ENUM ('beginner', 'average', 'confident');

-- CreateTable
CREATE TABLE "SwiggyAuth" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "clientInformation" JSONB,
    "discoveryState" JSONB,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "tokenMeta" JSONB,
    "expiresAt" TIMESTAMP(3),
    "codeVerifier" TEXT,
    "state" TEXT,
    "stateCreatedAt" TIMESTAMP(3),
    "disconnectedReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SwiggyAuth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "addressId" TEXT,
    "addressLine" TEXT,
    "defaultServings" INTEGER NOT NULL DEFAULT 2,
    "skillLevel" "SkillLevel" NOT NULL DEFAULT 'average',
    "hourlyTimeValue" INTEGER NOT NULL DEFAULT 200,
    "hasBasicStaples" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);
