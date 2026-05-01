import prisma from '@/lib/prisma';
import { attachCommentVotesToPost, attachCommentVotesToPosts, serializeComment } from '@/lib/comments';

export function normalizePostText(value, max = 1200) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return text.slice(0, max);
}

export function serializePost(post, currentUserId = null) {
  const payload = post?.payload && typeof post.payload === 'object' ? post.payload : {};
  const votes = Array.isArray(post?.votes) ? post.votes : [];
  const saves = Array.isArray(post?.saves) ? post.saves : [];
  const comments = Array.isArray(post?.comments) ? post.comments : [];
  const currentVote = currentUserId ? (votes.find((vote) => vote.userId === currentUserId)?.value ?? 0) : 0;

  return {
    id: post.id,
    text: post.text,
    type: post.type || 'text',
    location: post.location || null,
    created_at: post.createdAt,
    author: post.author ? {
      id: post.author.id,
      first_name: post.author.firstName,
      last_name: post.author.lastName,
    } : null,
    payload,
    stats: {
      plus: votes.filter((vote) => Number(vote.value) > 0).length,
      minus: votes.filter((vote) => Number(vote.value) < 0).length,
      comments: comments.length,
      saves: saves.length,
      views: payload.views || '—',
      reposts: Number(payload.reposts || 0),
    },
    current_vote: currentVote,
    is_liked: currentVote === 1,
    is_saved: currentUserId ? saves.some((save) => save.userId === currentUserId) : false,
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
