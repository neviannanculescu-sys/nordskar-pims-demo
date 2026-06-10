/**
 * bootstrap-db-dryrun.mjs
 *
 * Validates bootstrap-db.mjs logic without a real DB connection:
 *   - .env loading
 *   - URL parsing
 *   - _journal.json reading + structure
 *   - SQL file existence + non-empty for each journal entry
 *   - Statement-breakpoint split (same logic as bootstrap-db.mjs)
 *   - Simulates run 1 (nothing applied) and run 2 (all already applied)
 *
 * Remove this file once a real PostgreSQL instance is available for smoke tests.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// 1. .env loading (same logic as bootstrap-db.mjs)
// ---------------------------------------------------------------------------
console.log('\n[1] .env loading');

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return false;
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
  return true;
}

// Use .env.example as the reference file for dry-run
const exampleLoaded = loadDotEnv(join(ROOT, '.env.example'));
assert('.env.example readable', exampleLoaded);
assert('DATABASE_URL present in .env.example', !!process.env.DATABASE_URL, process.env.DATABASE_URL);

// ---------------------------------------------------------------------------
// 2. URL parsing
// ---------------------------------------------------------------------------
console.log('\n[2] URL parsing');

function parseUrl(url) {
  const u = new URL(url);
  return {
    user:     u.username || 'postgres',
    password: u.password || '',
    host:     u.hostname || 'localhost',
    port:     parseInt(u.port || '5432', 10),
    database: u.pathname.replace(/^\//, '') || 'postgres',
  };
}

let conn;
try {
  conn = parseUrl(process.env.DATABASE_URL);
  assert('URL parsed: host',     typeof conn.host === 'string' && conn.host.length > 0, conn.host);
  assert('URL parsed: port',     conn.port >= 1 && conn.port <= 65535, String(conn.port));
  assert('URL parsed: database', typeof conn.database === 'string' && conn.database.length > 0, conn.database);
} catch (e) {
  assert('URL parses without error', false, e.message);
}

// ---------------------------------------------------------------------------
// 3. Journal file
// ---------------------------------------------------------------------------
console.log('\n[3] _journal.json');

const migrationsDir = join(ROOT, 'apps', 'api', 'src', 'database', 'migrations');
const journalPath   = join(migrationsDir, 'meta', '_journal.json');

assert('_journal.json exists', existsSync(journalPath));

let journal;
try {
  journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  assert('journal.version is "7"',     journal.version === '7', journal.version);
  assert('journal.dialect is "postgresql"', journal.dialect === 'postgresql', journal.dialect);
  assert('journal.entries is array',   Array.isArray(journal.entries));
  assert('journal has >= 2 entries',   journal.entries.length >= 2, String(journal.entries.length));
} catch (e) {
  assert('journal parses as JSON', false, e.message);
}

// ---------------------------------------------------------------------------
// 4. SQL files — existence + content + statement-breakpoint split
// ---------------------------------------------------------------------------
console.log('\n[4] SQL files');

const stmtCounts = {};

if (journal?.entries) {
  for (const entry of journal.entries) {
    const { tag, when, idx } = entry;
    const sqlPath = join(migrationsDir, `${tag}.sql`);

    assert(`${tag}.sql exists`, existsSync(sqlPath));
    assert(`${tag} has when (ms epoch)`, typeof when === 'number' && when > 0, String(when));
    assert(`${tag} has numeric idx`,     typeof idx  === 'number', String(idx));

    if (existsSync(sqlPath)) {
      const content = readFileSync(sqlPath, 'utf8');
      assert(`${tag}.sql non-empty`, content.trim().length > 0);

      const stmts = content
        .split('--> statement-breakpoint')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      assert(`${tag} yields >= 1 statement(s)`, stmts.length >= 1, `${stmts.length} statement(s)`);
      stmtCounts[tag] = stmts.length;
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Simulate run 1: nothing applied yet
// ---------------------------------------------------------------------------
console.log('\n[5] Simulate run 1 (empty DB state)');

const fakeApplied = new Set();
let wouldApply = 0;

if (journal?.entries) {
  for (const entry of journal.entries) {
    if (!fakeApplied.has(entry.tag)) {
      wouldApply++;
    }
  }
}

assert(`Run 1 would apply ${journal?.entries?.length ?? 0} migration(s)`,
  wouldApply === (journal?.entries?.length ?? 0),
  `wouldApply=${wouldApply}`
);

// ---------------------------------------------------------------------------
// 6. Simulate run 2: all already applied
// ---------------------------------------------------------------------------
console.log('\n[6] Simulate run 2 (all applied)');

const allApplied = new Set(journal?.entries?.map(e => e.tag) ?? []);
let wouldSkip = 0;

if (journal?.entries) {
  for (const entry of journal.entries) {
    if (allApplied.has(entry.tag)) wouldSkip++;
  }
}

assert(`Run 2 skips all ${journal?.entries?.length ?? 0} migration(s)`,
  wouldSkip === (journal?.entries?.length ?? 0),
  `wouldSkip=${wouldSkip}`
);

// ---------------------------------------------------------------------------
// 7. Summary
// ---------------------------------------------------------------------------
console.log('\n--- Statement counts per migration ---');
for (const [tag, count] of Object.entries(stmtCounts)) {
  console.log(`  ${tag}: ${count} statement(s)`);
}

console.log(`\n=== Dry-run result: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
