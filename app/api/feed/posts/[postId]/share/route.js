import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentSession, touchSession, verifyCsrf } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { sendMessageToConversation } from '@/lib/chat';
import { createNotification } from '@/lib/notifications';
import { canViewerAccessPost, serializePostForViewer } from '@/lib/posts';
import { buildPostListInclude } from '@/lib/performance';
import { enforceRateLimit } from '@/lib/anti-abuse';

const MAX_SHARE_TARGETS = 10;
const MAX_SHARE_COMMENT_LENGTH = 420;


function safePayload(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function formatAuthorName(author) {
  return `${author?.firstName || ''} ${author?.lastName || ''}`.trim() || 'Пользователь';
}

function normalizeConversationIds(value) {
  const source = Array.isArray(value) ? value : [];
  return Array.from(new Set(source
    .map((item) => String(item || '').trim())
    .filter(Boolean)))
    .slice(0, MAX_SHARE_TARGETS);
}

function normalizeComment(value) {
  return String(value || '').trim().slice(0, MAX_SHARE_COMMENT_LENGTH);
}

function buildPostTitle(post) {
  const payload = safePayload(post?.payload);
  return String(payload.title || payload.innerTitle || '').trim() || 'Публикация Friendscape';
}

function buildPostPreview(post) {
  const payload = safePayload(post?.payload);
  return String(post?.text || payload.desc || payload.innerDesc || '').trim().replace(/\s+/g, ' ').slice(0, 220);
}

function buildPostShareText({ comment }) {
  return comment || 'Публикация';
}

async function loadSerializedPost(postId, userId) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: buildPostListInclude(userId, { commentsTake: 8 }),
  });
  return post ? serializePostForViewer(post, userId) : null;
}

export async function POST(request, { params }) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const shareLimit = await enforceRateLimit({ request, policy: 'post_share', actorUserId: session.user.id });
    if (shareLimit) return shareLimit;

    const { postId } = await params;
    const postIdNum = Number(postId);
    if (!Number.isInteger(postIdNum) || postIdNum <= 0) {
      return NextResponse.json({ error: 'Некорректный пост.' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const conversationIds = normalizeConversationIds(body?.conversationIds || body?.conversation_ids);
    const comment = normalizeComment(body?.comment);
    if (!conversationIds.length) {
      return NextResponse.json({ error: 'Выберите хотя бы один чат для отправки.' }, { status: 400 });
    }

    const post = await prisma.post.findUnique({
      where: { id: postIdNum },
      include: { author: true, community: true },
    });
    if (!post) return NextResponse.json({ error: 'Пост не найден.' }, { status: 404 });
    if (!(await canViewerAccessPost(post, session.user.id))) {
      return NextResponse.json({ error: 'Пост недоступен.' }, { status: 403 });
    }

    const url = new URL(`/feed?post=${post.id}`, request.url).toString();
    const authorName = formatAuthorName(post.author);
    const title = buildPostTitle(post);
    const preview = buildPostPreview(post);
    const postRef = {
      post_id: post.id,
      author_id: post.authorId,
      author_name: authorName,
      title,
      text: preview,
      type: post.type || 'text',
      url,
      deep_link: `/feed?post=${post.id}`,
      created_at: post.createdAt,
      community: post.community ? {
        id: post.community.id,
        slug: post.community.slug,
        name: post.community.name,
        visibility: post.community.visibility,
      } : null,
    };

    const sent = [];
    const failed = [];

    for (const conversationId of conversationIds) {
      try {
        const message = await sendMessageToConversation(session.user.id, conversationId, {
          type: 'text',
          text: buildPostShareText({ comment }),
          clientId: `feed-share:${post.id}:${conversationId}:${Date.now()}`,
          metadata: {
            post_ref: postRef,
            shared_entity: {
              kind: 'post',
              source: 'feed',
              post_id: post.id,
            },
          },
        });
        sent.push({ conversationId, messageId: message.id });
      } catch (error) {
        failed.push({ conversationId, error: error?.message || 'Не удалось отправить.' });
      }
    }

    if (!sent.length) {
      return NextResponse.json({
        error: failed[0]?.error || 'Не удалось отправить публикацию в выбранные чаты.',
        failed,
      }, { status: 400 });
    }

    const payload = safePayload(post.payload);
    const nextReposts = Math.max(0, Number(payload.reposts || 0)) + sent.length;
    await prisma.post.update({
      where: { id: post.id },
      data: {
        payload: {
          ...payload,
          reposts: nextReposts,
        },
      },
    });

    if (Number(post.authorId) !== Number(session.user.id)) {
      await createNotification({
        userId: post.authorId,
        actorUserId: session.user.id,
        type: 'post_share',
        title: 'Публикацией поделились',
        body: `${session.user.firstName} ${session.user.lastName}`.trim() + ' поделился(ась) вашей публикацией в чате.',
        targetLabel: preview || title,
        entityType: 'post',
        entityId: post.id,
        payload: { postId: post.id, sentCount: sent.length },
      }).catch(() => null);
    }

    await writeAuditLog({
      request,
      session,
      action: 'feed.post.share',
      entityType: 'post',
      entityId: post.id,
      metadata: {
        sentCount: sent.length,
        failedCount: failed.length,
        conversationIds,
        commentLength: comment.length,
      },
    });

    const serialized = await loadSerializedPost(post.id, session.user.id);
    const message = failed.length
      ? `Отправлено в ${sent.length} чатов, не отправлено в ${failed.length}.`
      : `Публикация отправлена в ${sent.length} ${sent.length === 1 ? 'чат' : 'чата'}.`;

    return NextResponse.json({
      ok: true,
      post: serialized,
      sent,
      failed,
      message,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('feed/share failed', error);
    await writeAuditLog({
      request,
      session,
      action: 'feed.post.share',
      entityType: 'post',
      status: 'error',
      metadata: { error: error?.message || String(error) },
    }).catch(() => null);
    return NextResponse.json({ error: error?.message || 'Не удалось поделиться публикацией.' }, { status: error?.status || 500 });
  }
}
