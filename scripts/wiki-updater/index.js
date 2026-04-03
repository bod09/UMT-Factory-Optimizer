#!/usr/bin/env node
// UMT Wiki-to-JSON Updater
// Fetches machine data from umt.miraheze.org wiki,
// safely merges with existing machines.json (preserving custom fields),
// and outputs a diff report.
//
// Usage:
//   node scripts/wiki-updater/index.js           # Update machines.json
//   node scripts/wiki-updater/index.js --dry-run  # Preview changes only

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchAllMachines } from './fetch.js';
import { mergeWikiData } from './merge.js';
import { generateDiffReport } from './diff.js';
import { detectEvents } from './events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MACHINES_PATH = resolve(__dirname, '../../data/machines.json');
const DIFF_PATH = resolve(__dirname, '../../wiki-update-report.md');

const dryRun = process.argv.includes('--dry-run');

async function main() {
  console.log('=== UMT Wiki Updater ===\n');

  // Step 1: Load existing machines.json
  console.log('Loading existing machines.json...');
  const existing = JSON.parse(readFileSync(MACHINES_PATH, 'utf-8'));
  const existingMachines = existing.machines;
  const existingCount = Object.keys(existingMachines).length;
  console.log(`  ${existingCount} machines in current file\n`);

  // Step 2: Detect events from Game Updates page
  console.log('Checking for active events...');
  const { events, activeEvent } = await detectEvents();
  if (events.length > 0) {
    console.log(`  Found ${events.length} event(s):`);
    for (const e of events) {
      console.log(`    - ${e.name}: ${e.startDate} to ${e.endDate} ${e.active ? '(ACTIVE!)' : '(ended)'}`);
      if (e.machines?.length) console.log(`      Machines: ${e.machines.join(', ')}`);
    }
  }
  if (activeEvent) {
    console.log(`\n  >>> ACTIVE EVENT: ${activeEvent.name} <<<\n`);
  } else {
    console.log('  No active events\n');
  }

  // Step 3: Fetch machine data from wiki
  const wikiMachines = await fetchAllMachines();
  console.log(`\nFetched ${wikiMachines.length} machines from wiki\n`);

  // Mark event machines as active if their event is currently running
  if (activeEvent) {
    for (const m of wikiMachines) {
      if (m.event && activeEvent.machines?.some(em =>
        em.toLowerCase().includes(m.name.toLowerCase()) ||
        m.name.toLowerCase().includes(em.toLowerCase())
      )) {
        m._removed = false; // Override: event is active!
      }
    }
  }

  // Step 4: Safe merge
  console.log('Merging...');
  const { machines: merged, changes } = mergeWikiData(existingMachines, wikiMachines);

  // Step 5: Generate report
  const report = generateDiffReport(changes, events);
  console.log('\n' + report);

  const totalChanges = changes.added.length + changes.updated.length;

  if (totalChanges === 0) {
    console.log('\nNo changes needed.');
    // Write empty report for GitHub Action to detect
    writeFileSync(DIFF_PATH, report);
    process.exit(0);
  }

  // Step 6: Write updated file
  if (dryRun) {
    console.log('\n[DRY RUN] Would update machines.json with:');
    console.log(`  ${changes.added.length} new machines`);
    console.log(`  ${changes.updated.length} updated machines`);
    console.log(`  ${changes.costChanges.length} cost changes`);
  } else {
    existing.machines = merged;
    writeFileSync(MACHINES_PATH, JSON.stringify(existing, null, 2) + '\n');
    console.log(`\nUpdated machines.json (${Object.keys(merged).length} machines)`);
  }

  // Write diff report for PR body
  writeFileSync(DIFF_PATH, report);
  console.log(`Diff report written to ${DIFF_PATH}`);

  // Exit with code 1 if changes found (for GitHub Action to detect)
  process.exit(totalChanges > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(2);
});
