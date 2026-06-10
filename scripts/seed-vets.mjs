#!/usr/bin/env node
/**
 * seed-vets.mjs — Seed veterinarians linked to vet_doctor users.
 * Idempotent: skips if user already has a veterinarian record.
 *
 * Usage:  node scripts/seed-vets.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function loadDotEnv(p) {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}

loadDotEnv(join(ROOT, 'apps', 'api', '.env'));
loadDotEnv(join(ROOT, '.env'));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }

const VETS = [
  {
    email:       'vet@nordskar.ro',
    firstName:   'Alexandru',
    lastName:    'Ionescu',
    license:     'CMVRO-2024-001',
    isSurgeon:   true,
    color:       '#3b82f6',
    specs:       ['Medicină internă', 'Chirurgie generală'],
  },
  {
    email:       'receptionist@nordskar.ro',
    firstName:   'Diana',
    lastName:    'Popescu',
    license:     'CMVRO-2024-002',
    isSurgeon:   false,
    color:       '#10b981',
    specs:       ['Dermatologie', 'Nutriție'],
  },
];

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('\n=== seed-vets ===\n');

  for (const v of VETS) {
    // Find user by email
    const { rows: users } = await client.query(
      'SELECT id FROM users WHERE email = $1', [v.email]
    );
    if (users.length === 0) {
      console.log(`  ! User ${v.email} not found — skipping`);
      continue;
    }
    const userId = users[0].id;

    // Check if vet record exists
    const { rows: existing } = await client.query(
      'SELECT id FROM veterinarians WHERE user_id = $1', [userId]
    );
    if (existing.length > 0) {
      console.log(`  – Vet for ${v.email} already exists (${existing[0].id})`);
      continue;
    }

    const { rows: ins } = await client.query(
      `INSERT INTO veterinarians
         (user_id, first_name, last_name, license_number, is_surgeon, is_available, color_in_calendar, specializations)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7)
       RETURNING id`,
      [userId, v.firstName, v.lastName, v.license, v.isSurgeon, v.color, v.specs]
    );
    console.log(`  ✓ Vet created: ${v.firstName} ${v.lastName} (${ins[0].id})`);
  }

  await client.end();
  console.log('\n=== Seed vets complete ===\n');
}

main().catch(e => { console.error(e.message); process.exit(1); });
