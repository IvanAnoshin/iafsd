import prisma from '@/lib/prisma';
import { sanitizeClientMediaUrl } from '@/lib/media-security';
import { attachCommentVotesToPost, attachCommentVotesToPosts, serializeComment } from '@/lib/comments';
import { sortFriendPair } from '@/lib/social';


const POST_VISIBILITIES = new Set(['public', 'friends', 'followers', 'private', 'community']);

export function normalizePostVisibility(value, fallback = 'public') {
  const normalized = String(value || '').trim().toLowerCase();
  return POST_VISIBILITIES.has(normalized) ? normalized : fallback;
}

export function normalizePostLocation(value) {
  const location = String(value || '').trim().slice(0, 120);
  return location || null;
}

export function normalizePostMedia(input, limit = 10) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item) => item && typeof item === 'object' && String(item.url || item.mediaUrl || '').trim())
    .slice(0, limit)
    .map((item, index) => {
      const rawKind = String(item.kind || item.type || '').trim().toLowerCase();
      const mime = String(item.mime || '').trim().toLowerCase();
      const kind = rawKind === 'video' || mime.startsWith('video/') ? 'video' : 'image';
      const url = sanitizeClientMediaUrl(item.url || item.mediaUrl);
      const thumbUrl = sanitizeClientMediaUrl(item.thumbUrl || item.thumb_url || item.thumbnailUrl || item.previewUrl || item.url || item.mediaUrl);
      return {
        id: item.id || item.mediaId || item.storageKey || item.storage_key || `${kind}-${index}`,
        kind,
        type: kind,
        url,
        thumbUrl,
        storage: String(item.storage || 'local').trim(),
        storageKey: item.storageKey || item.storage_key || null,
        previewStorageKey: item.previewStorageKey || item.preview_storage_key || null,
        previewBytes: Number(item.previewBytes || item.preview_bytes || 0) || 0,
        previewMime: String(item.previewMime || item.preview_mime || '').trim() || null,
        previewGenerated: Boolean(item.previewGenerated || item.preview_generated),
        private: Boolean(item.private),
        mime,
        bytes: Number(item.bytes || 0) || null,
        originalName: String(item.originalName || item.original_name || '').trim() || null,
        width: Number(item.width || 0) || null,
        height: Number(item.height || 0) || null,
        durationSec: Number(item.durationSec || item.duration_sec || 0) || null,
      };
    })
    .filter((item) => item.url);
}

export function buildPersonalPostPayload({ media = [], source = 'feed', extra = {} } = {}) {
  return {
    source,
    surface: source,
    aggregatedIntoFeed: true,
    ...(media.length ? { media } : {}),
    ...extra,
  };
}

async function viewerRelationshipToAuthor(viewerId, authorId, db = prisma) {
  if (!viewerId || !authorId || viewerId === authorId) {
    return { isAuthor: viewerId === authorId, isFriend: false, isFollower: false };
  }

  const [userAId, userBId] = sortFriendPair(Number(viewerId), Number(authorId));
  const [friendship, following] = await Promise.all([
    db.friendship.findUnique({ where: { userAId_userBId: { userAId, userBId } }, select: { id: true } }).catch(() => null),
    db.subscription.findUnique({ where: { fromUserId_toUserId: { fromUserId: Number(viewerId), toUserId: Number(authorId) } }, select: { id: true } }).catch(() => null),
  ]);

  return { isAuthor: false, isFriend: Boolean(friendship), isFollower: Boolean(following) };
}

export function normalizePostText(value, max = 1200) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return text.slice(0, max);
}

function voteUserId(record) {
  return Number(record?.userId || record?.user_id || 0);
}

function safeStatNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function serializePostCommunity(community) {
  if (!community) return null;
  return {
    id: community.id,
    slug: community.slug,
    name: community.name,
    visibility: community.visibility || 'public',
    avatar_tone: community.avatarTone || 'violet',
    avatar_url: community.avatarUrl || null,
    cover_url: community.coverUrl || null,
  };
}

export function serializePost(post, currentUserId = null) {
  const payload = post?.payload && typeof post.payload === 'object' ? post.payload : {};
  const votes = Array.isArray(post?.votes) ? post.votes : [];
  const saves = Array.isArray(post?.saves) ? post.saves : [];
  const comments = Array.isArray(post?.comments) ? post.comments : [];
  const currentVote = currentUserId ? (votes.find((vote) => Number(vote.userId) === Number(currentUserId))?.value ?? 0) : 0;
  const payloadReposts = safeStatNumber(payload.reposts, 0);
  const profileReposts = safeStatNumber(payload.profile_reposts || payload.profileReposts, 0);
  const repostOf = post.repostOf && !post.repostOf.deletedAt && String(post.repostOf.status || 'visible') === 'visible'
    ? post.repostOf
    : null;

  return {
    id: post.id,
    text: post.text,
    type: post.repostOfId || post.repostOf ? 'repost' : (post.type || 'text'),
    visibility: post.visibility || 'public',
    status: post.status || 'visible',
    moderation_reason: post.moderationReason || null,
    report_count: Number(post.reportCount || 0),
    deleted_at: post.deletedAt || null,
    hidden_at: post.hiddenAt || null,
    is_pinned: Boolean(post.isPinned),
    location: post.location || null,
    community: serializePostCommunity(post.community),
    repost_of_id: post.repostOfId || null,
    repost_of: repostOf ? serializePost({ ...repostOf, repostOf: null }, currentUserId) : null,
    created_at: post.createdAt,
    is_mine: Boolean(currentUserId && Number(post.authorId || post.author?.id || 0) === Number(currentUserId)),
    author: post.author ? {
      id: post.author.id,
      first_name: post.author.firstName,
      last_name: post.author.lastName,
    } : null,
    payload,
    stats: {
      plus: votes.filter((vote) => Number(vote.value) > 0).length,
      minus: votes.filter((vote) => Number(vote.value) < 0).length,
      comments: Number.isFinite(Number(post?._count?.comments)) ? Number(post._count.comments) : comments.length,
      saves: Number.isFinite(Number(post?._count?.saves)) ? Number(post._count.saves) : saves.length,
      views: safeStatNumber(payload.views, 0),
      reposts: payloadReposts + profileReposts,
    },
    current_vote: currentVote,
    is_liked: currentVote === 1,
    is_saved: currentUserId ? saves.some((save) => voteUserId(save) === Number(currentUserId)) : false,
    comments: comments
      .slice()
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .map((comment) => serializeComment(comment, currentUserId)),
  };
}

export async function serializePostForViewer(post, currentUserId = null, db = prisma) {
  const hydrated = await attachCommentVotesToPost(post, db, currentUserId);
  return hydrated ? serializePost(hydrated, currentUserId) : null;
}

export async function serializePostsForViewer(posts, currentUserId = null, db = prisma) {
  const hydrated = await attachCommentVotesToPosts(posts, db, currentUserId);
  return hydrated.map((post) => serializePost(post, currentUserId));
}

export async function canViewerAccessPost(post, currentUserId = null, db = prisma) {
  if (!post) return false;
  const viewerId = Number(currentUserId || 0);
  const authorId = Number(post.authorId || post.author?.id || 0);
  const isAuthor = viewerId > 0 && authorId === viewerId;

  if (post.deletedAt || post.status === 'deleted') return false;

  if (!post.communityId) {
    if (post.status !== 'visible') return isAuthor;
    if (isAuthor) return true;
    const visibility = normalizePostVisibility(post.visibility, 'public');
    if (visibility === 'public') return true;
    if (!viewerId || !authorId) return false;
    if (visibility === 'private') return false;
    const relation = await viewerRelationshipToAuthor(viewerId, authorId, db);
    if (visibility === 'friends') return relation.isFriend;
    if (visibility === 'followers') return relation.isFollower || relation.isFriend;
    return false;
  }

  const community = post.community || await db.community.findUnique({
    where: { id: Number(post.communityId) },
    select: { id: true, visibility: true },
  }).catch(() => null);
  if (!community) return false;

  const membership = viewerId > 0 ? await db.communityMember.findUnique({
    where: { communityId_userId: { communityId: Number(post.communityId), userId: viewerId } },
    select: { role: true, status: true },
  }).catch(() => null) : null;
  const activeMember = membership?.status === 'active';
  const canManage = activeMember && ['owner', 'admin', 'moderator'].includes(membership.role);

  if (post.status !== 'visible') return isAuthor || canManage;
  if (community.visibility === 'public' && post.visibility === 'public') return true;
  return activeMember && ['public', 'community'].includes(String(post.visibility || 'public'));
}

