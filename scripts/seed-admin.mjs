#!/usr/bin/env node
/**
 * seed-admin.mjs
 *
 * Creates initial admin user + demo staff accounts.
 * Idempotent — skips users that already exist (matched by email).
 *
 * Usage:
 *   node scripts/seed-admin.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import pg from 'pg';
import bcrypt from 'bcrypt';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Load .env ────────────────────────────────────────────────────────────────
function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

loadDotEnv(join(ROOT, 'apps', 'api', '.env'));
loadDotEnv(join(ROOT, '.env'));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set');
  process.exit(1);
}

// ── Users to seed ────────────────────────────────────────────────────────────
const USERS = [
  {
    email:      'admin@nordskar.ro',
    password:   'Admin1234!',
    role:       'admin',
    first_name: 'Admin',
    last_name:  'Nordskar',
    phone:      '+40700000001',
  },
  {
    email:      'receptionist@nordskar.ro',
    password:   'Recept1234!',
    role:       'receptionist',
    first_name: 'Ana',
    last_name:  'Ionescu',
    phone:      '+40700000002',
  },
  {
    email:      'vet@nordskar.ro',
    password:   'Vet1234!',
    role:       'vet_doctor',
    first_name: 'Dr. Mihai',
    last_name:  'Popescu',
    phone:      '+40700000003',
  },
];

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  console.log('\n=== seed-admin ===\n');

  for (const u of USERS) {
    const { rows } = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [u.email]
    );

    if (rows.length > 0) {
      console.log(`  – ${u.email} (already exists — skip)`);
      continue;
    }

    const passwordHash = await bcrypt.hash(u.password, 10);

    await client.query(
      `INSERT INTO users (email, password_hash, role, first_name, last_name, phone, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [u.email, passwordHash, u.role, u.first_name, u.last_name, u.phone]
    );

    console.log(`  ✓ Created ${u.role}: ${u.email} / ${u.password}`);
  }

  await client.end();
  console.log('\n=== Seed complete ===\n');
}

main().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
