import { spawnSync } from 'node:child_process';

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';
const npxCmd = isWindows ? 'npx.cmd' : 'npx';

function run(label, cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false, env: process.env });
  if (result.status !== 0) {
    console.error(`\n[prepare-prod] ${label} failed.`);
    process.exit(result.status || 1);
  }
}

run('env check', npmCmd, ['run', 'check:env']);
run('prisma generate', npxCmd, ['prisma', 'generate']);
console.log('[prepare-prod] Environment and Prisma client are ready. Run npm run deploy:migrate before starting a production release.');
