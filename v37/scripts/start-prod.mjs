import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const npxCmd = isWindows ? 'npx.cmd' : 'npx';
const port = process.env.PORT || '3000';
const host = process.env.HOST || '0.0.0.0';

const child = spawn(npxCmd, ['next', 'start', '-p', port, '-H', host], {
  stdio: 'inherit',
  shell: false,
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
