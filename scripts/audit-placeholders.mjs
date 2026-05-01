import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scanExt = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.css', '.prisma']);
const ignoreDirs = new Set(['node_modules', '.next', '.git']);
const MAX_LINE_LENGTH = 5000;

const checks = [
  {
    key: 'demo_seed',
    title: 'Demo/seed data in runtime code',
    pattern: /\b(DEMO_|demoPeople|ensureDemoUsers|isDemo|is_demo|seed-story)/i,
    severity: 'high',
  },
  {
    key: 'runtime_unavailable',
    title: 'User-facing unavailable/fallback text',
    pattern: /пока (не )?(доступ|нельзя|нет|ничего|пусто)|недоступ|в разработке|скоро|заглуш/i,
    severity: 'medium',
  },
  {
    key: 'native_alert',
    title: 'Native browser alerts',
    pattern: /\bwindow\.alert\(|\balert\(/,
    severity: 'medium',
  },
  {
    key: 'local_uploads',
    title: 'Local public uploads / non-production file storage',
    pattern: /public\/uploads|\/uploads\/|ROOT_UPLOADS_DIR|basePath:\s*['"]\/uploads/i,
    severity: 'high',
  },
  {
    key: 'process_memory_realtime',
    title: 'Process-memory realtime state',
    pattern: /globalThis\.__friendscape(Chat)?Realtime|global\.__friendscape(Chat)?Realtime/i,
    severity: 'high',
  },
  {
    key: 'temporary_notes',
    title: 'TODO/FIXME/HACK markers',
    pattern: /TODO|FIXME|HACK/i,
    severity: 'low',
  },
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoreDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (scanExt.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

const result = {
  generated_at: new Date().toISOString(),
  root: path.basename(root),
  checks: {},
};

for (const check of checks) result.checks[check.key] = { ...check, count: 0, hits: [] };

for (const file of walk(root)) {
  const rel = path.relative(root, file).replaceAll(path.sep, '/');
  if (rel === 'scripts/audit-placeholders.mjs') continue;

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.length > MAX_LINE_LENGTH ? rawLine.slice(0, MAX_LINE_LENGTH) : rawLine;
    for (const check of checks) {
      if (!check.pattern.test(line)) continue;
      const bucket = result.checks[check.key];
      bucket.count += 1;
      if (bucket.hits.length < 40) {
        bucket.hits.push({ file: rel, line: index + 1, text: line.trim().slice(0, 220) });
      }
    }
  });
}

const outDir = path.join(root, 'docs');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'placeholder-audit.json'), JSON.stringify(result, null, 2));

const md = [];
md.push('# Placeholder audit');
md.push('');
md.push(`Generated: ${result.generated_at}`);
md.push('');
md.push('| Area | Severity | Hits |');
md.push('|---|---:|---:|');
for (const check of checks) {
  const item = result.checks[check.key];
  md.push(`| ${item.title} | ${item.severity} | ${item.count} |`);
}
md.push('');
md.push('## Top findings');
for (const check of checks) {
  const item = result.checks[check.key];
  md.push('');
  md.push(`### ${item.title}`);
  md.push('');
  if (!item.hits.length) {
    md.push('No hits.');
    continue;
  }
  for (const hit of item.hits.slice(0, 12)) {
    md.push(`- \`${hit.file}:${hit.line}\` — ${hit.text.replaceAll('|', '\\|')}`);
  }
}
md.push('');
md.push('## Rule');
md.push('Every hit must be either removed, replaced with real production behavior, or explicitly documented as an intentional empty/loading/error state.');
md.push('');
fs.writeFileSync(path.join(outDir, 'placeholder-audit.md'), md.join('\n'));

console.log('Placeholder audit written to docs/placeholder-audit.md and docs/placeholder-audit.json');
for (const check of checks) {
  const item = result.checks[check.key];
  console.log(`${check.key}: ${item.count}`);
}
