import { MigrationInterface, QueryRunner } from "typeorm";

export class NewDBMig1784735060930 implements MigrationInterface {
    name = 'NewDBMig1784735060930'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "user_type_id" uuid`);
        await queryRunner.query(`ALTER TABLE "users" ADD "type" character varying`);
        await queryRunner.query(`ALTER TABLE "users" ADD "date_of_birth" date`);
        await queryRunner.query(`ALTER TABLE "users" ADD "is_active" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_cd9740f36970d326b3f65bd5e99" FOREIGN KEY ("user_type_id") REFERENCES "user_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_cd9740f36970d326b3f65bd5e99"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "is_active"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "date_of_birth"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "type"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "user_type_id"`);
    }

}
