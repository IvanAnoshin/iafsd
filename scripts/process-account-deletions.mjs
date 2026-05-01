#!/usr/bin/env node
import { processDueAccountDeletions } from '../lib/account-data.js';

function hasFlag(name) {
  return process.argv.includes(name);
}

function readNumberFlag(name, fallback) {
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  if (!match) return fallback;
  const value = Number(match.slice(prefix.length));
  return Number.isFinite(value) ? value : fallback;
}

const dryRun = !hasFlag('--delete');
const limit = readNumberFlag('--limit', 20);

const result = await processDueAccountDeletions({ limit, dryRun });
console.log(JSON.stringify({
  checked_at: new Date().toISOString(),
  ...result,
}, null, 2));
