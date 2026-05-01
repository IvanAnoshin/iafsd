import prisma from '@/lib/prisma';
import { createNotification } from '@/lib/notifications';
import { sortFriendPair } from '@/lib/social';
import { getUserPreferences, isMessagingAllowed } from '@/lib/user-preferences';
import { emitUsersEvent } from '@/lib/chat-realtime';
import { emitUnreadSummary } from '@/lib/realtime-sync';
import { enforceMessageAntiSpam, evaluateReportedMessageSafety, upsertPeerSafetyBlock } from '@/lib/chat-safety';
import { assertMediaReferencesBelongToScope, sanitizeClientMediaUrl } from '@/lib/media-security';

const CHAT_SEED_TEXTS = [
  [
    'Мне нравится, что чат теперь реально живой, а не просто декоративный экран.',
    'Да, теперь можно спокойно доводить детали уже на настоящем backend.',
  ],
  [
    'Новый мессенджер стал заметно чище и спокойнее по ритму.',
    'Главное теперь не перегрузить интерфейс лишними меню и всплывашками.',
  ],
  [
    'Сначала структура, потом косметика. В чатах это особенно важно.',
    'Согласна, сначала адекватная логика диалогов и непрочитанных.',
  ],
];

const MESSAGE_TYPES = new Set(['text', 'image', 'video', 'file', 'voice', 'video_note', 'system', 'encrypted', 'story_reply', 'shared_story']);
const MEDIA_MESSAGE_TYPES = new Set(['image', 'video', 'file', 'voice', 'video_note']);
const STORY_MESSAGE_TYPES = new Set(['story_reply', 'shared_story']);
const EDITABLE_MESSAGE_TYPES = new Set(['text', 'system']);
const PRESENCE_TTL_MS = 70_000;
const TYPING_TTL_MS = 6_000;
const SEED_CHAT_ENV = 'FRIENDSCAPE_ENABLE_SEED_CHATS';

function shouldSeedChatsInRuntime() {
  const raw = String(process.env[SEED_CHAT_ENV] || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
}


const QUICK_REACTION_EMOJIS = new Set(['❤️', '👍', '😂', '🔥', '😮', '😢']);

function normalizeReactionEmoji(value) {
  const emoji = String(value || '❤️').trim();
  return QUICK_REACTION_EMOJIS.has(emoji) ? emoji : '❤️';
}

function readMessageReactions(metadata) {
  const source = safeObject(metadata);
  const raw = Array.isArray(source.reactions) ? source.reactions : [];
  return raw
    .map((entry) => {
      const userIds = Array.from(new Set((Array.isArray(entry?.userIds) ? entry.userIds : Array.isArray(entry?.user_ids) ? entry.user_ids : [])
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0)));
      if (!userIds.length) return null;
      return {
        emoji: normalizeReactionEmoji(entry?.emoji),
        userIds,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.userIds.length !== left.userIds.length) return right.userIds.length - left.userIds.length;
      return String(left.emoji).localeCompare(String(right.emoji), 'ru-RU');
    });
}

function writeMessageReactions(metadata, reactions) {
  const source = safeObject(metadata);
  const next = { ...source };
  if (Array.isArray(reactions) && reactions.length) {
    next.reactions = reactions.map((entry) => ({
      emoji: normalizeReactionEmoji(entry?.emoji),
      userIds: Array.from(new Set((Array.isArray(entry?.userIds) ? entry.userIds : [])
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0))),
    })).filter((entry) => entry.userIds.length);
  } else {
    delete next.reactions;
  }
  return Object.keys(next).length ? next : null;
}

function buildSerializedReactions(metadata, viewerId) {
  return readMessageReactions(metadata).map((entry) => ({
    emoji: entry.emoji,
    count: entry.userIds.length,
    reacted_by_me: entry.userIds.includes(Number(viewerId)),
  }));
}


function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeMessageType(value) {
  const type = String(value || 'text').trim().toLowerCase();
  return MESSAGE_TYPES.has(type) ? type : 'text';
}

function toBoundedString(value, limit = 10000) {
  const text = String(value || '').trim();
  return text ? text.slice(0, limit) : '';
}

function toPositiveInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const rounded = Math.trunc(number);
  return rounded > 0 ? rounded : null;
}

function normalizeWaveform(value) {
  if (!Array.isArray(value)) return null;
  const compact = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .slice(0, 256);
  return compact.length ? compact : null;
}

function normalizeMediaPayload(payload = {}, type = 'text') {
  const source = safeObject(payload.media || payload.attachment || payload.file || {});
  const mediaKind = String(source.kind || type || '').trim().toLowerCase();
  const mediaUrl = sanitizeClientMediaUrl(source.url || source.mediaUrl || source.path);
  const mediaThumbUrl = sanitizeClientMediaUrl(source.thumbUrl || source.thumbnailUrl);
  const mediaMime = toBoundedString(source.mime || source.mimeType || '', 255);
  const mediaBytes = toPositiveInt(source.bytes || source.size || source.fileSize);
  const mediaDurationSec = toPositiveInt(source.durationSec || source.duration || source.durationSeconds);
  const mediaWidth = toPositiveInt(source.width);
  const mediaHeight = toPositiveInt(source.height);
  const mediaWaveform = normalizeWaveform(source.waveform);

  const hasMedia = Boolean(mediaUrl || mediaMime || mediaBytes || mediaDurationSec || mediaWidth || mediaHeight || mediaWaveform);
  if (!hasMedia) return null;

  return {
    mediaKind: mediaKind || type || 'file',
    mediaUrl: mediaUrl || null,
    mediaThumbUrl: mediaThumbUrl || null,
    mediaMime: mediaMime || null,
    mediaBytes,
    mediaDurationSec,
    mediaWidth,
    mediaHeight,
    mediaWaveform,
  };
}

function normalizeStoryReference(payload = {}, type = 'text') {
  if (!STORY_MESSAGE_TYPES.has(type)) return null;
  const source = safeObject(payload.story_ref || payload.storyRef || payload.story || payload.shared_story || payload.story_reply || safeObject(payload.metadata).story_ref || safeObject(payload.metadata).story);
  const storyId = toBoundedString(source.story_id || source.storyId || '', 191) || null;
  const itemId = toBoundedString(source.item_id || source.itemId || source.story_item_id || source.storyItemId || '', 191) || null;
  const authorId = toPositiveInt(source.author_id || source.authorId || source.owner_id || source.ownerId || source.user_id || source.userId);
  const authorName = toBoundedString(source.author_name || source.authorName || source.owner_name || source.ownerName || source.user_name || source.userName || '', 160) || null;
  const title = toBoundedString(source.title || source.label || '', 160) || null;
  const subtitle = toBoundedString(source.subtitle || source.caption || '', 280) || null;
  const previewUrl = sanitizeClientMediaUrl(source.preview_url || source.previewUrl || source.thumb_url || source.thumbUrl || source.cover_url || source.coverUrl || source.image_url || source.imageUrl) || null;
  const deepLink = sanitizeClientMediaUrl(source.deep_link || source.deepLink || source.url || source.href) || null;
  const expiresAt = source.expires_at || source.expiresAt || null;
  const kind = toBoundedString(source.kind || source.media_kind || source.mediaKind || '', 40) || null;
  const replyText = toBoundedString(source.reply_text || source.replyText || '', 280) || null;

  if (!storyId && !itemId && !previewUrl && !deepLink && !authorName && !title) return null;

  return {
    story_id: storyId,
    item_id: itemId,
    author_id: authorId,
    author_name: authorName,
    title,
    subtitle,
    preview_url: previewUrl,
    deep_link: deepLink,
    expires_at: expiresAt,
    kind,
    reply_text: replyText,
  };
}

function buildStoryPreviewText(storyRef, type = 'shared_story') {
  const story = safeObject(storyRef);
  const author = toBoundedString(story.author_name || '', 120) || 'пользователя';
  const title = toBoundedString(story.title || '', 160);
  const subtitle = toBoundedString(story.subtitle || story.reply_text || '', 200);
  if (type === 'story_reply') {
    if (subtitle) return `Ответ на момент: ${subtitle}`;
    if (title) return `Ответ на момент: ${title}`;
    return `Ответ на момент ${author}`;
  }
  if (title) return `Момент: ${title}`;
  if (subtitle) return `Момент: ${subtitle}`;
  return `Момент ${author}`;
}

function normalizeEncryptionPayload(payload = {}) {
  const source = safeObject(payload.encryption || payload.e2ee || {});
  const ciphertext = toBoundedString(source.ciphertext, 250000);
  const scheme = toBoundedString(source.scheme || source.encryptionScheme, 120);
  const senderDeviceId = toBoundedString(source.senderDeviceId, 191);
  const recipientDeviceId = toBoundedString(source.recipientDeviceId, 191);
  const cipherHeader = toBoundedString(source.cipherHeader, 10000);
  const cipherAAD = toBoundedString(source.cipherAAD, 10000);
  const contentHint = toBoundedString(source.contentHint, 255);
  const keyEnvelope = toBoundedString(source.keyEnvelope, 15000);

  const hasEncryption = Boolean(ciphertext || scheme || senderDeviceId || recipientDeviceId || cipherHeader || cipherAAD || contentHint || keyEnvelope);
  if (!hasEncryption) return null;

  return {
    isEncrypted: true,
    encryptionScheme: scheme || 'signal',
    senderDeviceId: senderDeviceId || null,
    recipientDeviceId: recipientDeviceId || null,
    ciphertext: ciphertext || null,
    cipherHeader: cipherHeader || null,
    cipherAAD: cipherAAD || null,
    contentHint: contentHint || null,
    keyEnvelope: keyEnvelope || null,
  };
}

function buildMessageTextPreview(message) {
  if (!message) return '';
  if (message.deletedAt || message.deletedForAllAt) return 'Сообщение удалено';
  if (message.type === 'encrypted' || message.isEncrypted) return 'Зашифрованное сообщение';
  if (message.type === 'voice') return message.text || 'Голосовое сообщение';
  if (message.type === 'video_note') return message.text || 'Видеокружок';
  if (message.type === 'image') return message.text || 'Изображение';
  if (message.type === 'video') return message.text || 'Видео';
  if (message.type === 'file') return message.text || 'Файл';
  if (message.type === 'story_reply') return message.text || buildStoryPreviewText(safeObject(message.metadata).story_ref || safeObject(message.metadata).story, 'story_reply');
  if (message.type === 'shared_story') return message.text || buildStoryPreviewText(safeObject(message.metadata).story_ref || safeObject(message.metadata).story, 'shared_story');
  if (message.type === 'system') return message.text || 'Системное сообщение';
  return String(message.text || '').trim() || 'Сообщение';
}

function buildMessagePreviewMeta(message) {
  if (!message) return null;
  const meta = {
    type: message.type || 'text',
    isEncrypted: Boolean(message.isEncrypted),
  };
  if (message.mediaKind || message.mediaUrl || message.mediaMime) {
    meta.media = {
      kind: message.mediaKind || null,
      mime: message.mediaMime || null,
      thumbUrl: message.mediaThumbUrl || null,
      durationSec: message.mediaDurationSec || null,
    };
  }
  const story = safeObject(message.metadata).story_ref || safeObject(message.metadata).story || null;
  if (story && typeof story === 'object' && !Array.isArray(story) && Object.keys(story).length) {
    meta.story = {
      story_id: story.story_id || story.storyId || null,
      item_id: story.item_id || story.itemId || null,
      author_name: story.author_name || story.authorName || null,
      title: story.title || null,
      subtitle: story.subtitle || null,
      preview_url: story.preview_url || story.previewUrl || null,
      deep_link: story.deep_link || story.deepLink || null,
    };
  }
  return meta;
}

function buildConversationRollupFromMessage(message) {
  if (!message) {
    return {
      lastMessageAt: null,
      lastMessageId: null,
      lastMessageType: null,
      lastSenderId: null,
      lastPreviewText: null,
      lastPreviewMeta: null,
    };
  }

  return {
    lastMessageAt: message.createdAt,
    lastMessageId: message.id,
    lastMessageType: message.type || 'text',
    lastSenderId: message.senderId || null,
    lastPreviewText: buildMessageTextPreview(message),
    lastPreviewMeta: buildMessagePreviewMeta(message),
  };
}

function mergeMessageMetadata(payload = {}, { media, encryption, storyRef, type }) {
  const metadata = safeObject(payload.metadata);
  const nextMetadata = { ...metadata };
  if (media) {
    nextMetadata.media = {
      kind: media.mediaKind || null,
      url: media.mediaUrl || null,
      thumbUrl: media.mediaThumbUrl || null,
      mime: media.mediaMime || null,
      bytes: media.mediaBytes || null,
      durationSec: media.mediaDurationSec || null,
      width: media.mediaWidth || null,
      height: media.mediaHeight || null,
      waveform: media.mediaWaveform || null,
    };
  }
  if (encryption) {
    nextMetadata.encryption = {
      scheme: encryption.encryptionScheme || null,
      senderDeviceId: encryption.senderDeviceId || null,
      recipientDeviceId: encryption.recipientDeviceId || null,
      contentHint: encryption.contentHint || null,
    };
  }
  if (storyRef) {
    nextMetadata.story_ref = {
      story_id: storyRef.story_id || null,
      item_id: storyRef.item_id || null,
      author_id: storyRef.author_id || null,
      author_name: storyRef.author_name || null,
      title: storyRef.title || null,
      subtitle: storyRef.subtitle || null,
      preview_url: storyRef.preview_url || null,
      deep_link: storyRef.deep_link || null,
      expires_at: storyRef.expires_at || null,
      kind: storyRef.kind || null,
      reply_text: storyRef.reply_text || null,
    };
  }
  nextMetadata.kind = type;
  return Object.keys(nextMetadata).length ? nextMetadata : null;
}

function normalizeMessageInput(payload = {}) {
  const type = normalizeMessageType(payload?.type);
  const text = toBoundedString(payload?.text, 5000);
  const clientId = toBoundedString(payload?.clientId || payload?.client_id, 191) || null;
  const replyToMessageId = toBoundedString(payload?.replyToMessageId || payload?.reply_to_message_id, 191) || null;
  const media = normalizeMediaPayload(payload, type);
  const storyRef = normalizeStoryReference(payload, type);
  const encryption = type === 'encrypted' || payload?.encryption || payload?.e2ee ? normalizeEncryptionPayload(payload) : null;

  if (type === 'encrypted' && !encryption?.ciphertext) {
    throw Object.assign(new Error('Для зашифрованного сообщения нужен ciphertext.'), { status: 400 });
  }

  if (MEDIA_MESSAGE_TYPES.has(type) && !media?.mediaUrl) {
    throw Object.assign(new Error('Для медиа-сообщения нужен файл или media.url.'), { status: 400 });
  }

  if (STORY_MESSAGE_TYPES.has(type) && !storyRef) {
    throw Object.assign(new Error('Для сообщения с моментом нужна ссылка на сам момент.'), { status: 400 });
  }

  if (!text && !media && !encryption && !storyRef && type !== 'system') {
    throw Object.assign(new Error('Введите сообщение или приложите вложение.'), { status: 400 });
  }

  return {
    type,
    text,
    clientId,
    replyToMessageId,
    media,
    encryption,
    storyRef,
    metadata: mergeMessageMetadata(payload, { media, encryption, storyRef, type }),
  };
}

function hasChatModels(db = prisma) {
  return Boolean(db?.conversation && db?.conversationMember && db?.chatMessage);
}

function sortIds(a, b) {
  const left = Number(a);
  const right = Number(b);
  return left < right ? [left, right] : [right, left];
}

function directKeyFor(userAId, userBId) {
  const [left, right] = sortIds(userAId, userBId);
  return `${left}:${right}`;
}

function initialsOf(firstName, lastName) {
  const left = String(firstName || '').trim().charAt(0);
  const right = String(lastName || '').trim().charAt(0);
  return `${left}${right}`.toUpperCase() || 'U';
}

function toneOf(profile) {
  const tone = String(profile?.tone || '').trim().toLowerCase();
  return tone || 'violet';
}

function statusOf(profile) {
  const raw = String(profile?.status || '').trim().toLowerCase();
  if (raw === 'online') return 'в сети';
  if (raw === 'recent') return 'был(а) недавно';
  return raw || 'доступен(а)';
}

function formatChatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера';

  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

function formatMessageTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatTime(value) {
  return formatMessageTime(value);
}

function buildConversationName(conversation, viewerId) {
  if (conversation.type !== 'direct') {
    return conversation.title || 'Групповой чат';
  }

  const peer = conversation.members.find((member) => member.userId !== viewerId)?.user;
  if (!peer) return 'Диалог';
  return `${peer.firstName} ${peer.lastName}`.trim();
}

function buildConversationStatus(conversation, viewerId) {
  if (conversation.type !== 'direct') {
    const count = conversation.members.length;
    return `${count} ${count === 1 ? 'участник' : count < 5 ? 'участника' : 'участников'}`;
  }

  const peer = conversation.members.find((member) => member.userId !== viewerId)?.user;
  return statusOf(peer?.publicProfile);
}

function buildConversationInitials(conversation, viewerId) {
  if (conversation.type !== 'direct') {
    return String(conversation.title || 'GC')
      .split(/\s+/)
      .map((part) => part.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'GC';
  }

  const peer = conversation.members.find((member) => member.userId !== viewerId)?.user;
  return initialsOf(peer?.firstName, peer?.lastName);
}

function buildConversationTone(conversation, viewerId) {
  if (conversation.type !== 'direct') return 'violet';
  const peer = conversation.members.find((member) => member.userId !== viewerId)?.user;
  return toneOf(peer?.publicProfile);
}

function buildPreview(lastMessage, viewerId, membership, conversation = null) {
  const draftText = String(membership?.draftText || '').trim();
  if (draftText) return `Черновик: ${draftText}`;
  if (!lastMessage && conversation?.lastPreviewText) return conversation.lastPreviewText;
  if (!lastMessage) return 'Начните разговор';
  const preview = buildMessageTextPreview(lastMessage);
  const prefix = lastMessage.senderId === viewerId ? 'Вы: ' : '';
  return `${prefix}${preview}`.trim();
}

function getReplyPreview(message) {
  const reply = message?.replyToMessage;
  if (!reply) return null;
  const authorName = `${reply.sender?.firstName || ''} ${reply.sender?.lastName || ''}`.trim() || 'Пользователь';
  const text = reply.deletedAt ? 'Сообщение удалено' : buildMessageTextPreview(reply);
  return {
    id: reply.id,
    author: authorName,
    text,
    type: normalizeMessageType(reply.type || 'text'),
  };
}

function getForwardPreview(message) {
  const forwarded = safeObject(message?.metadata?.forwarded);
  if (!Object.keys(forwarded).length) return null;
  const previewText = toBoundedString(forwarded.preview_text || forwarded.previewText || '', 280) || buildMessageTextPreview(message);
  const senderName = toBoundedString(forwarded.sender_name || forwarded.senderName || '', 160) || 'Пользователь';
  return {
    message_id: toBoundedString(forwarded.message_id || forwarded.messageId || '', 191) || null,
    conversation_id: toBoundedString(forwarded.conversation_id || forwarded.conversationId || '', 191) || null,
    sender_id: toPositiveInt(forwarded.sender_id || forwarded.senderId),
    sender_name: senderName,
    type: normalizeMessageType(forwarded.type || message?.type || 'text'),
    preview_text: previewText,
  };
}


function getStoryReference(message) {
  const source = safeObject(message?.metadata?.story_ref || message?.metadata?.story);
  if (!Object.keys(source).length) return null;
  return {
    story_id: toBoundedString(source.story_id || source.storyId || '', 191) || null,
    item_id: toBoundedString(source.item_id || source.itemId || source.story_item_id || source.storyItemId || '', 191) || null,
    author_id: toPositiveInt(source.author_id || source.authorId || source.owner_id || source.ownerId || source.user_id || source.userId),
    author_name: toBoundedString(source.author_name || source.authorName || source.owner_name || source.ownerName || source.user_name || source.userName || '', 160) || null,
    title: toBoundedString(source.title || source.label || '', 160) || null,
    subtitle: toBoundedString(source.subtitle || source.caption || source.reply_text || source.replyText || '', 280) || null,
    preview_url: toBoundedString(source.preview_url || source.previewUrl || source.thumb_url || source.thumbUrl || source.cover_url || source.coverUrl || source.image_url || source.imageUrl || '', 4000) || null,
    deep_link: toBoundedString(source.deep_link || source.deepLink || source.url || source.href || '', 4000) || null,
    expires_at: source.expires_at || source.expiresAt || null,
    kind: toBoundedString(source.kind || source.media_kind || source.mediaKind || '', 40) || null,
    reply_text: toBoundedString(source.reply_text || source.replyText || '', 280) || null,
  };
}

function getPostReference(message) {
  const source = safeObject(message?.metadata?.post_ref || message?.metadata?.post || message?.metadata?.shared_post);
  if (!Object.keys(source).length) return null;
  const postId = toPositiveInt(source.post_id || source.postId || source.id);
  const url = toBoundedString(source.url || source.href || '', 4000) || null;
  const deepLink = toBoundedString(source.deep_link || source.deepLink || '', 4000) || null;
  const title = toBoundedString(source.title || source.label || '', 180) || 'Публикация Friendscape';
  const text = toBoundedString(source.text || source.preview || source.subtitle || '', 320) || null;
  const authorName = toBoundedString(source.author_name || source.authorName || '', 160) || null;
  if (!postId && !url && !deepLink && !text && !authorName) return null;
  return {
    post_id: postId,
    author_id: toPositiveInt(source.author_id || source.authorId || source.owner_id || source.ownerId),
    author_name: authorName,
    title,
    text,
    type: toBoundedString(source.type || source.kind || '', 40) || 'post',
    url,
    deep_link: deepLink,
    created_at: source.created_at || source.createdAt || null,
  };
}

function hasMessageRequestModel(db = prisma) {
  return Boolean(db?.messageRequest);
}

function hasMessengerPeerBlockModel(db = prisma) {
  return Boolean(db?.messengerPeerBlock);
}

function hasSavedChatMessageModel(db = prisma) {
  return Boolean(db?.savedChatMessage);
}

function hasChatMessageReportModel(db = prisma) {
  return Boolean(db?.chatMessageReport);
}

function hasPinnedChatMessageModel(db = prisma) {
  return Boolean(db?.pinnedChatMessage);
}

function getRuntimeModelFieldNames(db = prisma, modelName = '') {
  const runtimeModels = db?._runtimeDataModel?.models;
  const runtimeModel = runtimeModels?.[modelName] || runtimeModels?.get?.(modelName) || null;
  const runtimeFields = Array.isArray(runtimeModel?.fields)
    ? runtimeModel.fields.map((field) => (typeof field === 'string' ? field : field?.name)).filter(Boolean)
    : runtimeModel?.fields && typeof runtimeModel.fields === 'object'
      ? Object.values(runtimeModel.fields).map((field) => (typeof field === 'string' ? field : field?.name)).filter(Boolean)
      : [];

  if (runtimeFields.length) return new Set(runtimeFields);

  const dmmfModel = db?._baseDmmf?.modelMap?.[modelName]
    || db?._baseDmmf?.datamodel?.models?.find?.((model) => model?.name === modelName)
    || null;
  const dmmfFields = Array.isArray(dmmfModel?.fields)
    ? dmmfModel.fields.map((field) => (typeof field === 'string' ? field : field?.name)).filter(Boolean)
    : [];

  return new Set(dmmfFields);
}

function chatMessageHasIncludeField(fieldName, db = prisma) {
  if (!fieldName) return false;
  return getRuntimeModelFieldNames(db, 'ChatMessage').has(String(fieldName));
}

function hasChatMessageReportInclude(db = prisma) {
  return hasChatMessageReportModel(db) && chatMessageHasIncludeField('reports', db);
}

function hasPinnedChatMessageInclude(db = prisma) {
  return hasPinnedChatMessageModel(db) && chatMessageHasIncludeField('pinnedEntries', db);
}

async function getMessageRequestForConversation(conversationId, db = prisma) {
  if (!hasMessageRequestModel(db)) return null;
  return db.messageRequest.findUnique({ where: { conversationId: String(conversationId) } });
}

async function getMessagingTrust(viewerId, targetUserId, db = prisma) {
  const viewer = Number(viewerId);
  const target = Number(targetUserId);
  if (!Number.isInteger(viewer) || !Number.isInteger(target) || viewer <= 0 || target <= 0) {
    return { trusted: false, reason: 'invalid', requiresRequest: false, hardBlocked: true };
  }
  const [userAId, userBId] = sortFriendPair(viewer, target);
  const [friendship, follows, followedBy, preferences] = await Promise.all([
    db.friendship.findUnique({ where: { userAId_userBId: { userAId, userBId } }, select: { id: true } }),
    db.subscription.findUnique({ where: { fromUserId_toUserId: { fromUserId: viewer, toUserId: target } }, select: { id: true } }),
    db.subscription.findUnique({ where: { fromUserId_toUserId: { fromUserId: target, toUserId: viewer } }, select: { id: true } }),
    getUserPreferences(target, db),
  ]);
  const relation = {
    is_self: viewer === target,
    is_friend: Boolean(friendship),
    has_connection: Boolean(friendship || follows || followedBy),
    follows: Boolean(follows),
    followed_by: Boolean(followedBy),
  };
  const decision = isMessagingAllowed(preferences, relation);
  return {
    trusted: Boolean(decision.allowed),
    reason: decision.reason,
    requiresRequest: Boolean(decision.requires_request),
    hardBlocked: !decision.allowed && !decision.requires_request,
  };
}

function requestStateForViewer(request, viewerId) {
  if (!request) return null;
  if (request.status === 'pending' && request.toUserId === viewerId) return 'incoming';
  if (request.status === 'pending' && request.fromUserId === viewerId) return 'outgoing';
  return request.status || null;
}

function serializeConversation(conversation, viewerId) {
  const membership = conversation.members.find((member) => member.userId === viewerId);
  const lastMessage = conversation.messages?.[0] || null;
  const unreadCount = Number(conversation._count?.messages || 0);
  const draftText = String(membership?.draftText || '').trim();
  const request = conversation.messageRequest || null;
  const requestState = conversation?.peer_blocked ? 'blocked' : requestStateForViewer(request, viewerId);

  return {
    id: conversation.id,
    type: conversation.type,
    name: buildConversationName(conversation, viewerId),
    status: buildConversationStatus(conversation, viewerId),
    preview: buildPreview(lastMessage, viewerId, membership, conversation),
    time: formatChatTime(lastMessage?.createdAt || conversation.lastMessageAt || conversation.updatedAt),
    unread: unreadCount,
    initials: buildConversationInitials(conversation, viewerId),
    tone: buildConversationTone(conversation, viewerId),
    pinned: Boolean(membership?.pinned || membership?.pinnedAt),
    muted: Boolean(membership?.muted || (membership?.mutedUntil && new Date(membership.mutedUntil).getTime() > Date.now())),
    archived: Boolean(membership?.archivedAt),
    request_state: requestState,
    draft_text: draftText || null,
    draft_updated_at: membership?.draftUpdatedAt || null,
    peer: (() => {
      const peer = conversation.members.find((member) => member.userId !== viewerId)?.user;
      if (!peer) return null;
      return {
        id: peer.id,
        name: `${peer.firstName} ${peer.lastName}`.trim(),
        handle: peer.publicProfile?.handle ? `@${peer.publicProfile.handle}` : null,
      };
    })(),
  };
}

function serializeChatMessageReport(report) {
  return {
    id: report.id,
    message_id: report.messageId,
    reporter_user_id: report.reporterUserId,
    reason: report.reason,
    details: report.details || null,
    status: report.status,
    created_at: report.createdAt,
    updated_at: report.updatedAt,
  };
}

function serializeMessage(message, viewerId) {
  const isMine = message.senderId === viewerId;
  const isDeleted = Boolean(message.deletedAt);
  const isFailed = String(message.status || '').toLowerCase() === 'failed';
  const isSending = String(message.status || '').toLowerCase() === 'sending';
  const isSaved = Array.isArray(message.savedBy) ? message.savedBy.length > 0 : Boolean(message.isSaved);
  const reportedByMe = Array.isArray(message.reports) ? message.reports.length > 0 : Boolean(message.reportedByMe);
  const isPinned = Array.isArray(message.pinnedEntries) ? message.pinnedEntries.length > 0 : Boolean(message.isPinned);
  const forwardedFrom = getForwardPreview(message);
  const storyRef = getStoryReference(message);
  const postRef = getPostReference(message);

  return {
    id: message.id,
    client_id: message.clientId || null,
    type: message.type,
    text: message.deletedAt ? 'Сообщение удалено' : message.text,
    preview_text: buildMessageTextPreview(message),
    state: isMine ? (message.status || 'sent') : null,
    created_at: message.createdAt,
    updated_at: message.updatedAt,
    edited_at: message.editedAt,
    deleted_at: message.deletedAt,
    deleted_for_all_at: message.deletedForAllAt || null,
    server_ack_at: message.serverAckAt || null,
    delivered_at: message.deliveredAt || null,
    failed_at: message.failedAt || null,
    failure_code: message.failureCode || null,
    time: formatMessageTime(message.createdAt),
    direction: isMine ? 'outgoing' : 'incoming',
    is_mine: isMine,
    edited: Boolean(message.editedAt),
    deleted: Boolean(message.deletedAt),
    message_version: message.messageVersion || 1,
    system_type: message.systemType || null,
    is_encrypted: Boolean(message.isEncrypted),
    encryption: message.isEncrypted ? {
      scheme: message.encryptionScheme || null,
      sender_device_id: message.senderDeviceId || null,
      recipient_device_id: message.recipientDeviceId || null,
      content_hint: message.contentHint || null,
      has_ciphertext: Boolean(message.ciphertext),
      has_key_envelope: Boolean(message.keyEnvelope),
      ciphertext: message.ciphertext || null,
      cipher_header: message.cipherHeader || null,
      cipher_aad: message.cipherAAD || null,
      key_envelope: message.keyEnvelope || null,
    } : null,
    media: message.mediaKind || message.mediaUrl || message.mediaMime ? {
      kind: message.mediaKind || null,
      url: message.mediaUrl || null,
      thumb_url: message.mediaThumbUrl || null,
      mime: message.mediaMime || null,
      bytes: message.mediaBytes || null,
      duration_sec: message.mediaDurationSec || null,
      width: message.mediaWidth || null,
      height: message.mediaHeight || null,
      waveform: message.mediaWaveform || null,
    } : null,
    reply_to: getReplyPreview(message),
    forwarded_from: forwardedFrom,
    story_ref: storyRef,
    post_ref: postRef,
    reactions: buildSerializedReactions(message.metadata, viewerId),
    is_saved: isSaved,
    is_pinned: isPinned,
    reported_by_me: reportedByMe,
    can_reply: !isDeleted && !isSending,
    can_copy: !isDeleted && !STORY_MESSAGE_TYPES.has(message.type) && Boolean(String(message.text || '').trim() || String(buildMessageTextPreview(message) || '').trim()),
    can_save: !isDeleted && !isFailed && !isSending,
    can_pin: !isDeleted && !isFailed && !isSending && message.type !== 'system',
    can_report: !isDeleted && !isMine,
    can_forward: !isDeleted && !isFailed && !isSending && !message.isEncrypted && message.type !== 'system',
    can_edit: isMine && !isDeleted && !isFailed && !isSending && EDITABLE_MESSAGE_TYPES.has(message.type) && !message.isEncrypted && !message.mediaUrl,
    can_delete: isMine,
    metadata: message.metadata || null,
    sender: {
      id: message.sender.id,
      name: `${message.sender.firstName} ${message.sender.lastName}`.trim(),
      initials: initialsOf(message.sender.firstName, message.sender.lastName),
    },
  };
}


function buildMessageSearchSnippet(text, query) {
  const source = String(text || '').trim();
  if (!source) return '';
  const q = String(query || '').trim().toLocaleLowerCase('ru-RU');
  if (!q) return source.slice(0, 180);
  const lower = source.toLocaleLowerCase('ru-RU');
  const index = lower.indexOf(q);
  if (index < 0) return source.slice(0, 180);
  const start = Math.max(0, index - 48);
  const end = Math.min(source.length, index + q.length + 72);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < source.length ? '…' : '';
  return `${prefix}${source.slice(start, end)}${suffix}`;
}

function buildConversationSearchWhere(conversationId, clearedAt, query, type = '') {
  const normalizedType = String(type || '').trim().toLowerCase();
  const normalizedQuery = String(query || '').trim();
  const baseWhere = {
    conversationId: String(conversationId),
    deletedAt: null,
    createdAt: { gt: clearedAt || new Date(0) },
  };

  if (normalizedType === 'image') baseWhere.type = 'image';
  else if (normalizedType === 'video') baseWhere.type = { in: ['video', 'video_note'] };
  else if (normalizedType === 'file') baseWhere.type = 'file';
  else if (normalizedType === 'voice') baseWhere.type = 'voice';

  const andClauses = [];
  if (normalizedQuery) {
    andClauses.push({ text: { contains: normalizedQuery, mode: 'insensitive' } });
  }
  if (normalizedType === 'link') {
    andClauses.push({
      OR: [
        { text: { contains: 'http', mode: 'insensitive' } },
        { text: { contains: 'www.', mode: 'insensitive' } },
      ],
    });
  }
  if (andClauses.length) baseWhere.AND = andClauses;
  return baseWhere;
}

function buildSearchMessageInclude(userId, db = prisma) {
  const include = {
    sender: true,
    replyToMessage: { include: { sender: true } },
  };
  if (hasSavedChatMessageModel(db)) {
    include.savedBy = { where: { userId: Number(userId) }, select: { id: true } };
  }
  if (hasChatMessageReportModel(db)) {
    include.reports = { where: { reporterUserId: Number(userId) }, select: { id: true } };
  }
  if (hasPinnedChatMessageModel(db)) {
    include.pinnedEntries = { select: { id: true } };
  }
  return include;
}

async function getConversationForUser(userId, conversationId, db = prisma) {
  if (!hasChatModels(db)) return null;
  return db.conversation.findFirst({
    where: {
      id: String(conversationId),
      members: { some: { userId } },
    },
    include: {
      members: {
        include: {
          user: { include: { publicProfile: true } },
        },
      },
    },
  });
}

async function getConversationMember(userId, conversationId, db = prisma) {
  return db.conversationMember.findUnique({
    where: {
      conversationId_userId: {
        conversationId: String(conversationId),
        userId: Number(userId),
      },
    },
  });
}

async function listRecipientIds(conversationId, senderId, db = prisma) {
  const members = await db.conversationMember.findMany({
    where: { conversationId: String(conversationId), userId: { not: Number(senderId) } },
    select: { userId: true },
  });
  return members.map((member) => member.userId);
}

async function publishConversationUpdated(conversationId, db = prisma) {
  const memberships = await db.conversationMember.findMany({
    where: { conversationId: String(conversationId) },
    select: { userId: true },
  });
  emitUsersEvent(memberships.map((member) => member.userId), 'chat.updated', {
    conversationId: String(conversationId),
    timestamp: new Date().toISOString(),
  });
}

async function refreshConversationState(conversationId, db = prisma) {
  const conversationKey = String(conversationId);
  const [latestMessage, memberships] = await Promise.all([
    db.chatMessage.findFirst({
      where: { conversationId: conversationKey, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        senderId: true,
        type: true,
        text: true,
        createdAt: true,
        deletedAt: true,
        deletedForAllAt: true,
        isEncrypted: true,
        mediaKind: true,
        mediaUrl: true,
        mediaThumbUrl: true,
        mediaMime: true,
        mediaDurationSec: true,
      },
    }),
    db.conversationMember.findMany({
      where: { conversationId: conversationKey },
      select: { userId: true, lastReadAt: true, clearedAt: true },
    }),
  ]);

  await db.conversation.update({
    where: { id: conversationKey },
    data: buildConversationRollupFromMessage(latestMessage),
  });

  if (!memberships.length) return;

  const unreadMatrix = await Promise.all(memberships.map(async (membership) => ({
    membership,
    unreadCount: await db.chatMessage.count({
      where: {
        conversationId: conversationKey,
        deletedAt: null,
        senderId: { not: membership.userId },
        createdAt: { gt: membership.lastReadAt || membership.clearedAt || new Date(0) },
      },
    }),
  })));

  await db.$transaction(unreadMatrix.map(({ membership, unreadCount }) => db.conversationMember.update({
    where: {
      conversationId_userId: {
        conversationId: conversationKey,
        userId: membership.userId,
      },
    },
    data: { unreadCount },
  })));
}

export async function createOrOpenDirectConversation(viewerId, targetUserId, db = prisma) {
  if (!hasChatModels(db)) throw Object.assign(new Error('Чат-модуль ещё не доступен.'), { status: 503 });

  const viewer = Number(viewerId);
  const target = Number(targetUserId);
  if (!Number.isInteger(target) || target <= 0) {
    throw Object.assign(new Error('Некорректный пользователь для диалога.'), { status: 400 });
  }
  if (viewer === target) {
    throw Object.assign(new Error('Нельзя открыть диалог с самим собой.'), { status: 400 });
  }

  const key = directKeyFor(viewer, target);
  const existing = await db.conversation.findUnique({
    where: { directKey: key },
    include: {
      members: { include: { user: { include: { publicProfile: true } } } },
      messages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 },
      _count: {
        select: {
          messages: {
            where: {
              deletedAt: null,
              senderId: { not: viewer },
              createdAt: { gt: new Date(0) },
            },
          },
        },
      },
    },
  });
  if (existing) return serializeConversation(existing, viewer);

  try {
    const conversation = await db.conversation.create({
      data: {
        type: 'direct',
        directKey: key,
        members: {
          create: [
            { userId: viewer, role: 'member', lastReadAt: new Date() },
            { userId: target, role: 'member' },
          ],
        },
      },
      include: {
        members: { include: { user: { include: { publicProfile: true } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        messageRequest: true,
        _count: { select: { messages: true } },
      },
    });
    return serializeConversation(conversation, viewer);
  } catch (error) {
    if (error?.code === 'P2002') {
      const conflict = await db.conversation.findUnique({
        where: { directKey: key },
        include: {
          members: { include: { user: { include: { publicProfile: true } } } },
          messages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 },
          messageRequest: true,
          _count: { select: { messages: true } },
        },
      });
      if (conflict) return serializeConversation(conflict, viewer);
    }
    throw error;
  }
}

export async function ensureSeedChatsForUser(userId, db = prisma) {
  if (!hasChatModels(db)) return;

  const memberships = await db.conversationMember.count({ where: { userId } });
  if (memberships > 0) return;

  const others = await db.user.findMany({
    where: { id: { not: userId } },
    include: { publicProfile: true },
    orderBy: { createdAt: 'asc' },
    take: 3,
  });
  if (!others.length) return;

  for (const [index, other] of others.entries()) {
    const summary = await createOrOpenDirectConversation(userId, other.id, db);
    const conversation = await db.conversation.findUnique({ where: { id: summary.id } });
    if (!conversation) continue;
    const seedPair = CHAT_SEED_TEXTS[index] || CHAT_SEED_TEXTS[0];
    const count = await db.chatMessage.count({ where: { conversationId: conversation.id } });
    if (count > 0) continue;

    const now = Date.now() - (others.length - index) * 3600_000;
    await db.$transaction([
      db.chatMessage.create({
        data: {
          conversationId: conversation.id,
          senderId: other.id,
          clientId: `seed-${other.id}-1`,
          text: seedPair[0],
          status: 'read',
          createdAt: new Date(now),
          updatedAt: new Date(now),
        },
      }),
      db.chatMessage.create({
        data: {
          conversationId: conversation.id,
          senderId: userId,
          clientId: `seed-${userId}-2`,
          text: seedPair[1],
          status: 'read',
          createdAt: new Date(now + 120000),
          updatedAt: new Date(now + 120000),
        },
      }),
    ]);

    await db.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(now + 120000) },
    });

    await db.conversationMember.updateMany({
      where: { conversationId: conversation.id, userId },
      data: { lastReadAt: new Date(now + 120000) },
    });
  }
}

export async function listChatsForUser(userId, options = {}, db = prisma) {
  if (!hasChatModels(db)) return { items: [], count: 0, unreadCount: 0 };

  if (shouldSeedChatsInRuntime()) {
    await ensureSeedChatsForUser(userId, db);
  }

  const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100);
  const query = String(options.query || '').trim().toLowerCase();
  const scope = String(options.scope || 'active').trim().toLowerCase();
  const archivedFilter = scope === 'archived' ? { not: null } : null;

  const memberships = await db.conversationMember.findMany({
    where: { userId, archivedAt: archivedFilter },
    include: {
      conversation: {
        include: {
          members: {
            include: {
              user: { include: { publicProfile: true } },
            },
          },
          messages: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          messageRequest: true,
        },
      },
    },
    orderBy: [
      { pinned: 'desc' },
      { pinnedAt: 'desc' },
      { conversation: { lastMessageAt: 'desc' } },
      { conversation: { updatedAt: 'desc' } },
    ],
    take: limit,
  });

  const items = [];
  let unreadCount = 0;

  const directConversationIds = memberships
    .map((membership) => membership?.conversation)
    .filter((conversation) => conversation?.type === 'direct')
    .map((conversation) => conversation.id);
  const blockedConversationIds = hasMessengerPeerBlockModel(db) && directConversationIds.length
    ? new Set((await db.messengerPeerBlock.findMany({
        where: { blockerUserId: Number(userId), conversationId: { in: directConversationIds } },
        select: { conversationId: true },
      })).map((item) => item.conversationId))
    : new Set();

  for (const membership of memberships) {
    const conversation = membership.conversation;
    const request = conversation.messageRequest || null;
    if (request?.status === 'pending' && request.toUserId === userId) {
      continue;
    }

    const unread = await db.chatMessage.count({
      where: {
        conversationId: conversation.id,
        deletedAt: null,
        senderId: { not: userId },
        createdAt: { gt: membership.lastReadAt || membership.clearedAt || new Date(0) },
      },
    });

    const serialized = serializeConversation({
      ...conversation,
      peer_blocked: blockedConversationIds.has(conversation.id),
      _count: { messages: unread },
      members: conversation.members.map((member) => (
        member.userId === userId
          ? {
              ...member,
              pinned: membership.pinned,
              pinnedAt: membership.pinnedAt,
              muted: membership.muted,
              mutedUntil: membership.mutedUntil,
              archivedAt: membership.archivedAt,
              draftText: membership.draftText,
              draftUpdatedAt: membership.draftUpdatedAt,
            }
          : member
      )),
    }, userId);

    if (query) {
      const haystack = [serialized.name, serialized.status, serialized.preview, serialized.peer?.handle, serialized.request_state].join(' ').toLowerCase();
      if (!haystack.includes(query)) continue;
    }

    items.push(serialized);
    unreadCount += unread;
  }

  return { items, count: items.length, unreadCount, scope };
}

export async function getMessagesForConversation(userId, conversationId, options = {}, db = prisma) {
  if (!hasChatModels(db)) return { conversation: null, items: [], nextCursor: null, hasMore: false };

  const conversation = await getConversationForUser(userId, conversationId, db);
  if (!conversation) {
    throw Object.assign(new Error('Диалог не найден.'), { status: 404 });
  }

  const membership = await getConversationMember(userId, conversation.id, db);
  const limit = Math.min(Math.max(Number(options.limit) || 40, 1), 100);
  const cursor = String(options.cursor || '').trim();
  const clearedAt = membership?.clearedAt || new Date(0);
  const request = await getMessageRequestForConversation(conversation.id, db);
  const peerBlock = conversation.type === 'direct' && hasMessengerPeerBlockModel(db)
    ? await db.messengerPeerBlock.findFirst({
        where: { blockerUserId: Number(userId), conversationId: conversation.id },
        orderBy: { updatedAt: 'desc' },
      })
    : null;

  const messageInclude = {
    sender: true,
    replyToMessage: {
      include: { sender: true },
    },
  };
  if (hasSavedChatMessageModel(db)) {
    messageInclude.savedBy = {
      where: { userId },
      select: { id: true },
    };
  }
  if (hasChatMessageReportModel(db)) {
    messageInclude.reports = {
      where: { reporterUserId: userId },
      select: { id: true },
    };
  }

  const query = {
    where: {
      conversationId: conversation.id,
      deletedAt: null,
      createdAt: { gt: clearedAt },
    },
    include: messageInclude,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
  };

  if (cursor) {
    query.cursor = { id: cursor };
    query.skip = 1;
  }

  const rows = await db.chatMessage.findMany(query);
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const items = slice.reverse().map((message) => serializeMessage(message, userId));
  const oldest = slice[slice.length - 1] || null;

  return {
    conversation: {
      id: conversation.id,
      type: conversation.type,
      name: buildConversationName(conversation, userId),
      status: buildConversationStatus(conversation, userId),
      initials: buildConversationInitials(conversation, userId),
      tone: buildConversationTone(conversation, userId),
      peer: (() => {
        const peer = conversation.members.find((member) => member.userId !== userId)?.user;
        if (!peer) return null;
        return { id: peer.id, name: `${peer.firstName} ${peer.lastName}`.trim(), handle: peer.publicProfile?.handle ? `@${peer.publicProfile.handle}` : null };
      })(),
      draft_text: membership?.draftText || '',
      draft_updated_at: membership?.draftUpdatedAt || null,
      pinned: Boolean(membership?.pinned || membership?.pinnedAt),
      muted: Boolean(membership?.muted || (membership?.mutedUntil && new Date(membership.mutedUntil).getTime() > Date.now())),
      archived: Boolean(membership?.archivedAt),
      request_state: peerBlock ? 'blocked' : requestStateForViewer(request, userId),
      request_status: request?.status || null,
      request_from_user_id: request?.fromUserId || null,
      request_to_user_id: request?.toUserId || null,
    },
    items,
    nextCursor: hasMore && oldest ? oldest.id : null,
    hasMore,
  };
}

export async function sendMessageToConversation(userId, conversationId, payload, db = prisma) {
  if (!hasChatModels(db)) {
    throw Object.assign(new Error('Чат-модуль ещё не доступен.'), { status: 503 });
  }

  const conversation = await getConversationForUser(userId, conversationId, db);
  if (!conversation) {
    throw Object.assign(new Error('Диалог не найден.'), { status: 404 });
  }

  const normalized = normalizeMessageInput(payload);
  const { text, type, clientId, replyToMessageId, media, encryption, metadata } = normalized;

  if (replyToMessageId) {
    const replyTarget = await db.chatMessage.findFirst({
      where: { id: replyToMessageId, conversationId: conversation.id },
      select: { id: true },
    });
    if (!replyTarget) {
      throw Object.assign(new Error('Нельзя ответить на несуществующее сообщение.'), { status: 400 });
    }
  }

  if (clientId) {
    const existing = await db.chatMessage.findFirst({
      where: { conversationId: conversation.id, senderId: userId, clientId },
      include: {
        sender: true,
        replyToMessage: { include: { sender: true } },
      },
    });
    if (existing) return serializeMessage(existing, userId);
  }

  const peerId = conversation.type === 'direct'
    ? conversation.members.find((member) => member.userId !== userId)?.userId || null
    : null;
  const request = conversation.type === 'direct' ? await getMessageRequestForConversation(conversation.id, db) : null;
  let trust = { trusted: true, reason: 'group' };
  if (conversation.type === 'direct' && peerId) {
    trust = await getMessagingTrust(userId, peerId, db);
  }

  if (request?.status === 'blocked' && request.fromUserId === userId) {
    throw Object.assign(new Error('Пользователь ограничил входящие сообщения. Написать сейчас нельзя.'), { status: 403 });
  }
  if (request?.status === 'rejected' && request.fromUserId === userId) {
    throw Object.assign(new Error('Запрос на переписку был отклонён. Повторное сообщение сейчас недоступно.'), { status: 403 });
  }
  if (conversation.type === 'direct' && peerId && hasMessengerPeerBlockModel(db)) {
    const peerBlock = await db.messengerPeerBlock.findFirst({
      where: {
        blockerUserId: peerId,
        blockedUserId: Number(userId),
        conversationId: conversation.id,
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (peerBlock) {
      throw Object.assign(new Error('Пользователь ограничил входящие сообщения. Написать сейчас нельзя.'), { status: 403 });
    }
  }

  if (conversation.type === 'direct' && peerId && !request && trust.hardBlocked) {
    throw Object.assign(new Error('Пользователь принимает сообщения только от выбранного круга. Отправьте запрос позже или добавьтесь в друзья.'), { status: 403 });
  }

  if (request?.status === 'pending' && request.fromUserId === Number(userId)) {
    throw Object.assign(new Error('Запрос на переписку уже отправлен. Новые сообщения будут доступны после принятия.'), { status: 403 });
  }

  if (media?.mediaUrl) {
    await assertMediaReferencesBelongToScope({
      db,
      media: [{ url: media.mediaUrl, thumbUrl: media.mediaThumbUrl }],
      ownerUserId: Number(userId),
      allowedSurfaces: ['chat'],
      allowedScopeIds: [conversation.id, userId],
      label: 'медиа сообщения',
    });
  }

  await enforceMessageAntiSpam(Number(userId), conversation, { type, text, media, clientId, replyToMessageId }, db);

  let message;
  try {
    message = await db.chatMessage.create({
      data: {
        conversationId: conversation.id,
        senderId: userId,
        text: text || '',
        type,
        clientId,
        status: 'sent',
        serverAckAt: new Date(),
        replyToMessageId,
        metadata,
        mediaKind: media?.mediaKind || null,
        mediaUrl: media?.mediaUrl || null,
        mediaThumbUrl: media?.mediaThumbUrl || null,
        mediaMime: media?.mediaMime || null,
        mediaBytes: media?.mediaBytes || null,
        mediaDurationSec: media?.mediaDurationSec || null,
        mediaWidth: media?.mediaWidth || null,
        mediaHeight: media?.mediaHeight || null,
        mediaWaveform: media?.mediaWaveform || null,
        isEncrypted: Boolean(encryption),
        encryptionScheme: encryption?.encryptionScheme || null,
        senderDeviceId: encryption?.senderDeviceId || null,
        recipientDeviceId: encryption?.recipientDeviceId || null,
        ciphertext: encryption?.ciphertext || null,
        cipherHeader: encryption?.cipherHeader || null,
        cipherAAD: encryption?.cipherAAD || null,
        contentHint: encryption?.contentHint || null,
        keyEnvelope: encryption?.keyEnvelope || null,
      },
      include: {
        sender: true,
        replyToMessage: { include: { sender: true } },
      },
    });
  } catch (error) {
    if (error?.code === 'P2002' && clientId) {
      const existing = await db.chatMessage.findFirst({
        where: { conversationId: conversation.id, senderId: userId, clientId },
        include: {
          sender: true,
          replyToMessage: { include: { sender: true } },
        },
      });
      if (existing) return serializeMessage(existing, userId);
    }
    throw error;
  }

  const now = message.createdAt;
  await db.conversationMember.updateMany({
    where: { conversationId: conversation.id, userId },
    data: { lastReadAt: now, lastDeliveredAt: now, draftText: null, draftUpdatedAt: null, unreadCount: 0 },
  });

  let requestState = request;
  let createdMessageRequest = false;
  if (conversation.type === 'direct' && peerId && hasMessageRequestModel(db)) {
    if (!request && trust.requiresRequest) {
      requestState = await db.messageRequest.create({
        data: {
          conversationId: conversation.id,
          fromUserId: userId,
          toUserId: peerId,
          status: 'pending',
          previewText: buildMessageTextPreview(message).slice(0, 280),
        },
      });
      createdMessageRequest = true;
      await createNotification({
        userId: peerId,
        actorUserId: userId,
        type: 'message_request',
        title: 'Запрос на переписку',
        body: buildMessageTextPreview(message).slice(0, 180),
        targetLabel: buildConversationName(conversation, userId),
        entityType: 'conversation',
        entityId: conversation.id,
        payload: { conversationId: conversation.id, requestId: requestState.id },
      }, db);
    } else if (request?.status === 'pending' && request.toUserId === userId) {
      requestState = await db.messageRequest.update({
        where: { id: request.id },
        data: { status: 'accepted', respondedAt: new Date(), previewText: buildMessageTextPreview(message).slice(0, 280) },
      });
      await createNotification({
        userId: request.fromUserId,
        actorUserId: userId,
        type: 'message_request_accepted',
        title: 'Запрос принят',
        body: 'Теперь вы можете переписываться без ограничений.',
        targetLabel: buildConversationName(conversation, userId),
        entityType: 'conversation',
        entityId: conversation.id,
      }, db);
    } else if (request?.status === 'pending' && request.fromUserId === userId) {
      requestState = await db.messageRequest.update({
        where: { id: request.id },
        data: { previewText: buildMessageTextPreview(message).slice(0, 280) },
      });
    } else if (request) {
      requestState = await db.messageRequest.update({
        where: { id: request.id },
        data: { previewText: buildMessageTextPreview(message).slice(0, 280) },
      });
    }
  }

  const recipientIds = await listRecipientIds(conversation.id, userId, db);
  const conversationName = buildConversationName(conversation, userId);
  const shouldCreateStandardNotification = !createdMessageRequest && !(request?.status === 'pending' && request?.fromUserId === userId);
  if (shouldCreateStandardNotification) {
    for (const recipientId of recipientIds) {
      await createNotification({
        userId: recipientId,
        actorUserId: userId,
        type: 'message',
        title: 'Новое сообщение',
        body: buildMessageTextPreview(message).slice(0, 180),
        targetLabel: conversationName,
        entityType: 'conversation',
        entityId: conversation.id,
        payload: { messageId: message.id },
      }, db);
    }
  }

  await refreshConversationState(conversation.id, db);

  const serialized = serializeMessage(message, userId);
  emitUsersEvent([userId, ...recipientIds], 'message.created', {
    conversationId: conversation.id,
    message: serialized,
    senderId: userId,
  });
  if (requestState) {
    emitUsersEvent([userId, ...recipientIds], 'message_request.updated', {
      conversationId: conversation.id,
      request: {
        id: requestState.id,
        status: requestState.status,
        fromUserId: requestState.fromUserId,
        toUserId: requestState.toUserId,
        previewText: requestState.previewText || null,
        updatedAt: requestState.updatedAt,
      },
    });
  }
  await publishConversationUpdated(conversation.id, db);
  await emitUnreadSummary([userId, ...recipientIds], db);
  return serialized;
}

export async function editMessage(userId, messageId, nextText, db = prisma) {
  if (!hasChatModels(db)) throw Object.assign(new Error('Чат-модуль ещё не доступен.'), { status: 503 });

  const message = await db.chatMessage.findUnique({
    where: { id: String(messageId) },
    include: {
      sender: true,
      replyToMessage: { include: { sender: true } },
      conversation: { include: { members: true } },
    },
  });
  if (!message || !message.conversation.members.some((member) => member.userId === userId)) {
    throw Object.assign(new Error('Сообщение не найдено.'), { status: 404 });
  }
  if (message.senderId !== userId) {
    throw Object.assign(new Error('Можно редактировать только свои сообщения.'), { status: 403 });
  }
  if (message.deletedAt) {
    throw Object.assign(new Error('Нельзя редактировать удалённое сообщение.'), { status: 400 });
  }
  if (!EDITABLE_MESSAGE_TYPES.has(message.type) || message.isEncrypted || message.mediaUrl) {
    throw Object.assign(new Error('Сейчас можно редактировать только обычные текстовые сообщения.'), { status: 400 });
  }

  const text = String(nextText || '').trim();
  if (!text) {
    throw Object.assign(new Error('Введите текст сообщения.'), { status: 400 });
  }

  const updated = await db.chatMessage.update({
    where: { id: message.id },
    data: {
      text: text.slice(0, 5000),
      editedAt: new Date(),
      messageVersion: { increment: 1 },
      metadata: { ...(safeObject(message.metadata)), edited: true },
    },
    include: {
      sender: true,
      replyToMessage: { include: { sender: true } },
    },
  });

  await refreshConversationState(message.conversationId, db);

  const serialized = serializeMessage(updated, userId);
  emitUsersEvent(message.conversation.members.map((member) => member.userId), 'message.updated', {
    conversationId: message.conversationId,
    message: serialized,
  });
  await publishConversationUpdated(message.conversationId, db);
  return serialized;
}

export async function deleteMessage(userId, messageId, db = prisma) {
  if (!hasChatModels(db)) throw Object.assign(new Error('Чат-модуль ещё не доступен.'), { status: 503 });

  const message = await db.chatMessage.findUnique({
    where: { id: String(messageId) },
    include: {
      sender: true,
      replyToMessage: { include: { sender: true } },
      conversation: { include: { members: true } },
    },
  });
  if (!message || !message.conversation.members.some((member) => member.userId === userId)) {
    throw Object.assign(new Error('Сообщение не найдено.'), { status: 404 });
  }
  if (message.senderId !== userId) {
    throw Object.assign(new Error('Можно удалять только свои сообщения.'), { status: 403 });
  }
  if (message.deletedAt) {
    return serializeMessage(message, userId);
  }

  const updated = await db.chatMessage.update({
    where: { id: message.id },
    data: {
      deletedAt: new Date(),
      deletedForAllAt: new Date(),
      text: '',
      metadata: { ...(safeObject(message.metadata)), deletedForAll: true },
    },
    include: {
      sender: true,
      replyToMessage: { include: { sender: true } },
    },
  });

  await refreshConversationState(message.conversationId, db);

  const serialized = serializeMessage(updated, userId);
  emitUsersEvent(message.conversation.members.map((member) => member.userId), 'message.deleted', {
    conversationId: message.conversationId,
    message: serialized,
  });
  await publishConversationUpdated(message.conversationId, db);
  return serialized;
}


export async function toggleMessageReaction(userId, messageId, emoji = '❤️', db = prisma) {
  if (!hasChatModels(db)) throw Object.assign(new Error('Чат-модуль ещё не доступен.'), { status: 503 });

  const message = await db.chatMessage.findUnique({
    where: { id: String(messageId) },
    include: {
      sender: true,
      replyToMessage: { include: { sender: true } },
      savedBy: { where: { userId: Number(userId) }, select: { id: true } },
      reports: hasChatMessageReportInclude(db) ? { where: { reporterUserId: Number(userId) }, select: { id: true } } : undefined,
      pinnedEntries: hasPinnedChatMessageInclude(db) ? { select: { id: true } } : undefined,
      conversation: { include: { members: true } },
    },
  });

  if (!message || !message.conversation.members.some((member) => member.userId === Number(userId))) {
    throw Object.assign(new Error('Сообщение не найдено.'), { status: 404 });
  }
  if (message.deletedAt) {
    throw Object.assign(new Error('Нельзя реагировать на удалённое сообщение.'), { status: 400 });
  }
  if (String(message.status || '').toLowerCase() === 'sending') {
    throw Object.assign(new Error('Подождите, пока сообщение отправится.'), { status: 409 });
  }

  const normalizedEmoji = normalizeReactionEmoji(emoji);
  const reactions = readMessageReactions(message.metadata);
  const entryIndex = reactions.findIndex((entry) => entry.emoji === normalizedEmoji);

  if (entryIndex >= 0) {
    const current = reactions[entryIndex];
    if (current.userIds.includes(Number(userId))) {
      const nextUserIds = current.userIds.filter((value) => value !== Number(userId));
      if (nextUserIds.length) reactions[entryIndex] = { ...current, userIds: nextUserIds };
      else reactions.splice(entryIndex, 1);
    } else {
      reactions[entryIndex] = { ...current, userIds: [...current.userIds, Number(userId)] };
    }
  } else {
    reactions.push({ emoji: normalizedEmoji, userIds: [Number(userId)] });
  }

  const updated = await db.chatMessage.update({
    where: { id: message.id },
    data: {
      metadata: writeMessageReactions(message.metadata, reactions),
      messageVersion: { increment: 1 },
    },
    include: {
      sender: true,
      replyToMessage: { include: { sender: true } },
      savedBy: { where: { userId: Number(userId) }, select: { id: true } },
      reports: hasChatMessageReportInclude(db) ? { where: { reporterUserId: Number(userId) }, select: { id: true } } : undefined,
      pinnedEntries: hasPinnedChatMessageInclude(db) ? { select: { id: true } } : undefined,
    },
  });

  const serialized = serializeMessage(updated, Number(userId));
  emitUsersEvent(message.conversation.members.map((member) => member.userId), 'message.updated', {
    conversationId: message.conversationId,
    message: serialized,
  });
  await publishConversationUpdated(message.conversationId, db);
  return serialized;
}

export async function saveMessageForUser(userId, messageId, shouldSave = true, db = prisma) {
  if (!hasSavedChatMessageModel(db)) {
    throw Object.assign(new Error('Сохранение сообщений ещё не применено к базе данных.'), { status: 503 });
  }

  const message = await db.chatMessage.findFirst({
    where: {
      id: String(messageId),
      conversation: { members: { some: { userId: Number(userId) } } },
    },
    include: {
      sender: true,
      replyToMessage: { include: { sender: true } },
      savedBy: { where: { userId: Number(userId) }, select: { id: true } },
      reports: hasChatMessageReportInclude(db) ? { where: { reporterUserId: Number(userId) }, select: { id: true } } : undefined,
      pinnedEntries: hasPinnedChatMessageInclude(db) ? { select: { id: true } } : undefined,
    },
  });

  if (!message) {
    throw Object.assign(new Error('Сообщение не найдено.'), { status: 404 });
  }

  if (message.deletedAt) {
    throw Object.assign(new Error('Удалённое сообщение нельзя сохранить.'), { status: 400 });
  }

  if (shouldSave) {
    await db.savedChatMessage.upsert({
      where: { userId_messageId: { userId: Number(userId), messageId: String(messageId) } },
      update: {},
      create: { userId: Number(userId), messageId: String(messageId) },
    });
  } else {
    await db.savedChatMessage.deleteMany({
      where: { userId: Number(userId), messageId: String(messageId) },
    });
  }

  const refreshed = await db.chatMessage.findUnique({
    where: { id: String(messageId) },
    include: {
      sender: true,
      replyToMessage: { include: { sender: true } },
      savedBy: { where: { userId: Number(userId) }, select: { id: true } },
      reports: hasChatMessageReportInclude(db) ? { where: { reporterUserId: Number(userId) }, select: { id: true } } : undefined,
      pinnedEntries: hasPinnedChatMessageInclude(db) ? { select: { id: true } } : undefined,
    },
  });

  return serializeMessage(refreshed || message, Number(userId));
}

export async function saveMessagesForUser(userId, messageIds = [], shouldSave = true, db = prisma) {
  const normalizedIds = Array.from(new Set((Array.isArray(messageIds) ? messageIds : [messageIds])
    .map((value) => String(value || '').trim())
    .filter(Boolean))).slice(0, 20);

  if (!normalizedIds.length) {
    return { updatedCount: 0, messages: [], failed: [] };
  }

  const messages = [];
  const failed = [];

  for (const messageId of normalizedIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const message = await saveMessageForUser(Number(userId), messageId, shouldSave, db);
      if (message) messages.push(message);
    } catch (error) {
      failed.push({ id: messageId, error: error?.message || String(error) });
    }
  }

  return {
    updatedCount: messages.length,
    messages,
    failed,
  };
}

export async function deleteMessagesBatch(userId, messageIds = [], db = prisma) {
  const normalizedIds = Array.from(new Set((Array.isArray(messageIds) ? messageIds : [messageIds])
    .map((value) => String(value || '').trim())
    .filter(Boolean))).slice(0, 20);

  if (!normalizedIds.length) {
    return { deletedCount: 0, messages: [], failed: [] };
  }

  const messages = [];
  const failed = [];

  for (const messageId of normalizedIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const message = await deleteMessage(Number(userId), messageId, db);
      if (message) messages.push(message);
    } catch (error) {
      failed.push({ id: messageId, error: error?.message || String(error) });
    }
  }

  return {
    deletedCount: messages.length,
    messages,
    failed,
  };
}

export async function reportMessage(userId, messageId, input = {}, db = prisma) {
  if (!hasChatMessageReportModel(db)) {
    throw Object.assign(new Error('Жалобы на сообщения ещё не применены к базе данных.'), { status: 503 });
  }

  const message = await db.chatMessage.findFirst({
    where: {
      id: String(messageId),
      conversation: { members: { some: { userId: Number(userId) } } },
    },
    include: {
      sender: true,
      conversation: { include: { members: { include: { user: true } } } },
      replyToMessage: { include: { sender: true } },
      savedBy: hasSavedChatMessageModel(db) ? { where: { userId: Number(userId) }, select: { id: true } } : undefined,
      reports: hasChatMessageReportInclude(db) ? { where: { reporterUserId: Number(userId) }, select: { id: true } } : undefined,
      pinnedEntries: hasPinnedChatMessageInclude(db) ? { select: { id: true } } : undefined,
    },
  });

  if (!message) {
    throw Object.assign(new Error('Сообщение не найдено.'), { status: 404 });
  }

  if (message.senderId === Number(userId)) {
    throw Object.assign(new Error('Нельзя пожаловаться на собственное сообщение.'), { status: 400 });
  }

  if (message.deletedAt) {
    throw Object.assign(new Error('Удалённое сообщение нельзя пожаловаться.'), { status: 400 });
  }

  const reason = String(input?.reason || '').trim().slice(0, 60);
  const details = String(input?.details || '').trim().slice(0, 1000);

  if (!reason) {
    throw Object.assign(new Error('Укажи причину жалобы.'), { status: 400 });
  }

  const report = await db.chatMessageReport.upsert({
    where: { messageId_reporterUserId: { messageId: String(messageId), reporterUserId: Number(userId) } },
    update: { reason, details: details || null, status: 'new' },
    create: {
      messageId: String(messageId),
      reporterUserId: Number(userId),
      reason,
      details: details || null,
      status: 'new',
    },
  });

  const shouldBlockFutureMessages = Boolean(input?.blockFutureMessages || input?.block_future_messages);
  const blockResult = shouldBlockFutureMessages
    ? await upsertPeerSafetyBlock(Number(userId), message, { reason: reason || 'safety_report', details }, db)
    : { blocked: false, record: null };
  const safetyReview = await evaluateReportedMessageSafety(message, report, db);

  const refreshed = await db.chatMessage.findUnique({
    where: { id: String(messageId) },
    include: {
      sender: true,
      conversation: { include: { members: { include: { user: true } } } },
      replyToMessage: { include: { sender: true } },
      savedBy: hasSavedChatMessageModel(db) ? { where: { userId: Number(userId) }, select: { id: true } } : undefined,
      reports: hasChatMessageReportInclude(db) ? { where: { reporterUserId: Number(userId) }, select: { id: true } } : undefined,
      pinnedEntries: hasPinnedChatMessageInclude(db) ? { select: { id: true } } : undefined,
    },
  });

  return {
    report: serializeChatMessageReport(report),
    message: serializeMessage(refreshed || message, Number(userId)),
    blocked_peer: Boolean(blockResult?.blocked),
    safety_flagged: Boolean(safetyReview?.flag),
  };
}


export async function setMessagePinned(userId, messageId, shouldPin = true, db = prisma) {
  if (!hasPinnedChatMessageModel(db)) {
    throw Object.assign(new Error('Закрепы сообщений ещё не применены к базе данных.'), { status: 503 });
  }

  const message = await db.chatMessage.findFirst({
    where: {
      id: String(messageId),
      deletedAt: null,
      conversation: { members: { some: { userId: Number(userId) } } },
    },
    include: {
      conversation: { select: { id: true } },
      sender: true,
      replyToMessage: { include: { sender: true } },
      savedBy: hasSavedChatMessageModel(db) ? { where: { userId: Number(userId) }, select: { id: true } } : undefined,
      reports: hasChatMessageReportInclude(db) ? { where: { reporterUserId: Number(userId) }, select: { id: true } } : undefined,
      pinnedEntries: hasPinnedChatMessageInclude(db) ? { select: { id: true } } : undefined,
    },
  });

  if (!message) {
    throw Object.assign(new Error('Сообщение не найдено.'), { status: 404 });
  }

  if (message.type === 'system') {
    throw Object.assign(new Error('Системное сообщение нельзя закрепить.'), { status: 400 });
  }

  if (shouldPin) {
    await db.pinnedChatMessage.upsert({
      where: { conversationId_messageId: { conversationId: String(message.conversationId), messageId: String(messageId) } },
      update: { pinnedByUserId: Number(userId) },
      create: {
        conversationId: String(message.conversationId),
        messageId: String(messageId),
        pinnedByUserId: Number(userId),
      },
    });
  } else {
    await db.pinnedChatMessage.deleteMany({
      where: { conversationId: String(message.conversationId), messageId: String(messageId) },
    });
  }

  const refreshed = await db.chatMessage.findUnique({
    where: { id: String(messageId) },
    include: {
      sender: true,
      replyToMessage: { include: { sender: true } },
      savedBy: hasSavedChatMessageModel(db) ? { where: { userId: Number(userId) }, select: { id: true } } : undefined,
      reports: hasChatMessageReportInclude(db) ? { where: { reporterUserId: Number(userId) }, select: { id: true } } : undefined,
      pinnedEntries: hasPinnedChatMessageInclude(db) ? { select: { id: true } } : undefined,
    },
  });

  const serialized = serializeMessage(refreshed || message, Number(userId));
  const recipients = await db.conversationMember.findMany({
    where: { conversationId: String(message.conversationId) },
    select: { userId: true },
  });
  emitUsersEvent(recipients.map((item) => item.userId), 'message.updated', {
    conversationId: String(message.conversationId),
    message: serialized,
  });
  await publishConversationUpdated(message.conversationId, db);
  return serialized;
}

export async function listPinnedMessages(userId, conversationId, db = prisma) {
  if (!hasPinnedChatMessageModel(db)) {
    return { conversationId: String(conversationId), items: [], count: 0 };
  }

  const conversation = await getConversationForUser(userId, conversationId, db);
  if (!conversation) {
    throw Object.assign(new Error('Диалог не найден.'), { status: 404 });
  }

  const rows = await db.pinnedChatMessage.findMany({
    where: { conversationId: conversation.id, message: { deletedAt: null } },
    include: {
      message: {
        include: {
          sender: true,
          replyToMessage: { include: { sender: true } },
          savedBy: hasSavedChatMessageModel(db) ? { where: { userId: Number(userId) }, select: { id: true } } : undefined,
          reports: hasChatMessageReportInclude(db) ? { where: { reporterUserId: Number(userId) }, select: { id: true } } : undefined,
          pinnedEntries: hasPinnedChatMessageInclude(db) ? { select: { id: true } } : undefined,
        },
      },
      pinnedByUser: true,
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 20,
  });

  const items = rows
    .filter((row) => row.message)
    .map((row) => ({
      id: row.id,
      created_at: row.createdAt,
      pinned_by: {
        id: row.pinnedByUser.id,
        name: `${row.pinnedByUser.firstName || ''} ${row.pinnedByUser.lastName || ''}`.trim() || 'Пользователь',
      },
      message: serializeMessage(row.message, Number(userId)),
    }));

  return {
    conversationId: conversation.id,
    items,
    count: items.length,
  };
}

export async function searchConversationMessages(userId, conversationId, options = {}, db = prisma) {
  if (!hasChatModels(db)) return { conversationId: String(conversationId), query: '', items: [], total: 0, hasMore: false, nextCursor: null };

  const conversation = await getConversationForUser(userId, conversationId, db);
  if (!conversation) {
    throw Object.assign(new Error('Диалог не найден.'), { status: 404 });
  }

  const membership = await getConversationMember(userId, conversation.id, db);
  const query = toBoundedString(options.query || options.q || '', 160);
  const type = toBoundedString(options.type || '', 24).toLowerCase();
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);
  const cursor = String(options.cursor || '').trim();
  const clearedAt = membership?.clearedAt || new Date(0);

  if (query.length < 2 && !type) {
    return { conversationId: conversation.id, query, type, items: [], total: 0, hasMore: false, nextCursor: null };
  }

  const where = buildConversationSearchWhere(conversation.id, clearedAt, query, type);
  const include = buildSearchMessageInclude(userId, db);
  const searchQuery = {
    where,
    include,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  };
  if (cursor) {
    searchQuery.cursor = { id: cursor };
    searchQuery.skip = 1;
  }

  const [rows, total] = await Promise.all([
    db.chatMessage.findMany(searchQuery),
    db.chatMessage.count({ where }),
  ]);

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && slice.length ? slice[slice.length - 1].id : null;
  const items = slice.map((message) => {
    const serialized = serializeMessage(message, Number(userId));
    return {
      message_id: serialized.id,
      conversation_id: conversation.id,
      created_at: serialized.created_at,
      time: serialized.time,
      type: serialized.type,
      sender: serialized.sender,
      is_mine: serialized.is_mine,
      preview_text: serialized.preview_text,
      snippet: buildMessageSearchSnippet(serialized.text || serialized.preview_text || '', query),
      message: serialized,
    };
  });

  return {
    conversationId: conversation.id,
    query,
    type,
    items,
    total,
    hasMore,
    nextCursor,
  };
}

export async function searchAllMessages(userId, options = {}, db = prisma) {
  if (!hasChatModels(db)) return { query: '', type: '', items: [], total: 0, hasMore: false, nextCursor: null };

  const query = toBoundedString(options.query || options.q || '', 160);
  const type = toBoundedString(options.type || '', 24).toLowerCase();
  const limit = Math.min(Math.max(Number(options.limit) || 12, 1), 30);
  const cursor = String(options.cursor || '').trim();

  if (query.length < 2 && !type) {
    return { query, type, items: [], total: 0, hasMore: false, nextCursor: null };
  }

  const where = {
    deletedAt: null,
    conversation: {
      members: {
        some: { userId: Number(userId) },
      },
    },
  };

  if (type === 'image') where.type = 'image';
  else if (type === 'video') where.type = { in: ['video', 'video_note'] };
  else if (type === 'file') where.type = 'file';
  else if (type === 'voice') where.type = 'voice';

  const andClauses = [];
  if (query) {
    andClauses.push({ text: { contains: query, mode: 'insensitive' } });
  }
  if (type === 'link') {
    andClauses.push({
      OR: [
        { text: { contains: 'http', mode: 'insensitive' } },
        { text: { contains: 'www.', mode: 'insensitive' } },
      ],
    });
  }
  if (andClauses.length) {
    where.AND = andClauses;
  }

  const include = {
    ...buildSearchMessageInclude(userId, db),
    conversation: {
      include: {
        members: {
          include: {
            user: { include: { publicProfile: true } },
          },
        },
      },
    },
  };

  const searchQuery = {
    where,
    include,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  };
  if (cursor) {
    searchQuery.cursor = { id: cursor };
    searchQuery.skip = 1;
  }

  const [rows, total] = await Promise.all([
    db.chatMessage.findMany(searchQuery),
    db.chatMessage.count({ where }),
  ]);

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && slice.length ? slice[slice.length - 1].id : null;
  const items = slice.map((message) => {
    const serialized = serializeMessage(message, Number(userId));
    const membership = Array.isArray(message.conversation?.members)
      ? message.conversation.members.find((member) => member.userId === Number(userId))
      : null;
    return {
      message_id: serialized.id,
      conversation_id: message.conversationId,
      created_at: serialized.created_at,
      time: serialized.time,
      type: serialized.type,
      sender: serialized.sender,
      is_mine: serialized.is_mine,
      preview_text: serialized.preview_text,
      snippet: buildMessageSearchSnippet(serialized.text || serialized.preview_text || '', query),
      conversation: {
        id: message.conversation.id,
        type: message.conversation.type,
        name: buildConversationName(message.conversation, Number(userId)),
        initials: buildConversationInitials(message.conversation, Number(userId)),
        tone: buildConversationTone(message.conversation, Number(userId)),
        status: buildConversationStatus(message.conversation, Number(userId)),
        archived: Boolean(membership?.archivedAt),
      },
      message: serialized,
    };
  });

  return {
    query,
    type,
    items,
    total,
    hasMore,
    nextCursor,
  };
}

export async function removeSavedMessagesForUser(userId, messageIds = [], db = prisma) {
  if (!hasSavedChatMessageModel(db)) {
    throw Object.assign(new Error('Сохранение сообщений ещё не применено к базе данных.'), { status: 503 });
  }

  const normalizedIds = Array.from(new Set((Array.isArray(messageIds) ? messageIds : [messageIds])
    .map((value) => String(value || '').trim())
    .filter(Boolean)));

  if (!normalizedIds.length) {
    return { removedCount: 0, messageIds: [] };
  }

  const allowedMessages = await db.chatMessage.findMany({
    where: {
      id: { in: normalizedIds },
      conversation: { members: { some: { userId: Number(userId) } } },
    },
    select: { id: true },
  });

  const allowedIds = allowedMessages.map((item) => String(item.id));
  if (!allowedIds.length) {
    return { removedCount: 0, messageIds: [] };
  }

  const result = await db.savedChatMessage.deleteMany({
    where: {
      userId: Number(userId),
      messageId: { in: allowedIds },
    },
  });

  return {
    removedCount: Number(result?.count) || 0,
    messageIds: allowedIds,
  };
}


export async function listSavedMessages(userId, options = {}, db = prisma) {
  if (!hasChatModels(db) || !hasSavedChatMessageModel(db)) {
    return { query: '', type: '', items: [], total: 0, hasMore: false, nextCursor: null };
  }

  const query = toBoundedString(options.query || options.q || '', 160);
  const type = toBoundedString(options.type || '', 24).toLowerCase();
  const limit = Math.min(Math.max(Number(options.limit) || 24, 1), 60);
  const cursor = String(options.cursor || '').trim();

  const messageWhere = {
    deletedAt: null,
    conversation: {
      members: {
        some: { userId: Number(userId) },
      },
    },
  };

  if (type === 'image') messageWhere.type = 'image';
  else if (type === 'video') messageWhere.type = { in: ['video', 'video_note'] };
  else if (type === 'file') messageWhere.type = 'file';
  else if (type === 'voice') messageWhere.type = 'voice';

  const andClauses = [];
  if (query) {
    andClauses.push({
      OR: [
        { text: { contains: query, mode: 'insensitive' } },
        { conversation: { title: { contains: query, mode: 'insensitive' } } },
        {
          conversation: {
            members: {
              some: {
                user: {
                  OR: [
                    { firstName: { contains: query, mode: 'insensitive' } },
                    { lastName: { contains: query, mode: 'insensitive' } },
                  ],
                },
              },
            },
          },
        },
      ],
    });
  }
  if (type === 'link') {
    andClauses.push({
      OR: [
        { text: { contains: 'http', mode: 'insensitive' } },
        { text: { contains: 'www.', mode: 'insensitive' } },
      ],
    });
  }
  if (andClauses.length) {
    messageWhere.AND = andClauses;
  }

  const where = {
    userId: Number(userId),
    message: messageWhere,
  };

  const queryConfig = {
    where,
    include: {
      message: {
        include: {
          ...buildSearchMessageInclude(userId, db),
          conversation: {
            include: {
              members: {
                include: {
                  user: { include: { publicProfile: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  };

  if (cursor) {
    queryConfig.cursor = { id: cursor };
    queryConfig.skip = 1;
  }

  const [rows, total] = await Promise.all([
    db.savedChatMessage.findMany(queryConfig),
    db.savedChatMessage.count({ where }),
  ]);

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && slice.length ? slice[slice.length - 1].id : null;
  const items = slice.map((row) => {
    const message = row.message;
    const serialized = serializeMessage(message, Number(userId));
    const membership = Array.isArray(message.conversation?.members)
      ? message.conversation.members.find((member) => member.userId === Number(userId))
      : null;
    return {
      saved_id: row.id,
      saved_at: row.createdAt,
      saved_time: formatTime(row.createdAt),
      message_id: serialized.id,
      conversation_id: message.conversationId,
      created_at: serialized.created_at,
      time: serialized.time,
      type: serialized.type,
      sender: serialized.sender,
      is_mine: serialized.is_mine,
      preview_text: serialized.preview_text,
      snippet: buildMessageSearchSnippet(serialized.text || serialized.preview_text || '', query),
      conversation: {
        id: message.conversation.id,
        type: message.conversation.type,
        name: buildConversationName(message.conversation, Number(userId)),
        initials: buildConversationInitials(message.conversation, Number(userId)),
        tone: buildConversationTone(message.conversation, Number(userId)),
        status: buildConversationStatus(message.conversation, Number(userId)),
        archived: Boolean(membership?.archivedAt),
      },
      message: serialized,
    };
  });

  return {
    query,
    type,
    items,
    total,
    hasMore,
    nextCursor,
  };
}

export async function getMessageContext(userId, messageId, options = {}, db = prisma) {
  if (!hasChatModels(db)) return { conversationId: null, targetMessageId: String(messageId), items: [] };

  const target = await db.chatMessage.findFirst({
    where: {
      id: String(messageId),
      deletedAt: null,
      conversation: { members: { some: { userId: Number(userId) } } },
    },
    include: buildSearchMessageInclude(userId, db),
  });

  if (!target) {
    throw Object.assign(new Error('Сообщение не найдено.'), { status: 404 });
  }

  const membership = await getConversationMember(userId, target.conversationId, db);
  const clearedAt = membership?.clearedAt || new Date(0);
  const beforeLimit = Math.min(Math.max(Number(options.before) || 12, 1), 40);
  const afterLimit = Math.min(Math.max(Number(options.after) || 12, 1), 40);
  const include = buildSearchMessageInclude(userId, db);

  const [beforeRows, afterRows] = await Promise.all([
    db.chatMessage.findMany({
      where: {
        conversationId: target.conversationId,
        deletedAt: null,
        createdAt: { gt: clearedAt, lt: target.createdAt },
      },
      include,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: beforeLimit,
    }),
    db.chatMessage.findMany({
      where: {
        conversationId: target.conversationId,
        deletedAt: null,
        createdAt: { gt: target.createdAt },
      },
      include,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: afterLimit,
    }),
  ]);

  const items = [...beforeRows.reverse(), target, ...afterRows].map((message) => serializeMessage(message, Number(userId)));

  return {
    conversationId: target.conversationId,
    targetMessageId: target.id,
    items,
  };
}


export async function forwardMessages(userId, input = {}, db = prisma) {
  if (!hasChatModels(db)) {
    return { forwarded_count: 0, target_count: 0, deliveries: [] };
  }

  const rawMessageIds = Array.isArray(input.messageIds) ? input.messageIds : Array.isArray(input.message_ids) ? input.message_ids : [];
  const rawConversationIds = Array.isArray(input.conversationIds) ? input.conversationIds : Array.isArray(input.conversation_ids) ? input.conversation_ids : [];
  const comment = toBoundedString(input.comment || '', 1000);
  const messageIds = [...new Set(rawMessageIds.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 10);
  const conversationIds = [...new Set(rawConversationIds.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 12);

  if (!messageIds.length) {
    throw Object.assign(new Error('Выбери хотя бы одно сообщение для пересылки.'), { status: 400 });
  }
  if (!conversationIds.length) {
    throw Object.assign(new Error('Выбери хотя бы один чат для пересылки.'), { status: 400 });
  }

  const sourceMessages = await db.chatMessage.findMany({
    where: {
      id: { in: messageIds },
      deletedAt: null,
      conversation: { members: { some: { userId: Number(userId) } } },
    },
    include: {
      sender: true,
      replyToMessage: { include: { sender: true } },
    },
  });
  const sourceById = new Map(sourceMessages.map((item) => [item.id, item]));
  const orderedSources = messageIds.map((id) => sourceById.get(id)).filter(Boolean);

  if (orderedSources.length !== messageIds.length) {
    throw Object.assign(new Error('Часть выбранных сообщений недоступна для пересылки.'), { status: 404 });
  }
  if (orderedSources.some((item) => item.isEncrypted)) {
    throw Object.assign(new Error('Зашифрованные сообщения пока нельзя пересылать.'), { status: 400 });
  }
  if (orderedSources.some((item) => item.deletedAt)) {
    throw Object.assign(new Error('Удалённые сообщения нельзя пересылать.'), { status: 400 });
  }

  const targetConversations = await db.conversation.findMany({
    where: {
      id: { in: conversationIds },
      members: { some: { userId: Number(userId) } },
    },
    select: { id: true },
  });
  if (targetConversations.length !== conversationIds.length) {
    throw Object.assign(new Error('Часть выбранных чатов недоступна для пересылки.'), { status: 404 });
  }

  const deliveries = [];
  for (const conversationId of conversationIds) {
    const created = [];
    if (comment) {
      const note = await sendMessageToConversation(userId, conversationId, { text: comment }, db);
      created.push(note);
    }

    for (const source of orderedSources) {
      const originalForwarded = safeObject(source.metadata?.forwarded);
      const senderName = `${source.sender?.firstName || ''} ${source.sender?.lastName || ''}`.trim() || 'Пользователь';
      const forwardedMeta = {
        message_id: toBoundedString(originalForwarded.message_id || originalForwarded.messageId || source.id, 191),
        conversation_id: toBoundedString(originalForwarded.conversation_id || originalForwarded.conversationId || source.conversationId, 191),
        sender_id: toPositiveInt(originalForwarded.sender_id || originalForwarded.senderId || source.senderId),
        sender_name: toBoundedString(originalForwarded.sender_name || originalForwarded.senderName || senderName, 160) || senderName,
        preview_text: toBoundedString(originalForwarded.preview_text || originalForwarded.previewText || buildMessageTextPreview(source), 280) || buildMessageTextPreview(source),
        type: normalizeMessageType(originalForwarded.type || source.type || 'text'),
      };
      const nextMetadata = { ...safeObject(source.metadata), forwarded: forwardedMeta };
      const payload = {
        text: source.text || '',
        type: source.type,
        metadata: nextMetadata,
      };
      if (source.mediaUrl || source.mediaKind || source.mediaMime) {
        payload.media = {
          kind: source.mediaKind || source.type,
          url: source.mediaUrl || '',
          thumbUrl: source.mediaThumbUrl || '',
          mime: source.mediaMime || '',
          bytes: source.mediaBytes || null,
          durationSec: source.mediaDurationSec || null,
          width: source.mediaWidth || null,
          height: source.mediaHeight || null,
          waveform: source.mediaWaveform || null,
        };
      }
      const forwarded = await sendMessageToConversation(userId, conversationId, payload, db);
      created.push(forwarded);
    }

    deliveries.push({
      conversation_id: conversationId,
      messages: created,
    });
  }

  return {
    forwarded_count: orderedSources.length,
    target_count: conversationIds.length,
    deliveries,
  };
}

export async function markConversationRead(userId, conversationId, db = prisma) {
  if (!hasChatModels(db)) return { conversationId, updated: false };

  const conversation = await getConversationForUser(userId, conversationId, db);
  if (!conversation) throw Object.assign(new Error('Диалог не найден.'), { status: 404 });

  const latest = await db.chatMessage.findFirst({
    where: { conversationId: conversation.id, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  const readAt = latest?.createdAt || new Date();
  await db.conversationMember.updateMany({
    where: { conversationId: conversation.id, userId },
    data: { lastReadAt: readAt, lastDeliveredAt: readAt, unreadCount: 0 },
  });

  // For direct chats this gives the sender a meaningful read state.
  if (conversation.type === 'direct') {
    await db.chatMessage.updateMany({
      where: {
        conversationId: conversation.id,
        senderId: { not: userId },
        deletedAt: null,
        createdAt: { lte: readAt },
      },
      data: { status: 'read', deliveredAt: readAt },
    });
  }

  await refreshConversationState(conversation.id, db);

  const senderIds = await listRecipientIds(conversation.id, userId, db);
  emitUsersEvent(senderIds, 'message.read', {
    conversationId: conversation.id,
    readAt,
    readerId: userId,
  });
  await publishConversationUpdated(conversation.id, db);
  await emitUnreadSummary([userId], db);

  return {
    conversationId: conversation.id,
    updated: true,
    readAt,
  };
}

export async function countUnreadMessages(userId, db = prisma) {
  if (!hasChatModels(db)) return 0;

  const memberships = await db.conversationMember.findMany({
    where: { userId, archivedAt: null },
    select: { conversationId: true, lastReadAt: true, clearedAt: true },
  });

  const hiddenIncoming = hasMessageRequestModel(db)
    ? new Set((await db.messageRequest.findMany({
      where: { toUserId: userId, status: 'pending' },
      select: { conversationId: true },
    })).map((item) => item.conversationId))
    : new Set();

  let count = 0;
  for (const membership of memberships) {
    if (hiddenIncoming.has(membership.conversationId)) continue;
    count += await db.chatMessage.count({
      where: {
        conversationId: membership.conversationId,
        deletedAt: null,
        senderId: { not: userId },
        createdAt: { gt: membership.lastReadAt || membership.clearedAt || new Date(0) },
      },
    });
  }
  return count;
}

export async function setDraftForConversation(userId, conversationId, draftText, db = prisma) {
  if (!hasChatModels(db)) throw Object.assign(new Error('Чат-модуль ещё не доступен.'), { status: 503 });
  const membership = await getConversationMember(userId, conversationId, db);
  if (!membership) throw Object.assign(new Error('Диалог не найден.'), { status: 404 });

  const text = String(draftText || '').slice(0, 5000);
  const updated = await db.conversationMember.update({
    where: { conversationId_userId: { conversationId: String(conversationId), userId } },
    data: {
      draftText: text || null,
      draftUpdatedAt: text ? new Date() : null,
    },
  });
  await publishConversationUpdated(conversationId, db);
  return { conversationId: String(conversationId), draftText: updated.draftText || '' };
}

export async function clearDraftForConversation(userId, conversationId, db = prisma) {
  return setDraftForConversation(userId, conversationId, '', db);
}

async function updateConversationPreference(userId, conversationId, data, db = prisma) {
  if (!hasChatModels(db)) throw Object.assign(new Error('Чат-модуль ещё не доступен.'), { status: 503 });
  const membership = await getConversationMember(userId, conversationId, db);
  if (!membership) throw Object.assign(new Error('Диалог не найден.'), { status: 404 });

  const updated = await db.conversationMember.update({
    where: { conversationId_userId: { conversationId: String(conversationId), userId: Number(userId) } },
    data,
    include: {
      conversation: {
        include: {
          members: { include: { user: { include: { publicProfile: true } } } },
          messages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 },
          messageRequest: true,
        },
      },
    },
  });

  const conversation = updated.conversation;
  const unread = await db.chatMessage.count({
    where: {
      conversationId: conversation.id,
      deletedAt: null,
      senderId: { not: Number(userId) },
      createdAt: { gt: updated.lastReadAt || updated.clearedAt || new Date(0) },
    },
  });

  await publishConversationUpdated(conversation.id, db);
  await emitUnreadSummary([userId], db);
  return serializeConversation({
    ...conversation,
    _count: { messages: unread },
    members: conversation.members.map((member) => (
      member.userId === Number(userId)
        ? {
            ...member,
            pinned: updated.pinned,
            pinnedAt: updated.pinnedAt,
            muted: updated.muted,
            mutedUntil: updated.mutedUntil,
            archivedAt: updated.archivedAt,
            draftText: updated.draftText,
            draftUpdatedAt: updated.draftUpdatedAt,
          }
        : member
    )),
  }, Number(userId));
}

export async function setConversationPinned(userId, conversationId, pinned = true, db = prisma) {
  return updateConversationPreference(userId, conversationId, {
    pinned: Boolean(pinned),
    pinnedAt: pinned ? new Date() : null,
  }, db);
}

export async function setConversationMuted(userId, conversationId, muted = true, db = prisma) {
  return updateConversationPreference(userId, conversationId, {
    muted: Boolean(muted),
    mutedUntil: muted ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) : null,
  }, db);
}

export async function setConversationArchived(userId, conversationId, archived = true, db = prisma) {
  return updateConversationPreference(userId, conversationId, {
    archivedAt: archived ? new Date() : null,
  }, db);
}

export async function listMessageRequestsForUser(userId, options = {}, db = prisma) {
  if (!hasChatModels(db) || !hasMessageRequestModel(db)) {
    return { incoming: [], outgoing: [], count: 0 };
  }

  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
  const [incomingRows, outgoingRows] = await Promise.all([
    db.messageRequest.findMany({
      where: { toUserId: userId, status: 'pending' },
      include: {
        fromUser: { include: { publicProfile: true } },
        conversation: {
          include: {
            messages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 },
            members: { include: { user: { include: { publicProfile: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    db.messageRequest.findMany({
      where: { fromUserId: userId, status: 'pending' },
      include: {
        toUser: { include: { publicProfile: true } },
        conversation: {
          include: {
            messages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 },
            members: { include: { user: { include: { publicProfile: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
  ]);

  const mapItem = (request, direction) => {
    const counterpart = direction === 'incoming' ? request.fromUser : request.toUser;
    const preview = request.previewText || request.conversation?.messages?.[0]?.text || 'Первое сообщение';
    return {
      id: request.id,
      conversation_id: request.conversationId,
      direction,
      status: request.status,
      created_at: request.createdAt,
      updated_at: request.updatedAt,
      preview_text: preview,
      person: {
        id: counterpart.id,
        name: `${counterpart.firstName} ${counterpart.lastName}`.trim(),
        handle: counterpart.publicProfile?.handle ? `@${counterpart.publicProfile.handle}` : null,
        initials: initialsOf(counterpart.firstName, counterpart.lastName),
        tone: toneOf(counterpart.publicProfile),
      },
    };
  };

  return {
    incoming: incomingRows.map((row) => mapItem(row, 'incoming')),
    outgoing: outgoingRows.map((row) => mapItem(row, 'outgoing')),
    count: incomingRows.length + outgoingRows.length,
  };
}

export async function acceptMessageRequest(userId, requestId, db = prisma) {
  if (!hasMessageRequestModel(db)) throw Object.assign(new Error('Контур message requests ещё не доступен.'), { status: 503 });
  const request = await db.messageRequest.findUnique({ where: { id: Number(requestId) } });
  if (!request || request.toUserId !== userId) throw Object.assign(new Error('Запрос не найден.'), { status: 404 });
  if (request.status !== 'pending') return request;
  const updated = await db.messageRequest.update({
    where: { id: request.id },
    data: { status: 'accepted', respondedAt: new Date() },
  });
  await createNotification({
    userId: request.fromUserId,
    actorUserId: userId,
    type: 'message_request_accepted',
    title: 'Запрос принят',
    body: 'Диалог доступен в основном списке чатов.',
    entityType: 'conversation',
    entityId: request.conversationId,
  }, db);
  emitUsersEvent([request.fromUserId, request.toUserId], 'message_request.updated', {
    conversationId: request.conversationId,
    request: {
      id: updated.id,
      status: updated.status,
      fromUserId: updated.fromUserId,
      toUserId: updated.toUserId,
      updatedAt: updated.updatedAt,
    },
  });
  await publishConversationUpdated(request.conversationId, db);
  await emitUnreadSummary([request.fromUserId, request.toUserId], db);
  return updated;
}

export async function rejectMessageRequest(userId, requestId, nextStatus = 'rejected', db = prisma) {
  if (!hasMessageRequestModel(db)) throw Object.assign(new Error('Контур message requests ещё не доступен.'), { status: 503 });
  const request = await db.messageRequest.findUnique({ where: { id: Number(requestId) } });
  if (!request || request.toUserId !== userId) throw Object.assign(new Error('Запрос не найден.'), { status: 404 });
  if (!['rejected', 'blocked'].includes(nextStatus)) throw Object.assign(new Error('Некорректный статус запроса.'), { status: 400 });
  const updated = await db.messageRequest.update({
    where: { id: request.id },
    data: { status: nextStatus, respondedAt: new Date() },
  });
  emitUsersEvent([request.fromUserId, request.toUserId], 'message_request.updated', {
    conversationId: request.conversationId,
    request: {
      id: updated.id,
      status: updated.status,
      fromUserId: updated.fromUserId,
      toUserId: updated.toUserId,
      updatedAt: updated.updatedAt,
    },
  });
  await publishConversationUpdated(request.conversationId, db);
  await emitUnreadSummary([request.fromUserId, request.toUserId], db);
  return updated;
}

function presenceCutoffDate() {
  return new Date(Date.now() - PRESENCE_TTL_MS);
}

function typingExpiryDate() {
  return new Date(Date.now() + TYPING_TTL_MS);
}

function toPresenceSnapshot(entry, userId) {
  if (!entry) return { userId: Number(userId) || null, isOnline: false, lastSeenAt: null, source: null, conversationId: null };
  return {
    userId: entry.userId,
    isOnline: new Date(entry.lastSeenAt).getTime() >= presenceCutoffDate().getTime(),
    lastSeenAt: entry.lastSeenAt?.toISOString?.() || String(entry.lastSeenAt || ''),
    source: entry.source || null,
    conversationId: entry.conversationId || null,
  };
}

async function cleanupExpiredTypingStates(db = prisma) {
  await db.conversationTypingState.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => null);
}

async function upsertPresence(userId, options = {}, db = prisma) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const entry = await db.realtimePresence.upsert({
    where: { userId: id },
    update: {
      source: options.source || 'heartbeat',
      conversationId: options.conversationId ? String(options.conversationId) : null,
      lastSeenAt: new Date(),
    },
    create: {
      userId: id,
      source: options.source || 'heartbeat',
      conversationId: options.conversationId ? String(options.conversationId) : null,
      lastSeenAt: new Date(),
    },
  });
  return toPresenceSnapshot(entry, id);
}

async function getPresenceSnapshot(targetUserId, db = prisma) {
  const id = Number(targetUserId);
  if (!Number.isInteger(id) || id <= 0) return { userId: null, isOnline: false, lastSeenAt: null, source: null, conversationId: null };
  const entry = await db.realtimePresence.findUnique({ where: { userId: id } });
  return toPresenceSnapshot(entry, id);
}

export async function heartbeatPresence(userId, options = {}, db = prisma) {
  const membership = options.conversationId ? await getConversationMember(userId, options.conversationId, db) : null;
  const snapshot = await upsertPresence(userId, { source: options.source || 'heartbeat', conversationId: membership?.conversationId || null }, db);
  if (membership?.conversationId) {
    const recipients = await listRecipientIds(membership.conversationId, userId, db);
    emitUsersEvent(recipients, 'presence.changed', snapshot);
  }
  emitUsersEvent([userId], 'presence.self', snapshot);
  return snapshot;
}

export async function getPresenceForUser(_viewerId, targetUserId, db = prisma) {
  return getPresenceSnapshot(targetUserId, db);
}

export async function updateTypingForConversation(userId, conversationId, isTyping, db = prisma) {
  const conversation = await getConversationForUser(userId, conversationId, db);
  if (!conversation) throw Object.assign(new Error('Диалог не найден.'), { status: 404 });
  const recipients = await listRecipientIds(conversation.id, userId, db);
  await cleanupExpiredTypingStates(db);
  if (isTyping) {
    const existingTypingState = await db.conversationTypingState.findUnique({
      where: { conversationId_userId: { conversationId: conversation.id, userId } },
    });
    const snapshot = await upsertPresence(userId, { source: 'typing', conversationId: conversation.id }, db);
    emitUsersEvent(recipients, 'presence.changed', snapshot);
    const typingState = await db.conversationTypingState.upsert({
      where: { conversationId_userId: { conversationId: conversation.id, userId } },
      update: { expiresAt: typingExpiryDate() },
      create: { conversationId: conversation.id, userId, expiresAt: typingExpiryDate() },
    });
    const payload = {
      conversationId: conversation.id,
      userId,
      active: true,
      updatedAt: typingState.updatedAt.toISOString(),
      expiresAt: typingState.expiresAt.toISOString(),
    };
    const wasStillTyping = existingTypingState && new Date(existingTypingState.expiresAt).getTime() >= Date.now();
    if (!wasStillTyping) {
      emitUsersEvent(recipients, 'typing.started', payload);
    }
    return payload;
  }
  const removed = await db.conversationTypingState.deleteMany({ where: { conversationId: conversation.id, userId } });
  const payload = {
    conversationId: conversation.id,
    userId,
    active: false,
    updatedAt: new Date().toISOString(),
  };
  if (removed.count > 0) {
    emitUsersEvent(recipients, 'typing.stopped', payload);
  }
  return payload;
}

export async function getTypingSnapshotForConversation(userId, conversationId, db = prisma) {
  const conversation = await getConversationForUser(userId, conversationId, db);
  if (!conversation) throw Object.assign(new Error('Диалог не найден.'), { status: 404 });
  await cleanupExpiredTypingStates(db);
  const items = await db.conversationTypingState.findMany({
    where: { conversationId: conversation.id, expiresAt: { gte: new Date() } },
    orderBy: { updatedAt: 'desc' },
  });
  return items.map((item) => ({
    conversationId: item.conversationId,
    userId: item.userId,
    active: true,
    updatedAt: item.updatedAt.toISOString(),
    expiresAt: item.expiresAt.toISOString(),
  }));
}
