import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const TARGETS = ['app/api', 'lib'];
const SAFE_HINTS = [
  'canViewerAccessPost',
  'loadPostForViewer',
  'loadCommentForViewer',
  'filterPostsForViewer',
  'canReadPostMediaObject',
  'canReadStoryMediaObject',
  'getConversationMember',
  'conversation: { members',
  'conversation.members.some',
  'requireAdminSession',
  'isAdminUser',
  'getCommunityMembership',
  'requireCommunityPermission',
  'canViewCommunityPosts',
  'markNotificationRead(session.user.id',
  'conversationId_userId',
  'getMessagesForConversation',
  'sendMessageToConversation',
  'markConversationRead',
  'searchConversationMessages',
  'updateTypingForConversation',
  'getTypingSnapshotForConversation',
  'listPinnedMessages',
  'setMessagePinned',
  'toggleMessageReaction',
  'reportMessage',
  'saveMessageForUser',
  'deleteMessage',
  'forwardMessages',
  'getMessageContext',
  'acceptMessageRequest',
  'rejectMessageRequest',
  'listCallsForConversation',
  'getCallSession',
  'createCallSession',
  'applyCallAction',
  'pushCallSignal',
  'canReadChatObject',
  'setConversationArchived',
  'setConversationMuted',
  'setConversationPinned',
  'setDraftForConversation',
  'clearDraftForConversation',
  'getConversationE2EERecipients',
  'assertMediaReferencesBelongToScope',
  'sanitizeClientMediaUrl',
  'sanitizeUrlForClient',
];

const RISKY_PATTERNS = [
  { id: 'raw-id-findUnique', re: /findUnique\s*\(\s*\{\s*where\s*:\s*\{\s*id\s*:/, note: 'findUnique by raw id should be paired with owner/member/access check.' },
  { id: 'route-param-id', re: /params\)\s*\{|await\s+params|params\?\./, note: 'Dynamic route should validate viewer access before returning or mutating data.' },
  { id: 'storage-proxy', re: /createPresignedGetUrl|NextResponse\.redirect\(targetUrl/, note: 'Storage proxy must verify ownership/membership before redirect.' },
  { id: 'json-payload-media', re: /payload.*media|storageKey|previewStorageKey/, note: 'Media in Json payload needs explicit post/story/community visibility checks.' },
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (/\.(js|jsx|mjs)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function hasSafeHint(text) {
  return SAFE_HINTS.some((hint) => text.includes(hint));
}

const files = (await Promise.all(TARGETS.map((target) => walk(path.join(ROOT, target))))).flat();
const findings = [];

for (const file of files) {
  const text = await readFile(file, 'utf8');
  const safe = hasSafeHint(text);
  const lines = text.split(/\r?\n/);
  for (const pattern of RISKY_PATTERNS) {
    const lineIndex = lines.findIndex((line) => pattern.re.test(line));
    if (lineIndex < 0) continue;
    findings.push({
      file: path.relative(ROOT, file),
      line: lineIndex + 1,
      pattern: pattern.id,
      status: safe ? 'reviewed_or_guarded' : 'needs_review',
      note: pattern.note,
    });
  }
}

findings.sort((a, b) => a.status.localeCompare(b.status) || a.file.localeCompare(b.file));
const grouped = findings.reduce((acc, item) => {
  acc[item.status] = (acc[item.status] || 0) + 1;
  return acc;
}, {});

const md = [
  '# Access Control Audit',
  '',
  `Generated at: ${new Date().toISOString()}`,
  '',
  '## Summary',
  '',
  `- Needs review: ${grouped.needs_review || 0}`,
  `- Reviewed or guarded: ${grouped.reviewed_or_guarded || 0}`,
  '',
  '## Findings',
  '',
  '| Status | Pattern | File | Line | Note |',
  '|---|---|---:|---:|---|',
  ...findings.map((item) => `| ${item.status} | ${item.pattern} | \`${item.file}\` | ${item.line} | ${item.note} |`),
  '',
  '## Rule of thumb',
  '',
  'Every route that accepts an id from URL/body must prove one of these before reading/mutating: owner, participant, active community member/moderator, admin, or public visibility.',
  '',
].join('\n');

await writeFile(path.join(ROOT, 'docs', 'access-control-audit.md'), md);
await writeFile(path.join(ROOT, 'docs', 'access-control-audit.json'), JSON.stringify({ generated_at: new Date().toISOString(), summary: grouped, findings }, null, 2));

console.log(`Access-control audit complete: ${findings.length} findings (${grouped.needs_review || 0} needs review).`);
