import { spawnSync } from 'node:child_process';

if (process.env.NODE_ENV === 'production') {
  console.error('[prisma-push-dev] prisma db push is blocked in production. Use npm run deploy:migrate.');
  process.exit(1);
}

const isWindows = process.platform === 'win32';
const npxCmd = isWindows ? 'npx.cmd' : 'npx';
const result = spawnSync(npxCmd, ['prisma', 'db', 'push'], { stdio: 'inherit', shell: false, env: process.env });
process.exit(result.status || 0);
