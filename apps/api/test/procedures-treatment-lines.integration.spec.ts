/**
 * Integration tests: procedures + treatment_lines
 *
 * Flow tested:
 *   consultation (open) → add procedure → add treatment line → dispense
 *   → complete consultation → verify records are locked
 *
 * Prerequisite: DATABASE_URL with 0003_procedures_treatment_lines migration applied.
 *
 * Run:
 *   DATABASE_URL=... JWT_SECRET=... JWT_REFRESH_SECRET=... \
 *   npm run test:integration -- --testPathPattern=procedures-treatment
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule }      from '../src/app.module';
import { DbTestHelper, TestUser } from './helpers/db-test.helper';

describe('Procedures + Treatment Lines (integration)', () => {
  let app:  INestApplication;
  let db:   DbTestHelper;

  let adminUser: TestUser;
  let vetUser:   TestUser;
  let assistUser: TestUser;

  let adminToken: string;
  let vetToken:   string;
  let assistToken: string;

  // Fixtures
  let ownerId:        string;
  let petId:          string;
  let veterinarianId: string;
  let consultationId: string;

  // Cleanup
  const createdProcIds: string[] = [];
  const createdLineIds: string[] = [];

  // ---------------------------------------------------------------------------

  async function getToken(email: string, password: string) {
    const r = await request(app.getHttpServer())
      .post('/api/v1/auth/login').send({ email, password });
    return r.body.data.accessToken as string;
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
       VALUES (gen_random_uuid(),'individual','Proc','Test','0799700800',true,NOW()) RETURNING id`,
    );
    ownerId = owner.id;

    // Pet
    const [breed] = await db.query<{ id: string; species_id: string }>(
      `SELECT id, species_id FROM breeds LIMIT 1`,
    );
    const [pet] = await db.query<{ id: string }>(
      `INSERT INTO pets (id,owner_id,name,species_id,breed_id,date_of_birth,sex)
       VALUES (gen_random_uuid(),$1,'ProcPet',$2,$3,'2020-01-01','male') RETURNING id`,
      [ownerId, breed.species_id, breed.id],
    );
    petId = pet.id;

    // Vet linked to vetUser
    const [vet] = await db.query<{ id: string }>(
      `INSERT INTO veterinarians (id,user_id,first_name,last_name,license_number,is_available)
       VALUES (gen_random_uuid(),$1,'DrProc','Test',$2,true) RETURNING id`,
      [vetUser.id, `LIC-PROC-${Date.now()}`],
    );
    veterinarianId = vet.id;

    // Open consultation
    const [cons] = await db.query<{ id: string }>(
      `INSERT INTO consultations
         (id,pet_id,owner_id,veterinarian_id,consultation_date,type,chief_complaint,diagnosis_primary,status)
       VALUES
         (gen_random_uuid(),$1,$2,$3,NOW(),'routine','Limping','Sprain','open')
       RETURNING id`,
      [petId, ownerId, veterinarianId],
    );
    consultationId = cons.id;

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
    if (createdLineIds.length)
      await db.query(`UPDATE treatment_lines SET deleted_at=NOW() WHERE id=ANY($1)`, [createdLineIds]);
    if (createdProcIds.length)
      await db.query(`UPDATE procedures SET deleted_at=NOW() WHERE id=ANY($1)`, [createdProcIds]);
    await db.query(`UPDATE consultations SET deleted_at=NOW() WHERE id=$1`, [consultationId]);
    await db.query(`UPDATE pets          SET deleted_at=NOW() WHERE id=$1`, [petId]);
    await db.query(`UPDATE owners        SET deleted_at=NOW() WHERE id=$1`, [ownerId]);
    await db.query(`DELETE FROM veterinarians WHERE id=$1`, [veterinarianId]);
    await db.query(`DELETE FROM users WHERE id=ANY($1)`, [[adminUser.id, vetUser.id, assistUser.id]]);
    await db.end();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // 1. Procedures CRUD
  // ---------------------------------------------------------------------------

  describe('Procedures', () => {
    it('VET_DOCTOR creates a procedure on open consultation', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/procedures')
        .set('Authorization', `Bearer ${vetToken}`)
        .send({
          consultationId,
          veterinarianId,
          performedAt:  new Date().toISOString(),
          name:         'X-Ray thorax',
          quantity:     '1',
          unitPrice:    '80.00',
          isBillable:   true,
        })
        .expect(201);

      expect(res.body.consultationId).toBe(consultationId);
      expect(res.body.totalPrice).toBe('80.00');
      createdProcIds.push(res.body.id as string);
    });

    it('ASSISTANT can also create a procedure', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/procedures')
        .set('Authorization', `Bearer ${assistToken}`)
        .send({
          consultationId,
          veterinarianId,
          performedAt: new Date().toISOString(),
          name:        'Blood draw',
          unitPrice:   '15.00',
        })
        .expect(201);
      createdProcIds.push(res.body.id as string);
    });

    it('GET /procedures?consultationId returns both procedures', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/procedures?consultationId=${consultationId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const ids = (res.body.data as { id: string }[]).map((p) => p.id);
      expect(createdProcIds.every((id) => ids.includes(id))).toBe(true);
    });

    it('PATCH updates a procedure', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/procedures/${createdProcIds[0]}`)
        .set('Authorization', `Bearer ${vetToken}`)
        .send({ name: 'X-Ray thorax + abdomen', unitPrice: '100.00' })
        .expect(200);

      expect(res.body.name).toBe('X-Ray thorax + abdomen');
      expect(res.body.totalPrice).toBe('100.00');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Treatment lines CRUD + dispense
  // ---------------------------------------------------------------------------

  describe('Treatment lines', () => {
    let lineId: string;

    it('VET_DOCTOR creates a treatment line', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/treatment-lines')
        .set('Authorization', `Bearer ${vetToken}`)
        .send({
          consultationId,
          prescribedBy:      veterinarianId,
          productName:       'Amoxicillin 500mg',
          dose:              '10mg/kg',
          frequency:         'twice daily',
          route:             'oral',
          durationDays:      7,
          quantityDispensed: '14',
          quantityUnit:      'tablet',
          lotNumber:         'LOT-2026-001',
          expiryDate:        '2027-12-31',
          unitPrice:         '2.50',
          isBillable:        true,
        })
        .expect(201);

      expect(res.body.isDispensed).toBe(false);
      expect(res.body.lotNumber).toBe('LOT-2026-001');
      lineId = res.body.id as string;
      createdLineIds.push(lineId);
    });

    it('GET /treatment-lines?consultationId returns the line', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/treatment-lines?consultationId=${consultationId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const ids = (res.body.data as { id: string }[]).map((l) => l.id);
      expect(ids).toContain(lineId);
    });

    it('GET ?isDispensed=false returns undispensed lines', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/treatment-lines?consultationId=${consultationId}&isDispensed=false`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(
        (res.body.data as { id: string; isDispensed: boolean }[])
          .every((l) => l.isDispensed === false),
      ).toBe(true);
    });

    it('POST /dispense marks line as dispensed', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/treatment-lines/${lineId}/dispense`)
        .set('Authorization', `Bearer ${assistToken}`)
        .expect(200);

      expect(res.body.isDispensed).toBe(true);
      expect(res.body.administeredAt).not.toBeNull();
    });

    it('PATCH blocked after dispense', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/treatment-lines/${lineId}`)
        .set('Authorization', `Bearer ${vetToken}`)
        .send({ dose: '20mg/kg' })
        .expect(400);
    });

    it('DELETE blocked after dispense', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/treatment-lines/${lineId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Locking after consultation is completed
  // ---------------------------------------------------------------------------

  describe('Lock after consultation complete', () => {
    it('completes the consultation', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/consultations/${consultationId}/complete`)
        .set('Authorization', `Bearer ${vetToken}`)
        .expect(200);

      expect(res.body.status).toBe('completed');
      expect(res.body.signedBy).toBe(veterinarianId);
    });

    it('cannot add a new procedure after completion', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/procedures')
        .set('Authorization', `Bearer ${vetToken}`)
        .send({
          consultationId,
          veterinarianId,
          performedAt: new Date().toISOString(),
          name:        'Post-complete attempt',
          unitPrice:   '10.00',
        })
        .expect(400);
    });

    it('cannot add a treatment line after completion', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/treatment-lines')
        .set('Authorization', `Bearer ${vetToken}`)
        .send({
          consultationId,
          prescribedBy: veterinarianId,
          productName:  'Post-complete drug',
          dose:         '5mg/kg',
        })
        .expect(400);
    });

    it('cannot delete a procedure on a completed consultation', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/procedures/${createdProcIds[0]}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Billing readiness check (pre-invoice assertions)
  // ---------------------------------------------------------------------------

  describe('Billing readiness', () => {
    it('all billable procedures have a totalPrice > 0', async () => {
      const rows = await db.query<{ total_price: string; is_billable: boolean }>(
        `SELECT total_price, is_billable FROM procedures
         WHERE consultation_id = $1 AND deleted_at IS NULL AND is_billable = true`,
        [consultationId],
      );
      expect(rows.length).toBeGreaterThan(0);
      rows.forEach((r) => expect(parseFloat(r.total_price)).toBeGreaterThan(0));
    });

    it('consultation is signed (signedBy not null) — prerequisite for invoicing', async () => {
      const [row] = await db.query<{ signed_by: string | null }>(
        `SELECT signed_by FROM consultations WHERE id = $1`, [consultationId],
      );
      expect(row.signed_by).toBe(veterinarianId);
    });

    it('dispensed treatment lines have lot_number for traceability', async () => {
      const rows = await db.query<{ lot_number: string | null; is_dispensed: boolean }>(
        `SELECT lot_number, is_dispensed FROM treatment_lines
         WHERE consultation_id = $1 AND deleted_at IS NULL AND is_dispensed = true`,
        [consultationId],
      );
      rows.forEach((r) => expect(r.lot_number).not.toBeNull());
    });
  });
});
