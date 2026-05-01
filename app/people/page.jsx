'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import PostAuthBottomNav from '../../components/PostAuthBottomNav';
import { performSocialAction } from '@/lib/social-client';
import { readPageCache, writePageCache } from '@/lib/page-cache';

function SearchIcon() {
  return <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}

function CheckIcon() {
  return <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>;
}

function MessageIcon() {
  return <svg viewBox="0 0 24 24"><path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v4A3.5 3.5 0 0 1 15.5 14H10l-4 4v-4.5A3.5 3.5 0 0 1 5 10.5z"></path></svg>;
}

function SparklesIcon() {
  return <svg viewBox="0 0 24 24"><path d="m12 3 1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8Z" /><path d="M5 18l.9 2L8 21l-2.1.9L5 24l-.9-2.1L2 21l2.1-.9Z" /><path d="m19 14 .8 1.9L22 17l-2.2 1.1L19 20l-.8-1.9L16 17l2.2-1.1Z" /></svg>;
}

function PeopleAvatar({ initials, tone, status }) {
  return (
    <div className={`peopleM-avatar is-${tone}`}>
      <span>{initials}</span>
      {status === 'online' ? <span className="peopleM-online-dot" /> : null}
    </div>
  );
}

const PEOPLE_CACHE_KEY = 'page:people';
const PEOPLE_CACHE_TTL = 2 * 60 * 1000;

const SORT_OPTIONS = [
  { value: 'relevant', label: 'Сначала релевантные' },
  { value: 'online', label: 'Сначала онлайн' },
  { value: 'mutual', label: 'Больше общих' },
  { value: 'followers', label: 'Больше подписчиков' },
];

function actionConfig(relation) {
  if (relation === 'friends') {
    return { label: 'В друзьях', action: 'remove_friend', className: 'is-followed' };
  }
  if (relation === 'outgoing_request') {
    return { label: 'Заявка отправлена', action: 'cancel_request', className: 'is-pending' };
  }
  if (relation === 'incoming_request') {
    return { label: 'Принять заявку', action: 'accept_request', className: '' };
  }
  return { label: 'Добавить в друзья', action: 'send_request', className: '' };
}

function filterEmptyText(filter, hasQuery) {
  if (hasQuery) return 'Никого не нашли по этому запросу. Попробуйте другое имя, ник или город.';
  if (filter === 'online') return 'Сейчас никого нет онлайн. Проверьте позже или переключитесь на общий список.';
  if (filter === 'mutual') return 'Пока нет людей с заметным числом общих знакомых.';
  return 'Список пока пуст. Попробуйте обновить экран немного позже.';
}

export default function PeoplePage() {
  const router = useRouter();
  const initialCacheRef = useRef(null);
  const skipSearchReloadRef = useRef(true);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('relevant');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [requests, setRequests] = useState([]);
  const [people, setPeople] = useState([]);
  const [summary, setSummary] = useState({ total: 0, online: 0, mutual: 0, followsYou: 0, requests: 0, sort: 'relevant' });
  const [busyKey, setBusyKey] = useState('');

  useLayoutEffect(() => {
    const cachedState = readPageCache(PEOPLE_CACHE_KEY, PEOPLE_CACHE_TTL);
    initialCacheRef.current = cachedState;
    if (!cachedState) return;
    setQuery(cachedState.query || '');
    setFilter(cachedState.filter || 'all');
    setSort(cachedState.sort || 'relevant');
    setMessage(cachedState.message || '');
    setRequests(Array.isArray(cachedState.requests) ? cachedState.requests : []);
    setPeople(Array.isArray(cachedState.people) ? cachedState.people : []);
    setSummary(cachedState.summary || { total: 0, online: 0, mutual: 0, followsYou: 0, requests: 0, sort: 'relevant' });
    setLoading(false);
  }, []);

  const loadPeople = async (nextQuery = query, nextFilter = filter, nextSort = sort, { silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setError('');
      const params = new URLSearchParams();
      if (nextQuery) params.set('query', nextQuery);
      if (nextFilter) params.set('filter', nextFilter);
      if (nextSort) params.set('sort', nextSort);

      const response = await fetch(`/api/people?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json();
      if (response.status === 401) {
        router.replace('/');
        return;
      }
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить людей.');

      setRequests(data.requests || []);
      setPeople(data.people || []);
      setSummary(data.summary || { total: 0, online: 0, mutual: 0, followsYou: 0, requests: 0, sort: nextSort });
    } catch (loadError) {
      console.warn('people load fallback enabled', loadError?.message || loadError);
      setError('');
      setRequests([]);
      setPeople([]);
      setSummary({ total: 0, online: 0, mutual: 0, followsYou: 0, requests: 0, sort: nextSort });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPeople(query, filter, sort, { silent: Boolean(initialCacheRef.current) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (skipSearchReloadRef.current) {
      skipSearchReloadRef.current = false;
      return undefined;
    }
    const timeout = setTimeout(() => {
      loadPeople(query, filter, sort, { silent: Boolean(initialCacheRef.current && !error) });
    }, 180);
    return () => clearTimeout(timeout);
  }, [query, filter, sort]);

  useEffect(() => {
    if (!people.length && !requests.length && loading) return;
    writePageCache(PEOPLE_CACHE_KEY, { query, filter, sort, message, requests, people, summary });
  }, [query, filter, sort, message, requests, people, summary, loading]);

  const totalCount = useMemo(() => people.length, [people]);
  const hasQuery = Boolean(query.trim());
  const currentSortLabel = useMemo(
    () => SORT_OPTIONS.find((option) => option.value === sort)?.label || 'Сначала релевантные',
    [sort]
  );

  const runAction = async (targetUserId, action) => {
    try {
      const key = `${targetUserId}:${action}`;
      setBusyKey(key);
      setError('');
      setMessage('');
      const data = await performSocialAction(targetUserId, action);
      if (data.message) setMessage(data.message);
      await loadPeople(query, filter, sort);
    } catch (actionError) {
      setError(actionError.message || 'Не удалось выполнить действие.');
    } finally {
      setBusyKey('');
    }
  };

  const openProfile = (id) => router.push(`/profile/${id}?from=people`);
  const openChat = (person) => {
    const params = new URLSearchParams({ user: String(person.id), name: person.name, from: 'people' }).toString();
    router.push(`/chat?${params}`);
  };

  return (
    <div className="app-shell">
      <div className="app profile-app peopleM-app">
        <main className="screen peopleM-screen">
          <section className="peopleM-hero">
            <div className="peopleM-heroTop">
              <div>
                <div className="peopleM-title">Люди</div>
                <div className="peopleM-subtitle">Находите тех, с кем уже есть пересечения, запросы и поводы начать общение.</div>
              </div>
              <div className="peopleM-heroBadge"><SparklesIcon /> Подборка для вас</div>
            </div>

            <div className="peopleM-heroStats" aria-label="Краткая сводка">
              <div className="peopleM-heroStat">
                <strong>{summary.online || 0}</strong>
                <span>онлайн</span>
              </div>
              <div className="peopleM-heroStat">
                <strong>{summary.mutual || 0}</strong>
                <span>с общими</span>
              </div>
              <div className="peopleM-heroStat">
                <strong>{summary.followsYou || 0}</strong>
                <span>подписаны на вас</span>
              </div>
              <div className="peopleM-heroStat accent">
                <strong>{summary.requests || requests.length}</strong>
                <span>запросов</span>
              </div>
            </div>
          </section>

          <section className="peopleM-searchbar">
            <SearchIcon />
            <input
              type="text"
              placeholder="Поиск по имени, нику, профессии или городу"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </section>

          <section className="peopleM-toolbar" aria-label="Управление списком людей">
            <div className="peopleM-filters">
              <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Все</button>
              <button type="button" className={filter === 'online' ? 'active' : ''} onClick={() => setFilter('online')}>Онлайн</button>
              <button type="button" className={filter === 'mutual' ? 'active' : ''} onClick={() => setFilter('mutual')}>Общие</button>
            </div>

            <div className="peopleM-sortRow">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`peopleM-sortChip ${sort === option.value ? 'active' : ''}`}
                  onClick={() => setSort(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section className="peopleM-insightBar">
            <div className="peopleM-insightText">
              {loading ? 'Обновляем подборку…' : `Показываем ${totalCount} человек · ${currentSortLabel.toLowerCase()}`}
            </div>
            {summary.requests ? <div className="peopleM-insightPill">{summary.requests} заявок ждут ответа</div> : null}
          </section>

          {error ? <div className="peopleM-alert is-error">{error}</div> : null}

          {requests.length > 0 ? (
            <section className="peopleM-section">
              <div className="peopleM-section-head">
                <div className="peopleM-section-title">Запросы в друзья</div>
                <div className="peopleM-section-meta">{requests.length}</div>
              </div>

              <div className="peopleM-listSurface">
                {requests.map((person) => (
                  <article key={person.id} className="peopleM-rowCard">
                    <button type="button" className="peopleM-rowMain" onClick={() => openProfile(person.id)}>
                      <PeopleAvatar initials={person.initials} tone={person.tone} status="online" />
                      <div className="peopleM-rowCopy">
                        <div className="peopleM-rowHead">
                          <div className="peopleM-name">{person.name}</div>
                          <div className="peopleM-handle">{person.handle}</div>
                        </div>
                        <div className="peopleM-note">{person.note}</div>
                        <div className="peopleM-rowTags">
                          <span className="peopleM-reasonTag accent">Хочет добавить вас</span>
                          <span>{person.mutual}</span>
                        </div>
                      </div>
                    </button>

                    <div className="peopleM-rowActions compact">
                      <button
                        type="button"
                        className="peopleM-lineAction primary"
                        disabled={busyKey === `${person.id}:accept_request`}
                        onClick={() => runAction(person.id, 'accept_request')}
                      >
                        {busyKey === `${person.id}:accept_request` ? '...' : <><CheckIcon /> Принять</>}
                      </button>
                      <button
                        type="button"
                        className="peopleM-lineAction subtle"
                        disabled={busyKey === `${person.id}:reject_request`}
                        onClick={() => runAction(person.id, 'reject_request')}
                      >
                        {busyKey === `${person.id}:reject_request` ? '...' : 'Отклонить'}
                      </button>
                      <button type="button" className="peopleM-iconAction" onClick={() => openChat(person)}>
                        <MessageIcon />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className="peopleM-section">
            <div className="peopleM-section-head">
              <div className="peopleM-section-title">Для вас</div>
              <div className="peopleM-section-meta">{loading ? '...' : totalCount}</div>
            </div>

            {loading ? (
              <div className="peopleM-card-placeholder">Загрузка списка людей...</div>
            ) : people.length === 0 ? (
              <div className="peopleM-card-placeholder">{filterEmptyText(filter, hasQuery)}</div>
            ) : (
              <div className="peopleM-listSurface">
                {people.map((person) => {
                  const friendAction = actionConfig(person.relation);
                  const friendBusy = busyKey === `${person.id}:${friendAction.action}`;
                  const followAction = person.isFollowing ? 'unfollow' : 'follow';
                  const followBusy = busyKey === `${person.id}:${followAction}`;

                  return (
                    <article key={person.id} className="peopleM-rowCard">
                      <button type="button" className="peopleM-rowMain" onClick={() => openProfile(person.id)}>
                        <PeopleAvatar initials={person.initials} tone={person.tone} status={person.status} />
                        <div className="peopleM-rowCopy">
                          <div className="peopleM-rowHead">
                            <div className="peopleM-name">{person.name}</div>
                            <div className="peopleM-handle">{person.handle}</div>
                          </div>
                          <div className="peopleM-note">{person.meta}</div>
                          <div className="peopleM-rowTags">
                            <span className="peopleM-reasonTag accent">{person.why}</span>
                            <span>{person.mutual}</span>
                            <span>{person.friendsCount} друзей</span>
                            {person.followsYou ? <span>Подписан на вас</span> : null}
                          </div>
                        </div>
                      </button>

                      <div className="peopleM-rowActions">
                        <button
                          type="button"
                          className={`peopleM-lineAction primary ${friendAction.className}`}
                          disabled={friendBusy}
                          onClick={() => runAction(person.id, friendAction.action)}
                        >
                          {friendBusy ? '...' : friendAction.label}
                        </button>
                        <button
                          type="button"
                          className={`peopleM-lineAction secondary ${person.isFollowing ? 'is-active' : ''}`}
                          disabled={followBusy}
                          onClick={() => runAction(person.id, followAction)}
                        >
                          {followBusy ? '...' : person.isFollowing ? 'Подписка' : 'Подписаться'}
                        </button>
                        <button type="button" className="peopleM-iconAction" onClick={() => openChat(person)}>
                          <MessageIcon />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </main>

        <PostAuthBottomNav />
      </div>
    </div>
  );
}
