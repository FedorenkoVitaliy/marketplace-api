import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuth1790700000000 implements MigrationInterface {
  name = 'AddAuth1790700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "password_hash" text`);
    await queryRunner.query(`
      ALTER TABLE "users" ADD "role" text NOT NULL DEFAULT 'buyer'
        CONSTRAINT "CHK_users_role" CHECK ("role" IN ('buyer', 'seller', 'admin'))
    `);

    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" bigint NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "family_id" uuid NOT NULL,
        "token_hash" text NOT NULL UNIQUE,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "used_at" TIMESTAMPTZ,
        "revoked_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" ("family_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "refresh_tokens_family_idx"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "password_hash"`);
  }
}
