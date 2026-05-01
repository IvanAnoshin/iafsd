import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const tsconfig = path.join(root, 'tsconfig.chat-smoke.json');
const chatLib = path.join(root, 'lib', 'chat.js');
const workspaceFile = path.join(root, 'app', 'chat', 'components', 'ChatConversationWorkspace.jsx');
const recorderFile = path.join(root, 'app', 'chat', 'hooks', 'useRecorderAndMedia.js');
const composerFile = path.join(root, 'app', 'chat', 'hooks', 'useMessageComposerRuntime.js');
const pageFile = path.join(root, 'app', 'chat', 'page.jsx');
const mediaLibFile = path.join(root, 'lib', 'chat-media.js');

if (!existsSync(tsconfig)) {
  console.error('Missing tsconfig.chat-smoke.json');
  process.exit(2);
}

function collectTscProblems() {
  let raw = '';
  try {
    execFileSync('npx', ['--yes', 'tsc', '-p', tsconfig, '--noEmit'], {
      cwd: root,
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } catch (error) {
    raw = `${error.stdout || ''}${error.stderr || ''}`.trim();
  }

  const ignoreMatchers = [
    /app\/chat\/components\/ChatConversationWorkspace\.jsx\([0-9,]+\): error TS2322:/,
    /Property 'key' does not exist on type/,
    /useRecorderAndMedia\.js\([0-9,]+\): error TS2339: Property '(durationSec|duration|durationSeconds|width|height|waveform)' does not exist on type '\{\}'\./,
    /chat-media\.js\([0-9,]+\): error TS2339: Property '(durationSec|duration|durationSeconds|width|height|waveform)' does not exist on type '\{\}'\./,
    /lib\/social\.js\([0-9,]+\): error TS2339: Property 'status' does not exist on type 'Error'\./,
  ];

  const lines = raw ? raw.split(/\r?\n/).filter(Boolean) : [];
  return lines.filter((line) => !ignoreMatchers.some((rx) => rx.test(line)));
}

function ensureSnippet(content, snippet, problems, message) {
  if (!content.includes(snippet)) problems.push(message);
}

function ensurePattern(content, pattern, problems, message) {
  if (!pattern.test(content)) problems.push(message);
}

function section(title) {
  return `chat smoke ${title}`;
}

const problems = collectTscProblems();

const chatText = readFileSync(chatLib, 'utf8');
const workspaceText = readFileSync(workspaceFile, 'utf8');
const recorderText = readFileSync(recorderFile, 'utf8');
const composerText = readFileSync(composerFile, 'utf8');
const pageText = readFileSync(pageFile, 'utf8');
const mediaLibText = readFileSync(mediaLibFile, 'utf8');

const formatTimeUses = (chatText.match(/\bformatTime\s*\(/g) || []).length;
const formatTimeDefs = (chatText.match(/function\s+formatTime\s*\(/g) || []).length + (chatText.match(/const\s+formatTime\s*=\s*\(/g) || []).length;
if (formatTimeUses > 0 && formatTimeDefs === 0) {
  problems.push('lib/chat.js: uses formatTime(...) but does not define it.');
}

const voiceChecks = [
  {
    text: chatText,
    snippet: "message.type === 'voice'",
    message: `${section('voice')}: lib/chat.js no longer handles message.type === 'voice'.`,
  },
  {
    text: mediaLibText,
    snippet: 'voice: {',
    message: `${section('voice')}: lib/chat-media.js is missing voice upload config.`,
  },
  {
    text: mediaLibText,
    snippet: "kind: 'voice'",
    message: `${section('voice')}: lib/chat-media.js is missing kind: 'voice'.`,
  },
  {
    text: recorderText,
    snippet: 'function voiceRecorderReducer',
    message: `${section('voice')}: useRecorderAndMedia.js is missing voiceRecorderReducer.`,
  },
  {
    text: recorderText,
    snippet: 'openVoiceRecorder',
    message: `${section('voice')}: useRecorderAndMedia.js is missing openVoiceRecorder().`,
  },
  {
    text: recorderText,
    snippet: 'stopVoiceRecording',
    message: `${section('voice')}: useRecorderAndMedia.js is missing stopVoiceRecording().`,
  },
  {
    text: recorderText,
    snippet: 'retakeVoiceRecording',
    message: `${section('voice')}: useRecorderAndMedia.js is missing retakeVoiceRecording().`,
  },
  {
    text: composerText,
    snippet: 'sendVoiceRecording',
    message: `${section('voice')}: useMessageComposerRuntime.js is missing sendVoiceRecording().`,
  },
  {
    text: composerText,
    snippet: "kind: 'voice'",
    message: `${section('voice')}: voice send path no longer uploads with kind: 'voice'.`,
  },
  {
    text: composerText,
    snippet: "message_type: uploadPayload.message_type || 'voice'",
    message: `${section('voice')}: voice send path no longer sends message_type 'voice'.`,
  },
  {
    text: workspaceText,
    snippet: "item.type === 'voice'",
    message: `${section('voice')}: ChatConversationWorkspace no longer renders voice messages.`,
  },
  {
    text: workspaceText,
    snippet: '<audio className="chatW-media chatW-media-audio"',
    message: `${section('voice')}: ChatConversationWorkspace lost the audio renderer for voice messages.`,
  },
  {
    text: workspaceText,
    snippet: 'aria-label="Запись голосового сообщения"',
    message: `${section('voice')}: voice recorder dialog markup is missing.`,
  },
  {
    text: workspaceText,
    snippet: 'onClick={sendVoiceRecording}',
    message: `${section('voice')}: voice recorder preview no longer sends through sendVoiceRecording().`,
  },
  {
    text: pageText,
    snippet: 'sendVoiceRecording,',
    message: `${section('voice')}: page.jsx no longer wires sendVoiceRecording into the workspace.`,
  },
  {
    text: pageText,
    snippet: 'openVoiceRecorder,',
    message: `${section('voice')}: page.jsx no longer wires openVoiceRecorder into the workspace.`,
  },
];

const videoNoteChecks = [
  {
    text: chatText,
    snippet: "message.type === 'video_note'",
    message: `${section('video_note')}: lib/chat.js no longer handles message.type === 'video_note'.`,
  },
  {
    text: mediaLibText,
    snippet: 'video_note: {',
    message: `${section('video_note')}: lib/chat-media.js is missing video_note upload config.`,
  },
  {
    text: mediaLibText,
    snippet: "kind: 'video_note'",
    message: `${section('video_note')}: lib/chat-media.js is missing kind: 'video_note'.`,
  },
  {
    text: recorderText,
    snippet: 'function videoNoteReducer',
    message: `${section('video_note')}: useRecorderAndMedia.js is missing videoNoteReducer.`,
  },
  {
    text: recorderText,
    snippet: 'openVideoNoteRecorder',
    message: `${section('video_note')}: useRecorderAndMedia.js is missing openVideoNoteRecorder().`,
  },
  {
    text: recorderText,
    snippet: 'startVideoNoteRecording',
    message: `${section('video_note')}: useRecorderAndMedia.js is missing startVideoNoteRecording().`,
  },
  {
    text: recorderText,
    snippet: 'stopVideoNoteRecording',
    message: `${section('video_note')}: useRecorderAndMedia.js is missing stopVideoNoteRecording().`,
  },
  {
    text: recorderText,
    snippet: 'retakeVideoNote',
    message: `${section('video_note')}: useRecorderAndMedia.js is missing retakeVideoNote().`,
  },
  {
    text: composerText,
    snippet: 'sendVideoNote',
    message: `${section('video_note')}: useMessageComposerRuntime.js is missing sendVideoNote().`,
  },
  {
    text: composerText,
    snippet: "kind: 'video_note'",
    message: `${section('video_note')}: video note send path no longer uploads with kind: 'video_note'.`,
  },
  {
    text: composerText,
    snippet: "message_type: uploadPayload.message_type || 'video_note'",
    message: `${section('video_note')}: video note send path no longer sends message_type 'video_note'.`,
  },
  {
    text: workspaceText,
    snippet: "item.type === 'video_note'",
    message: `${section('video_note')}: ChatConversationWorkspace no longer renders video_note messages.`,
  },
  {
    text: workspaceText,
    snippet: '<video className="chatW-media chatW-media-note"',
    message: `${section('video_note')}: ChatConversationWorkspace lost the renderer for sent video notes.`,
  },
  {
    text: workspaceText,
    snippet: 'aria-label="Запись видеокружка"',
    message: `${section('video_note')}: video note recorder dialog markup is missing.`,
  },
  {
    text: workspaceText,
    snippet: 'onClick={sendVideoNote}',
    message: `${section('video_note')}: video note preview no longer sends through sendVideoNote().`,
  },
  {
    text: workspaceText,
    snippet: 'videoNoteLiveRef',
    message: `${section('video_note')}: live preview ref for video notes is missing from workspace.`,
  },
  {
    text: pageText,
    snippet: 'sendVideoNote,',
    message: `${section('video_note')}: page.jsx no longer wires sendVideoNote into the workspace.`,
  },
  {
    text: pageText,
    snippet: 'openVideoNoteRecorder,',
    message: `${section('video_note')}: page.jsx no longer wires openVideoNoteRecorder into the workspace.`,
  },
];

for (const check of [...voiceChecks, ...videoNoteChecks]) {
  ensureSnippet(check.text, check.snippet, problems, check.message);
}

ensurePattern(
  workspaceText,
  /voiceRecorderState\.phase\s*!==\s*'idle'/,
  problems,
  `${section('voice')}: voice recorder panel is no longer guarded by voiceRecorderState.phase !== 'idle'.`,
);
ensurePattern(
  workspaceText,
  /videoNoteState\.phase\s*!==\s*'idle'/,
  problems,
  `${section('video_note')}: video note panel is no longer guarded by videoNoteState.phase !== 'idle'.`,
);
for (const snippet of ['videoNoteState,', 'sendVideoNote,', 'voiceRecorderState,', 'sendVoiceRecording,']) {
  ensureSnippet(
    pageText,
    snippet,
    problems,
    `${section('media wiring')}: page.jsx no longer forwards ${snippet.replace(/,$/, '')} into ChatConversationWorkspace.`,
  );
}

if (problems.length) {
  console.error('Messenger smoke check failed:\n');
  for (const line of problems) console.error(`- ${line}`);
  process.exit(1);
}

console.log('Messenger smoke check passed.');
console.log('Voice + video note smoke checks passed.');
