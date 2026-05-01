import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SVG_MIME = 'image/svg+xml; charset=utf-8';

function escapeXml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clip(value = '', max = 42) {
  const raw = String(value || '').trim();
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
}

function paletteForKind(kind = 'file') {
  const normalized = String(kind || '').toLowerCase();
  if (normalized === 'video' || normalized === 'video_note') return ['#201547', '#5d4df0', '#b7a8ff'];
  if (normalized === 'voice' || normalized === 'audio') return ['#12312e', '#168a76', '#9be8d8'];
  if (normalized === 'file') return ['#181b2a', '#475569', '#d5d9e5'];
  return ['#201547', '#6d5efc', '#c7bcff'];
}

export function getPreviewLabel(kind = 'file', mime = '') {
  const normalized = String(kind || '').toLowerCase();
  if (normalized === 'video') return 'VIDEO';
  if (normalized === 'video_note') return 'VIDEO NOTE';
  if (normalized === 'voice' || String(mime || '').startsWith('audio/')) return 'AUDIO';
  if (normalized === 'file') return 'FILE';
  return 'MEDIA';
}

export function buildMediaPreviewSvg({ kind = 'file', mime = '', originalName = '', title = '' } = {}) {
  const [from, mid, to] = paletteForKind(kind);
  const label = escapeXml(getPreviewLabel(kind, mime));
  const name = escapeXml(clip(title || originalName || String(mime || '').split('/')[1] || 'preview', 38));
  const isPlayable = ['video', 'video_note', 'voice', 'audio'].includes(String(kind || '').toLowerCase()) || String(mime || '').startsWith('audio/');
  const icon = isPlayable
    ? '<circle cx="320" cy="210" r="54" fill="rgba(255,255,255,.24)"/><path d="M304 181 L304 239 L352 210 Z" fill="rgba(255,255,255,.92)"/>'
    : '<rect x="270" y="152" width="100" height="124" rx="18" fill="rgba(255,255,255,.22)"/><path d="M338 152 L370 184 L338 184 Z" fill="rgba(255,255,255,.36)"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420" role="img" aria-label="${label}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="58%" stop-color="${mid}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="640" height="420" rx="34" fill="url(#g)"/>
  <circle cx="92" cy="92" r="86" fill="rgba(255,255,255,.11)"/>
  <circle cx="548" cy="332" r="130" fill="rgba(255,255,255,.10)"/>
  <rect x="38" y="38" width="564" height="344" rx="30" fill="rgba(9,11,24,.20)" stroke="rgba(255,255,255,.18)"/>
  ${icon}
  <text x="320" y="330" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="800" fill="rgba(255,255,255,.94)">${label}</text>
  <text x="320" y="362" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="rgba(255,255,255,.70)">${name}</text>
</svg>`;
  return Buffer.from(svg, 'utf8');
}

export function shouldGeneratePreview(kind = '', mime = '') {
  const normalized = String(kind || '').toLowerCase();
  if (normalized === 'image' || String(mime || '').startsWith('image/')) return false;
  return true;
}

export function buildPreviewFilename(filename = 'media.bin') {
  const parsed = path.parse(String(filename || 'media.bin'));
  const base = parsed.name || 'media';
  return `${base}-preview.svg`;
}

export async function writeLocalPreview({ rootDir, basePath, parts = [], filename, previewBuffer }) {
  const previewFilename = buildPreviewFilename(filename);
  const previewDir = path.join(rootDir, ...parts, 'previews');
  await mkdir(previewDir, { recursive: true });
  const targetPath = path.join(previewDir, previewFilename);
  await writeFile(targetPath, previewBuffer);
  return {
    thumbUrl: path.posix.join(basePath, ...parts, 'previews', previewFilename),
    previewFilename,
    previewBytes: previewBuffer.length,
    previewMime: SVG_MIME,
  };
}

export function buildObjectPreviewKey({ rootPrefix, parts = [], filename }) {
  return [rootPrefix, ...parts, 'previews', buildPreviewFilename(filename)].filter(Boolean).join('/');
}

export const MEDIA_PREVIEW_MIME = SVG_MIME;
