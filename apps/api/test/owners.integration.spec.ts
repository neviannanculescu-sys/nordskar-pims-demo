/**
 * Integration tests: Owners CRUD + RBAC
 *
 * Same prerequisites as auth.integration.spec.ts
 *
 * Run:
 *   DATABASE_URL=... JWT_SECRET=... JWT_REFRESH_SECRET=... \
 *   npm run test:integration -- --testPathPattern=owners
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DbTestHelper, TestUser } from './helpers/db-test.helper';

const TEST_PHONE = '0799888777';

describe('Owners CRUD + RBAC (integration)', () => {
  let app: INestApplication;
  let db: DbTestHelper;
  let adminUser: TestUser;
  let accountantUser: TestUser;
  let adminToken: string;
  let accountantToken: string;
  let createdOwnerId: string;

  async function getToken(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password });
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL required');

    db = new DbTestHelper(databaseUrl);
    [adminUser, accountantUser] = await Promise.all([
      db.createTestUser({ role: 'admin' }),
      db.createTestUser({ role: 'accountant' }),
    ]);

    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    [adminToken, accountantToken] = await Promise.all([
      getToken(adminUser.email, adminUser.password),
      getToken(accountantUser.email, accountantUser.password),
    ]);
  });

  afterAll(async () => {
    // Soft-delete the test owner if created
    if (createdOwnerId) {
      await db.query(`UPDATE owners SET deleted_at = NOW() WHERE id = $1`, [createdOwnerId]);
    }
    await db.query(`DELETE FROM users WHERE id = ANY($1)`, [[adminUser.id, accountantUser.id]]);
    await db.end();
    await app.close();
  });

  describe('RBAC: GET /api/v1/owners', () => {
    it('returns 200 for admin', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/owners')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('returns 403 for accountant (excluded from medical data)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/owners')
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(403);
    });

    it('returns 401 without token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/owners')
        .expect(401);
    });
  });

  describe('POST /api/v1/owners', () => {
    it('creates owner and returns 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/owners')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type:         'individual',
          firstName:    'Ion',
          lastName:     'Integrare',
          phonePrimary: TEST_PHONE,
          gdprConsent:  true,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.gdprConsent).toBe(true);
      expect(res.body.gdprConsentDate).not.toBeNull();
      createdOwnerId = res.body.id as string;
    });

    it('returns 409 for duplicate phone', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/owners')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type:         'individual',
          firstName:    'Alt',
          lastName:     'Popescu',
          phonePrimary: TEST_PHONE,
          gdprConsent:  false,
        })
        .expect(409);
    });

    it('returns 400 when required field missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/owners')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'individual', firstName: 'Fara' })
        .expect(400);
    });
  });

  describe('PATCH /api/v1/owners/:id', () => {
    it('updates owner successfully', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/owners/${createdOwnerId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ addressCity: 'Cluj-Napoca' })
        .expect(200);

      expect(res.body.addressCity).toBe('Cluj-Napoca');
    });

    it('returns 403 for accountant', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/owners/${createdOwnerId}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({ addressCity: 'Timisoara' })
        .expect(403);
    });
  });

  describe('GET /api/v1/owners (search)', () => {
    it('returns paginated results with meta', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/owners?page=1&limit=5')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.meta).toHaveProperty('total');
      expect(res.body.meta).toHaveProperty('totalPages');
    });

    it('filters by type=individual', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/owners?type=individual')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.every((o: { type: string }) => o.type === 'individual')).toBe(true);
    });
  });
});
