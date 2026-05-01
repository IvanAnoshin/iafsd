import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

if (process.env.NODE_ENV !== 'production') {
  console.error('[start-prod] Refusing to start without NODE_ENV=production.');
  process.exit(1);
}

const isWindows = process.platform === 'win32';
const npxCmd = isWindows ? 'npx.cmd' : 'npx';
const port = process.env.PORT || '3000';
const host = process.env.HOST || process.env.HOSTNAME || '0.0.0.0';
const standaloneServer = path.join(process.cwd(), '.next', 'standalone', 'server.js');
const useStandalone = process.env.NEXT_STANDALONE_START !== 'false' && existsSync(standaloneServer);

const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: port,
  HOSTNAME: host,
};

const child = useStandalone
  ? spawn(process.execPath, [standaloneServer], { stdio: 'inherit', shell: false, env })
  : spawn(npxCmd, ['next', 'start', '-p', port, '-H', host], { stdio: 'inherit', shell: false, env });

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
