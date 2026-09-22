import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProductStock1790032272412 implements MigrationInterface {
    name = 'AddProductStock1790032272412'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "products" ADD "stock" integer NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "CHK_products_stock_nonnegative" CHECK ("stock" >= 0)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "CHK_products_stock_nonnegative"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "stock"`);
    }

}
