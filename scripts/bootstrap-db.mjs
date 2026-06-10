#!/usr/bin/env node
/**
 * bootstrap-db.mjs
 *
 * Idempotent database bootstrap for vet-hospital-system.
 * Safe to run multiple times — skips already-applied migrations.
 *
 * Usage:
 *   node scripts/bootstrap-db.mjs
 *   # or with explicit url:
 *   DATABASE_URL=postgresql://... node scripts/bootstrap-db.mjs
 *
 * Reads DATABASE_URL from environment or .env.local (auto-loaded below).
 *
 * What it does:
 *   1. Creates the target database if it does not exist.
 *   2. Creates `drizzle` schema + `__drizzle_migrations` tracking table
 *      using the exact structure drizzle-orm expects (v0.36+).
 *   3. Applies each migration from meta/_journal.json in order,
 *      skipping any that are already recorded in __drizzle_migrations.
 *   4. Records each applied migration with tag + when timestamp,
 *      so future calls to drizzle-orm migrate() do not re-apply them.
 */

import { readFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// 1. Load environment
// ---------------------------------------------------------------------------

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

// Try .env.local first, then .env
loadDotEnv(join(ROOT, '.env.local'));
loadDotEnv(join(ROOT, '.env'));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set.');
  console.error('  Copy .env.example → .env.local and fill in the value.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Parse connection URL
// ---------------------------------------------------------------------------

function parseUrl(url) {
  // postgresql://user:pass@host:port/dbname[?params]
  const u = new URL(url);
  return {
    user:     u.username || 'postgres',
    password: u.password || '',
    host:     u.hostname || 'localhost',
    port:     parseInt(u.port || '5432', 10),
    database: u.pathname.replace(/^\//, '') || 'postgres',
  };
}

const conn = parseUrl(DATABASE_URL);

// ---------------------------------------------------------------------------
// 3. Helpers
// ---------------------------------------------------------------------------

function log(msg)  { console.log(`  ${msg}`); }
function ok(msg)   { console.log(`  ✓ ${msg}`); }
function skip(msg) { console.log(`  – ${msg} (already done)`); }
function fail(msg) { console.error(`  ✗ ${msg}`); }

async function query(client, sql, params = []) {
  return client.query(sql, params);
}

// ---------------------------------------------------------------------------
// 4. Ensure database exists
// ---------------------------------------------------------------------------

async function ensureDatabase() {
  // Connect to the default `postgres` maintenance database
  const adminClient = new Client({ ...conn, database: 'postgres' });
  await adminClient.connect();

  const { rows } = await adminClient.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [conn.database]
  );

  if (rows.length === 0) {
    // Identifier cannot be parameterized in CREATE DATABASE
    await adminClient.query(`CREATE DATABASE "${conn.database}"`);
    ok(`Database "${conn.database}" created`);
  } else {
    skip(`Database "${conn.database}" exists`);
  }

  await adminClient.end();
}

// ---------------------------------------------------------------------------
// 5. Ensure drizzle tracking schema + table
// ---------------------------------------------------------------------------

async function ensureTrackingTable(client) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id         SERIAL PRIMARY KEY,
      hash       TEXT    NOT NULL,
      created_at BIGINT
    )
  `);

  ok('drizzle.__drizzle_migrations ready');
}

// ---------------------------------------------------------------------------
// 6. Apply migrations
// ---------------------------------------------------------------------------

async function applyMigrations(client) {
  const migrationsDir = join(ROOT, 'apps', 'api', 'src', 'database', 'migrations');
  const journalPath   = join(migrationsDir, 'meta', '_journal.json');

  if (!existsSync(journalPath)) {
    fail(`Journal not found: ${journalPath}`);
    process.exit(1);
  }

  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));

  // Fetch already-applied tags from DB
  const { rows: applied } = await client.query(
    `SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at`
  );
  const appliedTags = new Set(applied.map(r => r.hash));

  let newCount = 0;

  for (const entry of journal.entries) {
    const { tag, when } = entry;

    if (appliedTags.has(tag)) {
      skip(`Migration ${tag}`);
      continue;
    }

    const sqlPath = join(migrationsDir, `${tag}.sql`);
    if (!existsSync(sqlPath)) {
      fail(`SQL file missing for journal entry "${tag}": ${sqlPath}`);
      process.exit(1);
    }

    const sql = readFileSync(sqlPath, 'utf8');

    log(`Applying ${tag} …`);

    // Run inside a transaction so a partial failure leaves no half-applied state
    await client.query('BEGIN');
    try {
      // drizzle-kit uses '--> statement-breakpoint' as separator
      const statements = sql
        .split('--> statement-breakpoint')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      for (const stmt of statements) {
        await client.query(stmt);
      }

      await client.query(
        `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
        [tag, when]
      );

      await client.query('COMMIT');
      ok(`Applied ${tag}`);
      newCount++;
    } catch (err) {
      await client.query('ROLLBACK');
      fail(`Failed applying ${tag}: ${err.message}`);
      throw err;
    }
  }

  if (newCount === 0) {
    log('All migrations already applied — nothing to do.');
  } else {
    ok(`${newCount} migration(s) applied.`);
  }
}

// ---------------------------------------------------------------------------
// 7. Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n=== vet-hospital bootstrap-db ===\n');

  console.log('Step 1: Ensure database exists');
  await ensureDatabase();

  const client = new Client(conn);
  await client.connect();

  try {
    console.log('\nStep 2: Ensure migration tracking table');
    await ensureTrackingTable(client);

    console.log('\nStep 3: Apply migrations');
    await applyMigrations(client);
  } finally {
    await client.end();
  }

  console.log('\n=== Bootstrap complete ===\n');
}

main().catch(err => {
  console.error('\nBootstrap failed:', err.message);
  process.exit(1);
});
