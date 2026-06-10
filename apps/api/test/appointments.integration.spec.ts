/**
 * Integration tests: Appointments module
 *
 * Prerequisites: DATABASE_URL pointing to a running PostgreSQL test DB.
 *
 * Run:
 *   DATABASE_URL=... JWT_SECRET=... JWT_REFRESH_SECRET=... \
 *   npm run test:integration -- --testPathPattern=appointments
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DbTestHelper, TestUser } from './helpers/db-test.helper';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AppointmentPayload {
  petId:          string;
  ownerId:        string;
  veterinarianId?: string;
  roomId?:         string;
  scheduledAt:    string;
  durationMin?:   number;
  type:           string;
  reason:         string;
  source?:        string;
}

describe('Appointments (integration)', () => {
  let app: INestApplication;
  let db:  DbTestHelper;

  // Test users
  let adminUser:       TestUser;
  let receptionistUser: TestUser;
  let vetUser:         TestUser;

  // JWT tokens
  let adminToken:       string;
  let receptionistToken: string;

  // Test fixture IDs (created once, used across test blocks)
  let ownerId:        string;
  let petId:          string;
  let veterinarianId: string;
  let roomId:         string;

  // Tracked appointment IDs for cleanup
  const createdApptIds: string[] = [];

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
    if (!databaseUrl) throw new Error('DATABASE_URL required for integration tests');

    db = new DbTestHelper(databaseUrl);

    // Create test users
    [adminUser, receptionistUser, vetUser] = await Promise.all([
      db.createTestUser({ role: 'admin' }),
      db.createTestUser({ role: 'receptionist' }),
      db.createTestUser({ role: 'vet_doctor' }),
    ]);

    // Create supporting fixtures directly in DB
    // Owner
    const [owner] = await db.query<{ id: string }>(
      `INSERT INTO owners (id, type, first_name, last_name, phone_primary, gdpr_consent, gdpr_consent_date)
       VALUES (gen_random_uuid(), 'individual', 'Integrare', 'Appt', '0799000111', true, NOW())
       RETURNING id`,
    );
    ownerId = owner.id;

    // Breed — pick first available
    const [breed] = await db.query<{ id: string }>(`SELECT id FROM breeds LIMIT 1`);
    if (!breed) throw new Error('No breeds in DB — run migrations first');

    // Pet
    const [pet] = await db.query<{ id: string }>(
      `INSERT INTO pets (id, owner_id, name, species_id, breed_id, date_of_birth, sex)
       SELECT gen_random_uuid(), $1, 'TestPet', b.species_id, b.id, '2022-01-01', 'male'
       FROM breeds b WHERE b.id = $2
       RETURNING id`,
      [ownerId, breed.id],
    );
    petId = pet.id;

    // Veterinarian — pick first available
    const [vet] = await db.query<{ id: string }>(
      `SELECT id FROM veterinarians WHERE is_available = true LIMIT 1`,
    );
    if (!vet) throw new Error('No available veterinarians in DB — seed test data first');
    veterinarianId = vet.id;

    // Room — pick first active
    const [room] = await db.query<{ id: string }>(
      `SELECT id FROM rooms WHERE is_active = true LIMIT 1`,
    );
    if (!room) throw new Error('No active rooms in DB — seed test data first');
    roomId = room.id;

    // Boot NestJS
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    // Tokens
    [adminToken, receptionistToken] = await Promise.all([
      getToken(adminUser.email, adminUser.password),
      getToken(receptionistUser.email, receptionistUser.password),
    ]);
  });

  afterAll(async () => {
    // Soft-delete appointments created during tests (don't physical-delete per CLAUDE.md)
    if (createdApptIds.length) {
      await db.query(
        `UPDATE appointments SET deleted_at = NOW() WHERE id = ANY($1)`,
        [createdApptIds],
      );
    }
    // Physical cleanup of fixtures created only for this test run
    if (petId)    await db.query(`UPDATE pets   SET deleted_at = NOW() WHERE id = $1`, [petId]);
    if (ownerId)  await db.query(`UPDATE owners SET deleted_at = NOW() WHERE id = $1`, [ownerId]);
    await db.query(`DELETE FROM users WHERE id = ANY($1)`, [[adminUser.id, receptionistUser.id, vetUser.id]]);

    await db.end();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Helper: create appointment via API
  // ---------------------------------------------------------------------------
  async function createAppt(
    token: string,
    overrides: Partial<AppointmentPayload> = {},
    expectedStatus = 201,
  ) {
    const scheduledAt = overrides.scheduledAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        petId,
        ownerId,
        veterinarianId,
        roomId,
        scheduledAt,
        durationMin: 30,
        type:        'routine',
        reason:      'Integration test appointment',
        ...overrides,
      })
      .expect(expectedStatus);

    if (expectedStatus === 201 && res.body.id) {
      createdApptIds.push(res.body.id as string);
    }
    return res;
  }

  // ---------------------------------------------------------------------------
  // 1. Slot conflict detection
  // ---------------------------------------------------------------------------
  describe('Slot conflict', () => {
    const slotTime = '2026-07-01T09:00:00.000Z';

    it('creates the first appointment in a slot', async () => {
      const res = await createAppt(adminToken, { scheduledAt: slotTime, durationMin: 60 });
      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('scheduled');
    });

    it('returns 409 when a second appointment overlaps the same vet slot', async () => {
      // Starts 30 min into the existing 60-min appointment
      await createAppt(
        adminToken,
        { scheduledAt: '2026-07-01T09:30:00.000Z', durationMin: 30 },
        409,
      );
    });

    it('returns 409 when a second appointment overlaps the same room slot', async () => {
      // Use different vet (no vet assigned) but same room — expect room conflict
      await createAppt(
        adminToken,
        { scheduledAt: '2026-07-01T09:30:00.000Z', durationMin: 30, veterinarianId: undefined },
        409,
      );
    });

    it('allows a non-overlapping appointment in the same slot after cancel', async () => {
      // Cancel the first appointment — slot should be free again
      const firstId = createdApptIds[createdApptIds.length - 2] ?? createdApptIds[0];
      await request(app.getHttpServer())
        .post(`/api/v1/appointments/${firstId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Freeing slot for test' })
        .expect(200);

      // Now the slot should be free
      const res = await createAppt(adminToken, { scheduledAt: slotTime, durationMin: 30 });
      expect(res.body.status).toBe('scheduled');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Check-in flow (scheduled → confirmed → checked_in)
  // ---------------------------------------------------------------------------
  describe('Check-in flow', () => {
    let apptId: string;

    beforeAll(async () => {
      const res = await createAppt(adminToken, {
        scheduledAt: '2026-07-02T10:00:00.000Z',
      });
      apptId = res.body.id as string;
    });

    it('receptionist confirms the appointment', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/appointments/${apptId}/confirm`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(200);

      expect(res.body.status).toBe('confirmed');
    });

    it('receptionist checks in the appointment', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/appointments/${apptId}/check-in`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(200);

      expect(res.body.status).toBe('checked_in');
    });

    it('blocks PATCH on a checked_in appointment', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/appointments/${apptId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Attempted edit' })
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Cancel / no-show — verify deleted_at remains NULL
  // ---------------------------------------------------------------------------
  describe('Cancel and no-show', () => {
    let cancelId: string;
    let noShowId: string;

    beforeAll(async () => {
      const [r1, r2] = await Promise.all([
        createAppt(adminToken, { scheduledAt: '2026-07-03T08:00:00.000Z' }),
        createAppt(adminToken, { scheduledAt: '2026-07-03T09:00:00.000Z' }),
      ]);
      cancelId = r1.body.id as string;
      noShowId = r2.body.id as string;
    });

    it('cancels an appointment without deleting it', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/appointments/${cancelId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Owner request' })
        .expect(200);

      expect(res.body.status).toBe('cancelled');

      // Verify in DB that deleted_at is still NULL
      const [row] = await db.query<{ deleted_at: string | null; notes: string }>(
        `SELECT deleted_at, notes FROM appointments WHERE id = $1`,
        [cancelId],
      );
      expect(row.deleted_at).toBeNull();
      expect(row.notes).toContain('[CANCELLED]');
      expect(row.notes).toContain('Owner request');
    });

    it('marks no-show without deleting the record', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/appointments/${noShowId}/no-show`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(200);

      expect(res.body.status).toBe('no_show');

      // Verify in DB that deleted_at is NULL
      const [row] = await db.query<{ deleted_at: string | null }>(
        `SELECT deleted_at FROM appointments WHERE id = $1`,
        [noShowId],
      );
      expect(row.deleted_at).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Calendar listing per veterinarian
  // ---------------------------------------------------------------------------
  describe('Calendar listing', () => {
    beforeAll(async () => {
      // Two appointments for the same vet on the same day
      await Promise.all([
        createAppt(adminToken, { scheduledAt: '2026-07-10T08:00:00.000Z' }),
        createAppt(adminToken, { scheduledAt: '2026-07-10T14:00:00.000Z' }),
      ]);
    });

    it('returns appointments for the given date (day view)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/appointments/calendar')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ date: '2026-07-10', veterinarianId, view: 'day' })
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const ids = (res.body as { id: string }[]).map((a) => a.id);
      // Both our appointments should appear (there may be others in the DB)
      const ourAppts = ids.filter((id) => createdApptIds.includes(id));
      expect(ourAppts.length).toBeGreaterThanOrEqual(2);
    });

    it('returns appointments for the ISO week containing the date (week view)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/appointments/calendar')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ date: '2026-07-10', veterinarianId, view: 'week' })
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      // At minimum the 2 appointments from 2026-07-10 should be in the week (Mon 6 Jul – Sun 12 Jul 2026)
      const ids = (res.body as { id: string }[]).map((a) => a.id);
      const ourAppts = ids.filter((id) => createdApptIds.includes(id));
      expect(ourAppts.length).toBeGreaterThanOrEqual(2);
    });

    it('returns empty array when no vet appointments on a different date', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/appointments/calendar')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ date: '2026-07-15', veterinarianId, view: 'day' })
        .expect(200);

      // May include other fixtures but our specific appts should not be here
      const ourAppts = (res.body as { id: string }[]).filter(
        (a) => a.id === createdApptIds[createdApptIds.length - 1]
      );
      expect(ourAppts.length).toBe(0);
    });
  });
});
