-- DropForeignKey
ALTER TABLE "ai_replies" DROP CONSTRAINT "ai_replies_store_id_fkey";

-- AlterTable
ALTER TABLE "ai_replies" ALTER COLUMN "id" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "ai_replies" ADD CONSTRAINT "ai_replies_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "ai_replies_store_created_idx" RENAME TO "ai_replies_store_id_created_at_idx";
