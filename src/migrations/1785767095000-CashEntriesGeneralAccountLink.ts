import { MigrationInterface, QueryRunner } from "typeorm";

export class CashEntriesGeneralAccountLink1785767095000 implements MigrationInterface {
    name = 'CashEntriesGeneralAccountLink1785767095000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // cash_payment_entries: crAccount was a free-text string, now a real FK to general_accounts (Cash type)
        await queryRunner.query(`ALTER TABLE "cash_payment_entries" RENAME COLUMN "crAccount" TO "legacy_cr_account"`);
        await queryRunner.query(`ALTER TABLE "cash_payment_entries" ADD "crAccountId" uuid`);
        await queryRunner.query(`ALTER TABLE "cash_payment_entries" ADD CONSTRAINT "FK_cash_payment_cr_general_account" FOREIGN KEY ("crAccountId") REFERENCES "general_accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);

        // cash_received_entries: drAccount was a free-text string, now a real FK to general_accounts (Cash type)
        await queryRunner.query(`ALTER TABLE "cash_received_entries" RENAME COLUMN "drAccount" TO "legacy_dr_account"`);
        await queryRunner.query(`ALTER TABLE "cash_received_entries" ADD "drAccountId" uuid`);
        await queryRunner.query(`ALTER TABLE "cash_received_entries" ADD CONSTRAINT "FK_cash_received_dr_general_account" FOREIGN KEY ("drAccountId") REFERENCES "general_accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "cash_received_entries" DROP CONSTRAINT "FK_cash_received_dr_general_account"`);
        await queryRunner.query(`ALTER TABLE "cash_received_entries" DROP COLUMN "drAccountId"`);
        await queryRunner.query(`ALTER TABLE "cash_received_entries" RENAME COLUMN "legacy_dr_account" TO "drAccount"`);

        await queryRunner.query(`ALTER TABLE "cash_payment_entries" DROP CONSTRAINT "FK_cash_payment_cr_general_account"`);
        await queryRunner.query(`ALTER TABLE "cash_payment_entries" DROP COLUMN "crAccountId"`);
        await queryRunner.query(`ALTER TABLE "cash_payment_entries" RENAME COLUMN "legacy_cr_account" TO "crAccount"`);
    }

}
