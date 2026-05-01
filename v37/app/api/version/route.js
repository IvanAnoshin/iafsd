import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMMIT_SHA_ENV_KEYS = [
  'APP_GIT_SHA',
  'GIT_COMMIT_SHA',
  'COMMIT_SHA',
  'VERCEL_GIT_COMMIT_SHA',
  'RAILWAY_GIT_COMMIT_SHA',
  'RENDER_GIT_COMMIT',
];

const BUILD_TIME_ENV_KEYS = ['APP_BUILD_TIME', 'BUILD_TIME'];

function pickFirstEnv(keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

async function readPackageMetadata() {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const raw = await fs.readFile(packageJsonPath, 'utf8');
    const pkg = JSON.parse(raw);

    return {
      name: pkg?.name || 'unknown',
      version: pkg?.version || '0.0.0',
    };
  } catch (error) {
    console.error('version metadata read failed', error);

    return {
      name: 'unknown',
      version: '0.0.0',
    };
  }
}

function buildHeaders() {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };
}

async function buildVersionPayload() {
  const pkg = await readPackageMetadata();
  const commitSha = pickFirstEnv(COMMIT_SHA_ENV_KEYS);
  const buildTime = pickFirstEnv(BUILD_TIME_ENV_KEYS);

  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    app: {
      name: pkg.name,
      version: pkg.version,
      environment: process.env.NODE_ENV || 'development',
    },
    build: {
      commitSha,
      buildTime,
    },
  };
}

export async function GET() {
  const payload = await buildVersionPayload();

  return NextResponse.json(payload, {
    status: 200,
    headers: buildHeaders(),
  });
}

export async function HEAD() {
  return new NextResponse(null, {
    status: 200,
    headers: buildHeaders(),
  });
}
