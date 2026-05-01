import { spawnSync } from 'node:child_process';

if (process.env.NODE_ENV !== 'production') {
  console.error('[migrate-prod] Refusing to run without NODE_ENV=production.');
  process.exit(1);
}

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';
const npxCmd = isWindows ? 'npx.cmd' : 'npx';

function run(label, cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false, env: process.env });
  if (result.status !== 0) {
    console.error(`\n[migrate-prod] ${label} failed.`);
    process.exit(result.status || 1);
  }
}

run('env check', npmCmd, ['run', 'check:env']);
run('prisma migrate deploy', npxCmd, ['prisma', 'migrate', 'deploy']);
console.log('[migrate-prod] Database migrations are deployed.');
