import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function runStep(label, commandText) {
  const result = spawnSync(
    isWindows ? (process.env.ComSpec || "cmd.exe") : "sh",
    isWindows ? ["/d", "/s", "/c", commandText] : ["-lc", commandText],
    {
      stdio: "inherit",
      cwd: projectRoot,
      env: process.env,
      shell: false,
    }
  );

  if (result.error) {
    console.error("");
    console.error(`[dev bootstrap] ${label} failed to start.`);
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error("");
    console.error(`[dev bootstrap] ${label} failed.`);
    process.exit(result.status || 1);
  }
}

console.log("[dev bootstrap] syncing Prisma client and database...");
runStep("prisma generate", "prisma generate");
runStep("prisma db push", "prisma db push");
console.log("[dev bootstrap] Prisma is ready. Starting Next dev server...");

const nextProcess = spawn(
  isWindows ? (process.env.ComSpec || "cmd.exe") : "sh",
  isWindows ? ["/d", "/s", "/c", "next dev"] : ["-lc", "next dev"],
  {
    stdio: "inherit",
    cwd: projectRoot,
    env: process.env,
    shell: false,
  }
);

nextProcess.on("error", (error) => {
  console.error("");
  console.error("[dev bootstrap] next dev failed to start.");
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
