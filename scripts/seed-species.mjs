#!/usr/bin/env node
/**
 * seed-species.mjs — Seed species + breeds in DB.
 * Idempotent: skips existing rows (matched by name_ro).
 *
 * Usage:  node scripts/seed-species.mjs
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

const SPECIES = [
  { nameRo: 'Câine',    nameEn: 'Dog' },
  { nameRo: 'Pisică',   nameEn: 'Cat' },
  { nameRo: 'Iepure',   nameEn: 'Rabbit' },
  { nameRo: 'Hamster',  nameEn: 'Hamster' },
  { nameRo: 'Papagal',  nameEn: 'Parrot' },
  { nameRo: 'Reptilă',  nameEn: 'Reptile' },
  { nameRo: 'Pești',    nameEn: 'Fish' },
  { nameRo: 'Cobai',    nameEn: 'Guinea Pig' },
];

// Breed data: { species: nameRo, breeds: [name,...] }
const BREEDS = [
  { species: 'Câine', breeds: [
    'Labrador Retriever', 'Golden Retriever', 'Ciobanesc German',
    'Bichon Frisé', 'Poodle', 'Chihuahua', 'Husky Siberian',
    'Rottweiler', 'Bulldog Francez', 'Mops (Pug)',
    'Dachshund', 'Beagle', 'Border Collie', 'Ciobănesc Mioritic',
  ]},
  { species: 'Pisică', breeds: [
    'Persană', 'Maine Coon', 'Siameză', 'British Shorthair',
    'Ragdoll', 'Bengal', 'Scottish Fold', 'Europeană Comună',
  ]},
  { species: 'Iepure', breeds: [
    'Iepure Olandez', 'Iepure Lop', 'Iepure Angora', 'Iepure Rexat',
  ]},
];

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('\n=== seed-species ===\n');

  const speciesIds = {};

  for (const s of SPECIES) {
    const { rows } = await client.query(
      'SELECT id FROM species WHERE name_ro = $1', [s.nameRo]
    );
    if (rows.length > 0) {
      speciesIds[s.nameRo] = rows[0].id;
      console.log(`  – ${s.nameRo} (already exists)`);
      continue;
    }
    const { rows: ins } = await client.query(
      'INSERT INTO species (name_ro, name_en, is_active) VALUES ($1,$2,true) RETURNING id',
      [s.nameRo, s.nameEn]
    );
    speciesIds[s.nameRo] = ins[0].id;
    console.log(`  ✓ Species: ${s.nameRo}`);
  }

  console.log('\n--- breeds ---\n');

  for (const group of BREEDS) {
    const sId = speciesIds[group.species];
    if (!sId) { console.log(`  ! Species ${group.species} not found, skip breeds`); continue; }

    for (const breedName of group.breeds) {
      const { rows } = await client.query(
        'SELECT id FROM breeds WHERE name = $1 AND species_id = $2',
        [breedName, sId]
      );
      if (rows.length > 0) { console.log(`  – ${group.species}/${breedName} (exists)`); continue; }

      await client.query(
        'INSERT INTO breeds (name, species_id, is_active) VALUES ($1,$2,true)',
        [breedName, sId]
      );
      console.log(`  ✓ Breed: ${group.species} / ${breedName}`);
    }
  }

  await client.end();
  console.log('\n=== Seed species complete ===\n');
}

main().catch(e => { console.error(e.message); process.exit(1); });
