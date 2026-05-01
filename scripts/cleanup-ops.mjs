import { spawn } from 'node:child_process';

const shouldDelete = process.argv.includes('--delete');
const scanObjects = process.argv.includes('--objects') || process.argv.includes('--object');

function run(label, command, args) {
  return new Promise((resolve) => {
    console.log(`\n[cleanup-ops] ${label}`);
    const child = spawn(command, args, { stdio: 'inherit', env: process.env });
    child.on('error', (error) => resolve({ label, ok: false, error: error.message }));
    child.on('close', (code) => resolve({ label, ok: code === 0, code }));
  });
}

const deleteFlag = shouldDelete ? ['--delete'] : [];
const objectFlag = scanObjects ? ['--object'] : [];
const tasks = [
  ['expired-data', 'node', ['scripts/cleanup-expired-data.mjs', ...deleteFlag]],
  ['rate-limits', 'node', ['scripts/cleanup-rate-limits.mjs', ...deleteFlag]],
  ['media', 'node', ['scripts/cleanup-media.mjs', ...deleteFlag, ...objectFlag]],
];

const results = [];
for (const [label, command, args] of tasks) {
  results.push(await run(label, command, args));
}

const failed = results.filter((item) => !item.ok);
console.log(`\n[cleanup-ops] summary`);
console.log(JSON.stringify({ mode: shouldDelete ? 'delete' : 'dry-run', object_storage_scan: scanObjects, results }, null, 2));
if (failed.length) process.exitCode = 1;
