# v83 Placeholder final cleanup

Цель прохода: убрать видимые/опасные заглушки из runtime и оставить только честные empty/error/disabled states.

## Что изменено

1. `/api/people` больше не создаёт демонстрационных пользователей и связи автоматически.
   - Удалены runtime demo-пользователи.
   - Список людей теперь строится только из реальных `UserPublicProfile`.
   - Для текущего пользователя по-прежнему создаётся минимальный public profile, если его ещё нет.

2. Stories foundation больше не подмешивает seed/demo moments.
   - Удалена генерация seed stories.
   - Удалены fake SVG media fallback для моментов.
   - Viewer/rail показывают только реально созданные renderable moments.
   - Highlights теперь пустые, если нет реального архива.

3. Видимые placeholder-формулировки заменены на честные состояния.
   - Убрана фраза про «заглушки» из hero ленты.
   - Убраны «скоро»/«пока недоступно» в местах, где это выглядело как обещание функции.
   - Empty states оставлены там, где они описывают реальное отсутствие данных.

4. Local uploads стали dev/local fallback, а не молчаливым production-поведением.
   - В production локальное хранение медиа блокируется по умолчанию для chat/community/post/story media.
   - Для осознанного single-server режима можно явно включить:
     - `CHAT_MEDIA_ALLOW_LOCAL_IN_PRODUCTION=true`
     - `COMMUNITY_MEDIA_ALLOW_LOCAL_IN_PRODUCTION=true`
     - `POST_MEDIA_ALLOW_LOCAL_IN_PRODUCTION=true`
     - `STORY_MEDIA_ALLOW_LOCAL_IN_PRODUCTION=true`
   - Для нормального production нужно object storage.

5. Rate limit memory fallback стал fail-closed в production.
   - Если PostgreSQL buckets недоступны, production больше не падает в process-memory limiter молча.
   - Явный override: `RATE_LIMIT_MEMORY_FALLBACK_IN_PRODUCTION=true`.
   - По умолчанию write/action routes получают 503, пока rate-limit storage не восстановится.

6. Placeholder audit стал чище.
   - Скрипт больше не считает собственные regex-правила как TODO/demo-hit.

## Итог audit:placeholders после v83

- Demo/seed data in runtime code: 0
- Native browser alerts: 0
- TODO/FIXME/HACK markers: 0

Оставшиеся категории не являются фейковыми данными:

- `runtime_unavailable`: в основном честные 403/empty/disabled states. Они нужны пользователю и API.
- `local_uploads`: dev fallback оставлен, но в production теперь заблокирован без явного override.
- `process_memory_realtime`: realtime на process-memory остаётся известным ограничением до v91 Realtime scaling. Anti-abuse memory fallback в production теперь fail-closed.

## Что не трогалось специально

- Не делал большой UI-рефакторинг.
- Не переносил stories на БД в этом проходе, чтобы не раздувать v83.
- Не удалял честные empty states вроде «нет сообщений», «нет медиа», «профиль недоступен».

## Ручная проверка после установки

1. Новый пользователь открывает `/people` — видит пустой/реальный список, но не auto-generated людей.
2. Stories rail не показывает fake moments.
3. В production без object storage медиа upload возвращает понятную ошибку конфигурации, а не пишет в `public/uploads` молча.
4. Rate-limit DB outage в production не превращается в per-process лимитер без явного env override.
