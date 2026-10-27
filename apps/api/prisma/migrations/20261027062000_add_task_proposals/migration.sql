-- AlterEnum
BEGIN;
CREATE TYPE "ProposalType_new" AS ENUM ('postpone', 'cancel');
ALTER TABLE "task_proposals" ALTER COLUMN "type" TYPE "ProposalType_new" USING ("type"::text::"ProposalType_new");
ALTER TYPE "ProposalType" RENAME TO "ProposalType_old";
ALTER TYPE "ProposalType_new" RENAME TO "ProposalType";
DROP TYPE "ProposalType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "task_proposals" DROP CONSTRAINT "task_proposals_proposed_by_id_fkey";

-- DropForeignKey
ALTER TABLE "task_proposals" DROP CONSTRAINT "task_proposals_task_id_fkey";

-- AlterTable
ALTER TABLE "task_proposals" DROP COLUMN "proposed_by_id",
DROP COLUMN "proposed_deadline",
DROP COLUMN "rejection_reason",
DROP COLUMN "reviewed_by_id",
DROP COLUMN "updated_at",
ADD COLUMN     "review_reason" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewer_id" TEXT,
ADD COLUMN     "user_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "has_pending_proposal" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "task_proposals" ADD CONSTRAINT "task_proposals_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_proposals" ADD CONSTRAINT "task_proposals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
