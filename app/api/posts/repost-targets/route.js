import { NextResponse } from 'next/server';

import { getCurrentSession } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { canPostInCommunity } from '@/lib/communities';

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : String(parts[0] || '?').slice(0, 2)).toUpperCase();
}

function roleLabel(role) {
  const value = String(role || 'member');
  if (value === 'owner') return 'Владелец';
  if (value === 'admin') return 'Администратор';
  if (value === 'moderator') return 'Модератор';
  return 'Участник';
}

function visibilityLabel(visibility) {
  const value = String(visibility || 'public');
  if (value === 'closed') return 'Закрытое сообщество';
  if (value === 'private') return 'Приватное сообщество';
  return 'Публичное сообщество';
}

export async function GET() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Требуется вход.' }, { status: 401 });
  }

  const memberships = await prisma.communityMember.findMany({
    where: {
      userId: Number(session.user.id),
      status: 'active',
      bannedAt: null,
    },
    include: {
      community: true,
    },
    orderBy: { joinedAt: 'desc' },
    take: 80,
  });

  const ownedCommunities = await prisma.community.findMany({
    where: { ownerId: Number(session.user.id) },
    orderBy: { updatedAt: 'desc' },
    take: 80,
  });

  const byId = new Map();

  memberships
    .filter((membership) => membership.community && canPostInCommunity(membership.community, membership))
    .forEach((membership) => {
      byId.set(Number(membership.community.id), {
        id: membership.community.id,
        slug: membership.community.slug,
        name: membership.community.name,
        initials: initials(membership.community.name),
        visibility: membership.community.visibility,
        visibility_label: visibilityLabel(membership.community.visibility),
        role: membership.role,
        role_label: roleLabel(membership.role),
        avatar_tone: membership.community.avatarTone || 'violet',
        avatar_url: membership.community.avatarUrl || '',
      });
    });

  ownedCommunities.forEach((community) => {
    if (byId.has(Number(community.id))) return;
    byId.set(Number(community.id), {
      id: community.id,
      slug: community.slug,
      name: community.name,
      initials: initials(community.name),
      visibility: community.visibility,
      visibility_label: visibilityLabel(community.visibility),
      role: 'owner',
      role_label: 'Владелец',
      avatar_tone: community.avatarTone || 'violet',
      avatar_url: community.avatarUrl || '',
    });
  });

  return NextResponse.json({ communities: Array.from(byId.values()) });
}
