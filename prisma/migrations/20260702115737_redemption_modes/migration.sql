-- CreateEnum
CREATE TYPE "RedemptionMode" AS ENUM ('total_views', 'unique_clients');

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'already_redeemed';

-- AlterTable
ALTER TABLE "links" ADD COLUMN     "batch_id" TEXT,
ADD COLUMN     "redemption_mode" "RedemptionMode" NOT NULL DEFAULT 'total_views';

-- CreateTable
CREATE TABLE "link_redemptions" (
    "id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "redeemed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "link_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "link_redemptions_link_id_idx" ON "link_redemptions"("link_id");

-- CreateIndex
CREATE UNIQUE INDEX "link_redemptions_link_id_client_id_key" ON "link_redemptions"("link_id", "client_id");

-- CreateIndex
CREATE INDEX "links_batch_id_idx" ON "links"("batch_id");

-- AddForeignKey
ALTER TABLE "link_redemptions" ADD CONSTRAINT "link_redemptions_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
