import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { getCurrentSession } from '@/lib/auth';
import { ensureUserFeedSettings, getVisibleFeedChannels, serializeFeedSettings } from '@/lib/feed-settings';
import { normalizedKey } from '@/lib/dfsn';
import { serializePostsForViewer } from '@/lib/posts';

async function ensureAggregatedFeed() {
  const aggregatedCount = await prisma.post.count({
    where: {
      type: { not: 'text' },
    },
  });

  if (aggregatedCount >= 4) return;

  const demoPeople = [
    { firstName: 'Лиза', lastName: 'Дизайн' },
    { firstName: 'Илья', lastName: 'Motion' },
    { firstName: 'Катя', lastName: 'Product' },
    { firstName: 'Ника', lastName: 'Builder' },
  ];

  const demoUsers = [];
  for (const person of demoPeople) {
    const user = await prisma.user.upsert({
      where: { normalizedKey: normalizedKey(person.firstName, person.lastName) },
      update: {},
      create: {
        firstName: person.firstName,
        lastName: person.lastName,
        normalizedKey: normalizedKey(person.firstName, person.lastName),
        passwordHash: await bcrypt.hash('demo-demo', 4),
        secretAnswerHash: await bcrypt.hash('demo-secret', 4),
        backupCodeHashes: [],
      },
    });
    demoUsers.push(user);
  }

  const definitions = [
    {
      authorId: demoUsers[0].id,
      type: 'gallery',
      text: 'Собрала новый feed-экран для соцсети и решила оставить карточки постов в том же стиле, что и в профиле: мягкое стекло, понятные действия, компактные цифры и лёгкая вложенность. Ниже пробую вариант с каруселью, где каждый слайд — отдельная мысль или шаг в истории.',
      location: 'Вильнюс',
      payload: {
        reason: 'Похоже на темы, которые вы часто читаете',
        feedChannel: 'following',
        meta: 'только что · Вильнюс',
        views: '8,4 тыс.',
        reposts: 18,
        slides: [
          { text: 'Первый экран: мягкий topbar, поиск и быстрые фильтры.', bg: 'linear-gradient(135deg, #7f8cff, #89d0ff 60%, #9de0c5)' },
          { text: 'Второй экран: карточка поста с акцентом на автора и медиа.', bg: 'linear-gradient(135deg, #ff9fb1, #ffc88f 55%, #ffe8a6)' },
          { text: 'Третий экран: понятные действия — комментарии, репост и сохранение.', bg: 'linear-gradient(135deg, #7d7ef7, #b59fff 55%, #f1c6ff)' },
        ],
      },
    },
    {
      authorId: demoUsers[1].id,
      type: 'video',
      text: 'Маленький тизер того, как может выглядеть видео-пост в ленте. Я бы оставил крупный постер, заметную кнопку play и короткий заголовок, чтобы ролик не перегружал экран.',
      location: 'Онлайн',
      payload: {
        feedChannel: 'friends',
        meta: '2 часа назад · Онлайн',
        title: 'Анимация карточек в feed',
        desc: 'Превью короткого ролика с переходами карточек, плавающим topbar и микро-анимацией действий.',
        views: '19,6 тыс.',
        reposts: 24,
      },
    },
    {
      authorId: demoUsers[2].id,
      type: 'link',
      text: 'Сделала ссылочный пост про систему рекомендаций и быстрые фильтры в ленте. Важно, чтобы такой блок выглядел не как чужой вебвиджет, а как естественная часть общей карточки.',
      location: 'Рига',
      payload: {
        feedChannel: 'global',
        meta: 'сегодня · Рига',
        domain: 'friendscape.design',
        title: 'Система рекомендаций в мобильном feed',
        desc: 'Как встроить рекомендации, не ломая ритм ленты, и при этом оставить понятные действия у каждой карточки.',
        views: '6,1 тыс.',
        reposts: 7,
      },
    },
    {
      authorId: demoUsers[3].id,
      type: 'repost',
      text: 'Репостнула хороший разбор про то, как сочетать профиль, чат и ленту в одном продукте. Понравилась идея не делать экран перегруженным, а использовать один визуальный язык для всех сущностей.',
      location: 'Минск',
      payload: {
        feedChannel: 'following',
        meta: 'вчера · Минск',
        title: 'Репост записи',
        desc: 'Короткий комментарий автора поверх репоста помогает объяснить, зачем он делится материалом.',
        innerTitle: 'Оригинальный пост',
        innerDesc: '«Если карточка поста хорошо собрана в профиле — её почти без изменений можно переиспользовать в feed, подборках и рекомендациях.»',
        views: '24,3 тыс.',
        reposts: 41,
      },
    },
  ];

  for (const definition of definitions) {
    const exists = await prisma.post.findFirst({
      where: {
        authorId: definition.authorId,
        type: definition.type,
      },
    });
    if (exists) continue;

    await prisma.post.create({
      data: definition,
    });
  }
}

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    }

    await ensureAggregatedFeed();

    const settingsRecord = await ensureUserFeedSettings(session.user.id);
    const settings = serializeFeedSettings(settingsRecord);
    const visibleChannels = getVisibleFeedChannels(settingsRecord);

    const posts = await prisma.post.findMany({
      where: { type: { not: 'text' } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: {
        author: true,
        comments: {
          orderBy: { createdAt: 'desc' },
          include: { author: true },
        },
        votes: true,
        saves: true,
      },
    });

    const filteredPosts = posts.filter((post) => {
      const channel = post?.payload?.feedChannel || 'following';
      if (channel === 'friends') return visibleChannels.friends;
      if (channel === 'global') return visibleChannels.global;
      return visibleChannels.following;
    });

    return NextResponse.json({
      user: {
        id: session.user.id,
        first_name: session.user.firstName,
        last_name: session.user.lastName,
      },
      settings,
      posts: await serializePostsForViewer(filteredPosts, session.user.id),
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('feed/get failed', error);
    return NextResponse.json({ error: 'Не удалось загрузить ленту.' }, { status: 500 });
  }
}
