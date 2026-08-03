import { MigrationInterface, QueryRunner } from "typeorm";

// CashEntriesGeneralAccountLink1785767095000 renamed cash_payment_entries.crAccount
// -> legacy_cr_account and cash_received_entries.drAccount -> legacy_dr_account, but
// left the original NOT NULL constraint in place. The entities now populate the new
// crAccountId/drAccountId FK columns instead, leaving legacy_* unset on every new
// insert, which violates that leftover NOT NULL constraint.
export class MakeLegacyCashAccountColumnsNullable1785853200000 implements MigrationInterface {
    name = 'MakeLegacyCashAccountColumnsNullable1785853200000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "cash_payment_entries" ALTER COLUMN "legacy_cr_account" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "cash_received_entries" ALTER COLUMN "legacy_dr_account" DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "cash_received_entries" ALTER COLUMN "legacy_dr_account" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "cash_payment_entries" ALTER COLUMN "legacy_cr_account" SET NOT NULL`);
    }

}
