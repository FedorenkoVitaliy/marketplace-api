import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFiles1790800000000 implements MigrationInterface {
  name = 'AddFiles1790800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "files" (
        "key" text PRIMARY KEY,
        "owner_id" bigint NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "status" text NOT NULL
          CONSTRAINT "CHK_files_status" CHECK ("status" IN ('PENDING', 'COMPLETED')),
        "size" bigint,
        "upload_id" text,
        "idempotency_key" text
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "files_idempotency_key_idx"
        ON "files" ("idempotency_key")
        WHERE "idempotency_key" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "files_idempotency_key_idx"`);
    await queryRunner.query(`DROP TABLE "files"`);
  }
}
