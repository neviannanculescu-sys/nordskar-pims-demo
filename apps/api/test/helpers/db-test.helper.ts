/**
 * Helpers for integration tests against a real PostgreSQL database.
 *
 * Requires env var DATABASE_URL pointing to a test-only database.
 * Recommended: use a Docker postgres container with a dedicated test DB.
 *
 *   docker run -d -p 5432:5432 \
 *     -e POSTGRES_USER=vettest \
 *     -e POSTGRES_PASSWORD=vettest \
 *     -e POSTGRES_DB=vetdb_test \
 *     postgres:15
 *
 *   DATABASE_URL=postgresql://vettest:vettest@localhost:5432/vetdb_test
 */
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: string;
}

export class DbTestHelper {
  private pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }

  async createTestUser(overrides: Partial<TestUser> = {}): Promise<TestUser> {
    const user: TestUser = {
      id:       overrides.id       ?? crypto.randomUUID(),
      email:    overrides.email    ?? `test-${Date.now()}@vet.ro`,
      password: overrides.password ?? 'Test123!@#',
      role:     overrides.role     ?? 'admin',
    };

    const hash = await bcrypt.hash(user.password, 10);
    await this.query(
      `INSERT INTO users (id, email, password_hash, role, first_name, last_name, is_active)
       VALUES ($1, $2, $3, $4, 'Test', 'User', true)`,
      [user.id, user.email, hash, user.role],
    );
    return user;
  }

  async cleanTestData(tables: string[]): Promise<void> {
    // Delete in reverse FK order to avoid constraint violations
    for (const table of tables) {
      await this.query(`DELETE FROM ${table} WHERE email LIKE 'test-%' OR id::text LIKE 'test-%'`);
    }
  }

  async cleanOwnersByPhone(phonePrimary: string): Promise<void> {
    await this.query(`UPDATE owners SET deleted_at = NOW() WHERE phone_primary = $1`, [phonePrimary]);
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
