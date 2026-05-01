import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentSession, touchSession, verifyCsrf } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { ensureUserFeedSettings, sanitizeFeedSettings, serializeFeedSettings } from "@/lib/feed-settings";

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "Требуется авторизация." }, { status: 401 });
    }

    await touchSession(session.id);
    const settings = await ensureUserFeedSettings(session.user.id);

    return NextResponse.json({ settings: serializeFeedSettings(settings) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("feed/settings get failed", error);
    return NextResponse.json({ error: "Не удалось загрузить настройки ленты." }, { status: 500 });
  }
}

export async function PUT(request) {
  let session = null;
  try {
    const csrf = verifyCsrf(request);
    if (!csrf.ok) return csrf.response;

    session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "Требуется авторизация." }, { status: 401 });
    }

    await touchSession(session.id);
    const body = await request.json();
    const nextData = sanitizeFeedSettings(body);

    let updated;
    if (!prisma.userFeedSettings) {
      updated = {
        userId: session.user.id,
        defaultTab: nextData.default_tab,
        sortMode: nextData.sort_mode,
        showFriends: nextData.show_friends,
        showFollowing: nextData.show_following,
        showGlobal: nextData.show_global,
        showCommunities: nextData.show_communities,
        savedFirst: nextData.saved_first,
      };
    } else {
      try {
        updated = await prisma.$transaction(async (tx) => {
          await ensureUserFeedSettings(session.user.id, tx);
          return tx.userFeedSettings.update({
            where: { userId: session.user.id },
            data: {
              defaultTab: nextData.default_tab,
              sortMode: nextData.sort_mode,
              showFriends: nextData.show_friends,
              showFollowing: nextData.show_following,
              showGlobal: nextData.show_global,
              showCommunities: nextData.show_communities,
              savedFirst: nextData.saved_first,
            },
          });
        });
      } catch (storageError) {
        console.warn('feed settings persistence fallback enabled:', storageError?.code || storageError?.message || storageError);
        updated = {
          userId: session.user.id,
          defaultTab: nextData.default_tab,
          sortMode: nextData.sort_mode,
          showFriends: nextData.show_friends,
          showFollowing: nextData.show_following,
          showGlobal: nextData.show_global,
          savedFirst: nextData.saved_first,
        };
      }
    }

    await writeAuditLog({
      request,
      session,
      action: "feed.settings.update",
      entityType: "feed_settings",
      entityId: String(session.user.id),
      metadata: nextData,
    });

    return NextResponse.json({
      message: updated?.__fallback || !prisma.userFeedSettings ? "Настройки ленты сохранены в режиме совместимости. Для постоянного сохранения обнови Prisma schema и базу." : "Настройки ленты обновлены.",
      settings: serializeFeedSettings(updated),
    });
  } catch (error) {
    console.error("feed/settings update failed", error);
    await writeAuditLog({
      request,
      session,
      action: "feed.settings.update",
      status: "error",
      metadata: { message: error?.message || "unknown_error" },
    });
    return NextResponse.json({ error: "Не удалось обновить настройки ленты." }, { status: 500 });
  }
}
