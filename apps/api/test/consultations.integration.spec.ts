/**
 * Integration tests: Consultations module
 *
 * Prerequisites: DATABASE_URL pointing to a running PostgreSQL test DB
 * with all migrations applied (including 0001_initial_phase1 + 0002_audit_appointments).
 *
 * Run:
 *   DATABASE_URL=... JWT_SECRET=... JWT_REFRESH_SECRET=... \
 *   npm run test:integration -- --testPathPattern=consultations
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule }      from '../src/app.module';
import { DbTestHelper, TestUser } from './helpers/db-test.helper';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ConsultationBody {
  appointmentId?:   string;
  petId?:           string;
  ownerId?:         string;
  veterinarianId?:  string;
  consultationDate?: string;
  type?:            string;
  chiefComplaint?:  string;
  diagnosisPrimary?: string;
  [key: string]: unknown;
}

describe('Consultations (integration)', () => {
  let app:  INestApplication;
  let db:   DbTestHelper;

  // Test users
  let adminUser:  TestUser;
  let vetUser:    TestUser;
  let assistUser: TestUser;

  // Tokens
  let adminToken:  string;
  let vetToken:    string;
  let assistToken: string;

  // Fixtures
  let ownerId:        string;
  let petId:          string;
  let veterinarianId: string;
  let appointmentId:  string;

  // Cleanup tracking
  const createdConsIds: string[] = [];

  // ---------------------------------------------------------------------------
  // Auth helper
  // ---------------------------------------------------------------------------
  async function getToken(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password });
    return res.body.data.accessToken as string;
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL required');

    db = new DbTestHelper(databaseUrl);

    [adminUser, vetUser, assistUser] = await Promise.all([
      db.createTestUser({ role: 'admin' }),
      db.createTestUser({ role: 'vet_doctor' }),
      db.createTestUser({ role: 'assistant' }),
    ]);

    // Owner
    const [owner] = await db.query<{ id: string }>(
      `INSERT INTO owners (id, type, first_name, last_name, phone_primary, gdpr_consent, gdpr_consent_date)
       VALUES (gen_random_uuid(), 'individual', 'Cons', 'Test', '0799500600', true, NOW())
       RETURNING id`,
    );
    ownerId = owner.id;

    // Pet
    const [breed] = await db.query<{ id: string; species_id: string }>(
      `SELECT id, species_id FROM breeds LIMIT 1`,
    );
    if (!breed) throw new Error('No breeds in DB — run migrations first');

    const [pet] = await db.query<{ id: string }>(
      `INSERT INTO pets (id, owner_id, name, species_id, breed_id, date_of_birth, sex)
       VALUES (gen_random_uuid(), $1, 'ConsPet', $2, $3, '2021-05-01', 'female')
       RETURNING id`,
      [ownerId, breed.species_id, breed.id],
    );
    petId = pet.id;

    // Veterinarian — must link to vetUser so complete() can resolve userId → vet.id
    const [vet] = await db.query<{ id: string }>(
      `INSERT INTO veterinarians (id, user_id, first_name, last_name, license_number, is_available)
       VALUES (gen_random_uuid(), $1, 'Dr', 'Test', $2, true)
       RETURNING id`,
      [vetUser.id, `LIC-INT-${Date.now()}`],
    );
    veterinarianId = vet.id;

    // Appointment for linking tests
    const [appt] = await db.query<{ id: string }>(
      `INSERT INTO appointments
         (id, pet_id, owner_id, veterinarian_id, scheduled_at, duration_min, type, status, reason, created_by)
       VALUES
         (gen_random_uuid(), $1, $2, $3, NOW() + INTERVAL '1 hour', 30, 'routine', 'confirmed', 'Integration test', $4)
       RETURNING id`,
      [petId, ownerId, veterinarianId, adminUser.id],
    );
    appointmentId = appt.id;

    // Boot NestJS
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    [adminToken, vetToken, assistToken] = await Promise.all([
      getToken(adminUser.email, adminUser.password),
      getToken(vetUser.email, vetUser.password),
      getToken(assistUser.email, assistUser.password),
    ]);
  });

  afterAll(async () => {
    // Soft-delete consultations
    if (createdConsIds.length) {
      await db.query(
        `UPDATE consultations SET deleted_at = NOW() WHERE id = ANY($1)`,
        [createdConsIds],
      );
    }
    // Cleanup fixtures
    await db.query(`UPDATE appointments SET deleted_at = NOW() WHERE id = $1`, [appointmentId]);
    await db.query(`UPDATE pets        SET deleted_at = NOW() WHERE id = $1`, [petId]);
    await db.query(`UPDATE owners      SET deleted_at = NOW() WHERE id = $1`, [ownerId]);
    await db.query(`DELETE FROM veterinarians WHERE id = $1`, [veterinarianId]);
    await db.query(`DELETE FROM users WHERE id = ANY($1)`, [
      [adminUser.id, vetUser.id, assistUser.id],
    ]);
    await db.end();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Helper: create consultation via API
  // ---------------------------------------------------------------------------
  async function createCons(
    token:          string,
    overrides:      ConsultationBody = {},
    expectedStatus: number = 201,
  ) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/consultations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        petId,
        ownerId,
        veterinarianId,
        consultationDate: new Date().toISOString(),
        type:             'routine',
        chiefComplaint:   'Integration test complaint',
        diagnosisPrimary: 'Integration test diagnosis',
        ...overrides,
      })
      .expect(expectedStatus);

    if (expectedStatus === 201 && res.body.id) {
      createdConsIds.push(res.body.id as string);
    }
    return res;
  }

  // ---------------------------------------------------------------------------
  // 1. RBAC — only MEDICAL_ROLES can read; RECEPTIONIST cannot create
  // ---------------------------------------------------------------------------
  describe('RBAC', () => {
    it('returns 401 without token on GET /consultations', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/consultations')
        .expect(401);
    });

    it('VET_DOCTOR can create a consultation', async () => {
      const res = await createCons(vetToken);
      expect(res.body.status).toBe('open');
      expect(res.body.petId).toBe(petId);
    });

    it('ASSISTANT can create a consultation', async () => {
      const res = await createCons(assistToken);
      expect(res.body.status).toBe('open');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Autopopulation from appointment
  // ---------------------------------------------------------------------------
  describe('Autopopulation from appointment', () => {
    it('fills petId/ownerId/veterinarianId/consultationDate from appointment when omitted', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/consultations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          appointmentId,
          // petId / ownerId / veterinarianId / consultationDate intentionally omitted
          chiefComplaint:   'Walk-in via appointment',
          diagnosisPrimary: 'Routine check',
          type:             'routine',
        })
        .expect(201);

      expect(res.body.petId).toBe(petId);
      expect(res.body.ownerId).toBe(ownerId);
      expect(res.body.veterinarianId).toBe(veterinarianId);
      expect(res.body.appointmentId).toBe(appointmentId);
      createdConsIds.push(res.body.id as string);
    });

    it('returns 409 when a second consultation targets the same appointment', async () => {
      await createCons(adminToken, { appointmentId }, 409);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Open → complete: sign authorization
  // ---------------------------------------------------------------------------
  describe('Complete + signing', () => {
    let consId: string;

    beforeAll(async () => {
      const res = await createCons(vetToken);
      consId = res.body.id as string;
    });

    it('blocks ASSISTANT from completing a consultation', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/consultations/${consId}/complete`)
        .set('Authorization', `Bearer ${assistToken}`)
        .expect(403);
    });

    it('VET_DOCTOR signs their own consultation — signedBy resolves to their vet record', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/consultations/${consId}/complete`)
        .set('Authorization', `Bearer ${vetToken}`)
        .expect(200);

      expect(res.body.status).toBe('completed');
      expect(res.body.signedBy).toBe(veterinarianId);
      expect(res.body.signedAt).not.toBeNull();
    });

    it('completed consultation is immutable — PATCH returns 400', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/consultations/${consId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ treatmentPlan: 'Attempted edit' })
        .expect(400);
    });

    it('completed consultation cannot be deleted — DELETE returns 400', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/consultations/${consId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('ADMIN must supply signingVetId — returns 400 without it', async () => {
      const open = await createCons(adminToken);
      await request(app.getHttpServer())
        .post(`/api/v1/consultations/${open.body.id}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(400);
    });

    it('ADMIN with valid signingVetId completes the consultation', async () => {
      const open = await createCons(adminToken);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/consultations/${open.body.id}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ signingVetId: veterinarianId })
        .expect(200);

      expect(res.body.status).toBe('completed');
      expect(res.body.signedBy).toBe(veterinarianId);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Cancel: only open, deleted_at stays NULL
  // ---------------------------------------------------------------------------
  describe('Cancel', () => {
    let consId: string;

    beforeAll(async () => {
      const res = await createCons(vetToken);
      consId = res.body.id as string;
    });

    it('cancels an open consultation without deleting it', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/consultations/${consId}/cancel`)
        .set('Authorization', `Bearer ${vetToken}`)
        .expect(200);

      expect(res.body.status).toBe('cancelled');

      const [row] = await db.query<{ deleted_at: string | null }>(
        `SELECT deleted_at FROM consultations WHERE id = $1`,
        [consId],
      );
      expect(row.deleted_at).toBeNull();
    });

    it('cannot cancel a cancelled consultation', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/consultations/${consId}/cancel`)
        .set('Authorization', `Bearer ${vetToken}`)
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Listing + pagination
  // ---------------------------------------------------------------------------
  describe('Listing', () => {
    it('returns paginated consultations filtered by petId', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/consultations?petId=${petId}&limit=10`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.meta).toHaveProperty('total');
      expect(
        (res.body.data as { petId: string }[]).every((c) => c.petId === petId),
      ).toBe(true);
    });

    it('filters by status=open', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/consultations?status=open&limit=20`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(
        (res.body.data as { status: string }[]).every((c) => c.status === 'open'),
      ).toBe(true);
    });
  });
});
