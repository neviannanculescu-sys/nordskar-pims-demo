/**
 * Integration tests: Auth flow
 *
 * Prerequisites:
 *   - PostgreSQL running with migrations 0001 + 0002 applied
 *   - DATABASE_URL env var set to the test DB
 *   - npm run db:bootstrap (populates tracking table)
 *
 * Run:
 *   DATABASE_URL=postgresql://vettest:vettest@localhost:5432/vetdb_test \
 *   JWT_SECRET=test-secret-64chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
 *   JWT_REFRESH_SECRET=test-refresh-64chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
 *   npm run test:integration -- --testPathPattern=auth
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DbTestHelper, TestUser } from './helpers/db-test.helper';

describe('Auth (integration)', () => {
  let app: INestApplication;
  let db: DbTestHelper;
  let adminUser: TestUser;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');

    db = new DbTestHelper(databaseUrl);
    adminUser = await db.createTestUser({ role: 'admin' });

    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await db.query(`DELETE FROM users WHERE email = $1`, [adminUser.email]);
    await db.end();
    await app.close();
  });

  describe('POST /api/v1/auth/login', () => {
    it('returns 200 with tokens on valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: adminUser.email, password: adminUser.password })
        .expect(200);

      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('refreshToken');
      expect(res.body.data.expiresIn).toBe(900);
    });

    it('returns 401 for wrong password', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: adminUser.email, password: 'WrongPass999!' })
        .expect(401);
    });

    it('returns 401 for non-existent email', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@vet.ro', password: 'AnyPass123!' })
        .expect(401);
    });

    it('returns 400 for invalid email format', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: 'AnyPass123!' })
        .expect(400);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('returns new tokens on valid refresh token', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: adminUser.email, password: adminUser.password });

      const { refreshToken } = loginRes.body.data;

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(res.body.data).toHaveProperty('accessToken');
    });

    it('returns 401 for tampered refresh token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'eyJhbGciOiJIUzI1NiJ9.tampered.signature' })
        .expect(401);
    });
  });

  describe('GET /api/v1/health', () => {
    it('returns 200 without authentication', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.timestamp).toBeDefined();
    });
  });
});
