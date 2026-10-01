import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserBalance1790407200000 implements MigrationInterface {
    name = 'AddUserBalance1790407200000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "balance" integer NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "CHK_users_balance_nonnegative" CHECK ("balance" >= 0)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_balance_nonnegative"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "balance"`);
    }

}
