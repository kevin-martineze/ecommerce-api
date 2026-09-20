-- DropForeignKey
ALTER TABLE "store_payment_accounts" DROP CONSTRAINT "store_payment_accounts_store_id_fkey";

-- AddForeignKey
ALTER TABLE "store_payment_accounts" ADD CONSTRAINT "store_payment_accounts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
