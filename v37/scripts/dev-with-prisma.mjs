import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const binDir = path.join(projectRoot, "node_modules", ".bin");
const prismaCmd = path.join(binDir, isWindows ? "prisma.cmd" : "prisma");
const nextCmd = path.join(binDir, isWindows ? "next.cmd" : "next");

function runStep(label, command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    cwd: projectRoot,
    env: process.env,
  });

  if (result.error) {
    console.error(`
[dev bootstrap] ${label} failed to start.`);
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`
[dev bootstrap] ${label} failed.`);
    process.exit(result.status || 1);
  }
}

console.log("[dev bootstrap] syncing Prisma client and database...");
runStep("prisma generate", prismaCmd, ["generate"]);
runStep("prisma db push", prismaCmd, ["db", "push"]);
console.log("[dev bootstrap] Prisma is ready. Starting Next dev server...");

const nextProcess = spawn(nextCmd, ["dev"], {
  stdio: "inherit",
  shell: false,
  cwd: projectRoot,
  env: process.env,
});

nextProcess.on("error", (error) => {
  console.error("
[dev bootstrap] next dev failed to start.");
  console.error(error.message);
  process.exit(1);
});

nextProcess.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
