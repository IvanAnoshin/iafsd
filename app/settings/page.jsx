'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import PostAuthBottomNav from '../../components/PostAuthBottomNav';
import { readPageCache, writePageCache } from '@/lib/page-cache';
import { approveE2EEDeviceTransfer, completeE2EEDeviceTransfer, createRecoveryBundle, downloadRecoveryFile, getLocalE2EERecord, loadE2EETransferState, registerCurrentE2EEDevice, requestE2EEDeviceTransfer, restoreLocalE2EEFromRecoveryFile, restoreLocalE2EEFromTransferPackage, saveRecoveryBundleToServer } from '@/lib/e2ee-client';
import { registerPasskey } from '@/lib/passkey-client';

const SETTINGS_CACHE_KEY = 'page:settings';
const SETTINGS_CACHE_TTL = 3 * 60 * 1000;

const DEFAULT_PREFERENCES = {
  profile_visibility: 'everyone',
  photo_visibility: 'connections',
  activity_visibility: 'connections',
  community_visibility: 'connections',
  message_permission: 'everyone',
  message_requests_enabled: true,
  notify_messages: true,
  notify_message_requests: true,
  notify_comments: true,
  notify_reactions: true,
  notify_follows: true,
  appearance: 'system',
  vision_mode: 'none',
  reduced_motion: false,
};

function ChevronIcon() {
  return <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>;
}

function DeviceIcon() {
  return <svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="16" rx="3" /><path d="M10 17h4" /></svg>;
}

function ShieldIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.5 2.9 7.8 7 10 4.1-2.2 7-5.5 7-10V6l-7-3Z" /><path d="m9.5 12 1.7 1.7 3.3-3.4" /></svg>;
}

function HelpIcon() {
  return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.3 2.3 0 1 1 4.1 1.4c-.6.7-1.4 1.1-1.8 1.8-.2.4-.3.7-.3 1.3" /><circle cx="12" cy="16.8" r=".8" fill="currentColor" stroke="none" /></svg>;
}

function LogoutIcon() {
  return <svg viewBox="0 0 24 24"><path d="M15 16.5 19.5 12 15 7.5" /><path d="M19 12H9" /><path d="M11 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" /></svg>;
}

function KeyIcon() {
  return <svg viewBox="0 0 24 24"><circle cx="8" cy="12" r="4" /><path d="M12 12h8" /><path d="M17 12v3" /><path d="M20 12v2" /></svg>;
}

function PulseIcon() {
  return <svg viewBox="0 0 24 24"><path d="M3 12h4l2-4 4 8 2-4h6" /><path d="M12 4v2" /><path d="M12 18v2" /></svg>;
}

function DownloadIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>;
}


function applyVisualPreferences(preferences) {
  if (typeof document === 'undefined') return;
  const body = document.body;
  if (!body) return;
  const appearance = preferences?.appearance || 'system';
  const visionMode = preferences?.vision_mode || 'none';
  body.dataset.appAppearance = appearance;
  body.dataset.visionMode = visionMode;
  if (preferences?.reduced_motion) body.dataset.reducedMotion = 'true';
  else delete body.dataset.reducedMotion;
  try {
    window.localStorage.setItem('friendscape.visual-preferences', JSON.stringify({ appearance, vision_mode: visionMode, reduced_motion: Boolean(preferences?.reduced_motion) }));
  } catch {}
}

function PrivacySelect({ label, value, onChange, options }) {
  return (
    <label className="settingsM-inlineField">
      <span className="settingsM-inlineLabel">{label}</span>
      <select className="settingsM-input" value={value} onChange={onChange}>
        {options.map((item) => (
          <option key={item.value} value={item.value}>{item.label}</option>
        ))}
      </select>
    </label>
  );
}

function ToggleRow({ title, subtitle, checked, onToggle }) {
  return (
    <div className="settingsM-row static-row">
      <div className="settingsM-row-text">
        <div className="settingsM-row-title">{title}</div>
        <div className="settingsM-row-subtitle">{subtitle}</div>
      </div>
      <button type="button" className={`settingsM-switch ${checked ? 'is-on' : ''}`} onClick={onToggle} aria-pressed={checked}>
        <span />
      </button>
    </div>
  );
}


function SettingsTabs({ active, onChange, isAdmin }) {
  const tabs = [
    { id: 'account', label: 'Аккаунт', meta: 'сессии' },
    { id: 'privacy', label: 'Приватность', meta: 'доступ' },
    { id: 'security', label: 'Защита', meta: 'ключи' },
    { id: 'appearance', label: 'Вид', meta: 'экран' },
    { id: 'support', label: 'Поддержка', meta: 'отзыв' },
    ...(isAdmin ? [{ id: 'admin', label: 'Админ', meta: 'контроль' }] : []),
  ];

  return (
    <nav className="settingsM-tabs" aria-label="Разделы настроек">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`settingsM-tab ${active === tab.id ? 'is-active' : ''}`}
          onClick={() => onChange(tab.id)}
          aria-pressed={active === tab.id}
        >
          <span className="settingsM-tabLabel">{tab.label}</span>
          <span className="settingsM-tabMeta">{tab.meta}</span>
        </button>
      ))}
    </nav>
  );
}

function copyCodes(codes) {
  return navigator.clipboard.writeText(codes.join('\n'));
}

function downloadCodes(codes) {
  const content = ['Friendscape recovery codes', '', ...codes].join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'friendscape-recovery-codes.txt';
  link.click();
  URL.revokeObjectURL(url);
}

function SessionRow({ item }) {
  return (
    <div className={`settingsM-row ${item.is_current ? 'is-current' : ''}`}>
      <div className="settingsM-row-icon"><DeviceIcon /></div>
      <div className="settingsM-row-text">
        <div className="settingsM-row-title">{item.label || 'Устройство'}</div>
        <div className="settingsM-row-subtitle">
          {item.is_current ? 'Текущая сессия · ' : ''}
          Последняя активность: {new Date(item.last_seen_at).toLocaleString('ru-RU')}
        </div>
      </div>
      <div className="settingsM-session-badge">{item.is_current ? 'Сейчас' : 'Активна'}</div>
    </div>
  );
}

function DeviceRow({ item, onSetPin, onDelete, busyAction }) {
  return (
    <div className={`settingsM-deviceItem ${item.is_current ? 'is-current' : ''}`}>
      <div className="settingsM-row static-row">
        <div className="settingsM-row-icon"><DeviceIcon /></div>
        <div className="settingsM-row-text">
          <div className="settingsM-row-title">{item.label || 'Устройство'}</div>
          <div className="settingsM-row-subtitle">
            Последняя активность: {new Date(item.last_seen_at).toLocaleString('ru-RU')}
          </div>
        </div>
        <div className="settingsM-session-badge">{item.is_current ? 'Текущее' : `${item.session_count || 0} сесс.`}</div>
      </div>
      <div className="settingsM-deviceMetaRow">
        <span className="settingsM-deviceMeta">{item.platform || 'browser'}</span>
        <span className="settingsM-deviceMeta">{item.has_pin ? 'PIN задан' : 'Без PIN'}</span>
        {item.trusted ? <span className="settingsM-deviceMeta">Доверенное после 3 сессий</span> : null}
      </div>
      <div className="settingsM-action-row settingsM-deviceActions">
        <button type="button" className="settingsM-secondary-btn" onClick={() => onSetPin(item)} disabled={busyAction === `pin:${item.id}`}>
          {busyAction === `pin:${item.id}` ? 'Сохраняем…' : item.has_pin ? 'Сменить PIN' : 'Задать PIN'}
        </button>
        <button type="button" className="settingsM-secondary-btn" onClick={() => onDelete(item)} disabled={busyAction === `device:${item.id}`}>
          {busyAction === `device:${item.id}` ? 'Отключаем…' : 'Отключить'}
        </button>
      </div>
    </div>
  );
}


function TransferRequestRow({ item, onApprove, busyAction }) {
  return (
    <div className="settingsM-deviceItem">
      <div className="settingsM-row static-row">
        <div className="settingsM-row-icon"><ShieldIcon /></div>
        <div className="settingsM-row-text">
          <div className="settingsM-row-title">Запрос на перенос чатов</div>
          <div className="settingsM-row-subtitle">
            Новое устройство: {item.target_device_label || 'Новое устройство'} · истекает {new Date(item.expires_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <div className="settingsM-session-badge">Ожидает</div>
      </div>
      <div className="settingsM-deviceMetaRow">
        {item.target_device_key_id ? <span className="settingsM-deviceMeta">ID {String(item.target_device_key_id).slice(0, 8)}</span> : null}
        <span className="settingsM-deviceMeta">Подтвердите на этом доверенном устройстве</span>
      </div>
      <div className="settingsM-action-row settingsM-deviceActions">
        <button type="button" className="settingsM-primary-btn" onClick={() => onApprove(item)} disabled={busyAction === `e2ee-transfer-approve:${item.id}`}>
          {busyAction === `e2ee-transfer-approve:${item.id}` ? 'Подтверждаем…' : 'Подтвердить перенос'}
        </button>
      </div>
    </div>
  );
}

function ActionPanel({ title, subtitle, children }) {
  return (
    <div className="settingsM-action-panel">
      <div className="settingsM-action-head">
        <div className="settingsM-action-title">{title}</div>
        {subtitle ? <div className="settingsM-action-subtitle">{subtitle}</div> : null}
      </div>
      {children}
    </div>
  );
}


function SensitiveActionModal({ action, form, busyAction, onChange, onClose, onSubmit }) {
  if (!action) return null;
  const isBusy = Boolean(busyAction);
  const needsPin = action.type === 'device-pin';
  const confirmLabel = action.confirmLabel || 'Подтвердить';
  return (
    <div className="settingsM-modalBackdrop" role="presentation">
      <div className="settingsM-modalCard" role="dialog" aria-modal="true" aria-labelledby="sensitive-action-title">
        <div className="settingsM-modalHandle" />
        <div className="settingsM-modalHead">
          <div>
            <div className="settingsM-modalKicker">Подтверждение действия</div>
            <div className="settingsM-modalTitle" id="sensitive-action-title">{action.title}</div>
            {action.subtitle ? <div className="settingsM-modalText">{action.subtitle}</div> : null}
          </div>
          <button type="button" className="settingsM-modalClose" onClick={onClose} disabled={isBusy} aria-label="Закрыть">×</button>
        </div>
        {action.warning ? <div className="settingsM-modalWarning">{action.warning}</div> : null}
        <form className="settingsM-modalForm" onSubmit={onSubmit}>
          {needsPin ? (
            <label className="settingsM-modalField">
              <span>Новый PIN устройства</span>
              <input
                className="settingsM-input"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                placeholder={action.pinPlaceholder || 'PIN'}
                value={form.pin}
                onChange={(event) => onChange({ pin: event.target.value })}
                autoFocus
              />
            </label>
          ) : null}
          <label className="settingsM-modalField">
            <span>Текущий пароль</span>
            <input
              className="settingsM-input"
              type="password"
              autoComplete="current-password"
              placeholder="Введите текущий пароль"
              value={form.password}
              onChange={(event) => onChange({ password: event.target.value })}
              autoFocus={!needsPin}
            />
          </label>
          <div className="settingsM-modalActions">
            <button type="button" className="settingsM-secondary-btn" onClick={onClose} disabled={isBusy}>Отмена</button>
            <button type="submit" className={`settingsM-primary-btn ${action.danger ? 'is-danger' : ''}`} disabled={isBusy}>
              {isBusy ? 'Выполняем…' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const initialCacheRef = useRef(null);
  const recoveryFileInputRef = useRef(null);
  const [user, setUser] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [devices, setDevices] = useState([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [securityStatus, setSecurityStatus] = useState(null);
  const [e2eeStatus, setE2eeStatus] = useState(null);
  const [e2eeTransferState, setE2eeTransferState] = useState(null);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [secretForm, setSecretForm] = useState({ password: '', secretAnswer: '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [codesPassword, setCodesPassword] = useState('');
  const [phrasePassword, setPhrasePassword] = useState('');
  const [passkeyForm, setPasskeyForm] = useState({ password: '', label: '' });
  const [passkeys, setPasskeys] = useState([]);
  const [freshPhrase, setFreshPhrase] = useState('');
  const [freshCodes, setFreshCodes] = useState([]);
  const [busyAction, setBusyAction] = useState('');
  const [supportForm, setSupportForm] = useState({ category: 'general', subject: '', message: '' });
  const [supportTickets, setSupportTickets] = useState([]);
  const [supportLoading, setSupportLoading] = useState(true);
  const [accountControlStatus, setAccountControlStatus] = useState(null);
  const [accountExportPassword, setAccountExportPassword] = useState('');
  const [accountDeletionForm, setAccountDeletionForm] = useState({ password: '', reason: '' });
  const [activeSupportView, setActiveSupportView] = useState('list');
  const [adminOverview, setAdminOverview] = useState(null);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminReports, setAdminReports] = useState([]);
  const [adminMessageReports, setAdminMessageReports] = useState([]);
  const [adminSafetyFlags, setAdminSafetyFlags] = useState([]);
  const [adminSupportTickets, setAdminSupportTickets] = useState([]);
  const [adminVerification, setAdminVerification] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminAction, setAdminAction] = useState('');
  const [sensitiveAction, setSensitiveAction] = useState(null);
  const [sensitiveForm, setSensitiveForm] = useState({ password: '', pin: '' });
  const [activeSettingsTab, setActiveSettingsTab] = useState('account');

  useLayoutEffect(() => {
    const cachedState = readPageCache(SETTINGS_CACHE_KEY, SETTINGS_CACHE_TTL);
    initialCacheRef.current = cachedState;
    if (!cachedState) return;
    setUser(cachedState.user || null);
    setSessions(Array.isArray(cachedState.sessions) ? cachedState.sessions : []);
    setDevices(Array.isArray(cachedState.devices) ? cachedState.devices : []);
    setDevicesLoading(false);
    setSecurityStatus(cachedState.securityStatus || null);
    setPasskeys(Array.isArray(cachedState.passkeys) ? cachedState.passkeys : []);
    setE2eeStatus(cachedState.e2eeStatus || null);
    setE2eeTransferState(cachedState.e2eeTransferState || null);
    setPreferences(cachedState.preferences || DEFAULT_PREFERENCES);
    setLoading(false);
    setSupportTickets(Array.isArray(cachedState.supportTickets) ? cachedState.supportTickets : []);
    setSupportLoading(false);
    setAccountControlStatus(cachedState.accountControlStatus || null);
    setAdminOverview(cachedState.adminOverview || null);
    setAdminUsers(Array.isArray(cachedState.adminUsers) ? cachedState.adminUsers : []);
    setAdminReports(Array.isArray(cachedState.adminReports) ? cachedState.adminReports : []);
    setAdminMessageReports(Array.isArray(cachedState.adminMessageReports) ? cachedState.adminMessageReports : []);
    setAdminSafetyFlags(Array.isArray(cachedState.adminSafetyFlags) ? cachedState.adminSafetyFlags : []);
    setAdminSupportTickets(Array.isArray(cachedState.adminSupportTickets) ? cachedState.adminSupportTickets : []);
    setAdminVerification(cachedState.adminVerification || null);
  }, []);

  const fullName = useMemo(() => {
    if (!user) return 'Пользователь';
    return `${user.first_name} ${user.last_name}`.trim();
  }, [user]);

  const visibleSettingsTab = activeSettingsTab === 'admin' && !user?.is_admin ? 'account' : activeSettingsTab;
  const tabClass = (tab, extra = '') => `settingsM-section${extra ? ` ${extra}` : ''}${visibleSettingsTab === tab ? '' : ' is-tab-hidden'}`;

  const loadSessionData = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const [sessionRes, sessionsRes, devicesRes, securityRes, passkeysRes, e2eeRes, supportData, preferencesRes, accountControlRes] = await Promise.all([
        fetch('/api/auth/session', { cache: 'no-store' }),
        fetch('/api/auth/sessions', { cache: 'no-store' }),
        fetch('/api/devices', { cache: 'no-store' }),
        fetch('/api/auth/security/status', { cache: 'no-store' }),
        fetch('/api/auth/passkeys', { cache: 'no-store' }),
        fetch(`/api/e2ee/status?deviceKeyId=${encodeURIComponent(getLocalE2EERecord()?.deviceKeyId || '')}`, { cache: 'no-store' }),
        fetch('/api/support/tickets?limit=10', { cache: 'no-store' }),
        fetch('/api/settings/preferences', { cache: 'no-store' }),
        fetch('/api/account/deletion', { cache: 'no-store' }),
      ]);

      if (sessionRes.status === 401) {
        router.replace('/');
        return;
      }

      const sessionData = await sessionRes.json();
      const sessionsData = await sessionsRes.json();
      const devicesData = await devicesRes.json().catch(() => ({}));
      const securityPayload = await securityRes.json().catch(() => ({}));
      const passkeysPayload = await passkeysRes.json().catch(() => ({}));
      const e2eePayload = await e2eeRes.json().catch(() => ({}));
      const supportPayload = await supportData.json().catch(() => ({}));
      const preferencesPayload = await preferencesRes.json().catch(() => ({}));
      const accountControlPayload = await accountControlRes.json().catch(() => ({}));

      if (!sessionRes.ok) throw new Error(sessionData.error || 'Не удалось получить пользователя.');
      if (!sessionsRes.ok) throw new Error(sessionsData.error || 'Не удалось получить список сессий.');

      setUser(sessionData.user);
      setSessions(sessionsData.sessions || []);
      if (devicesRes.ok) setDevices(devicesData.items || []);
      if (securityRes.ok) setSecurityStatus(securityPayload.status || null);
      if (passkeysRes.ok) setPasskeys(passkeysPayload.items || []);
      if (e2eeRes.ok) setE2eeStatus(e2eePayload.status || null);
      try {
        const transfer = await loadE2EETransferState(getLocalE2EERecord()?.deviceKeyId || '');
        setE2eeTransferState(transfer);
      } catch (transferError) {
        console.error('e2ee transfer preload failed', transferError);
      }
      if (supportData.ok) setSupportTickets(supportPayload.items || []);
      if (accountControlRes.ok) setAccountControlStatus(accountControlPayload.status || null);
      if (preferencesRes.ok) {
        const nextPreferences = { ...DEFAULT_PREFERENCES, ...(preferencesPayload.preferences || {}) };
        setPreferences(nextPreferences);
        applyVisualPreferences(nextPreferences);
      }

      if (sessionData?.user?.is_admin) {
        setAdminLoading(true);
        try {
          const [overviewRes, usersRes, reportsRes, messageReportsRes, safetyFlagsRes, ticketsRes, verificationRes] = await Promise.all([
            fetch('/api/admin/analytics/overview', { cache: 'no-store' }),
            fetch('/api/admin/users?limit=8', { cache: 'no-store' }),
            fetch('/api/admin/reports/posts?limit=6&status=new', { cache: 'no-store' }),
            fetch('/api/admin/reports/messages?limit=6&status=new', { cache: 'no-store' }),
            fetch('/api/admin/safety-flags?limit=6&status=open', { cache: 'no-store' }),
            fetch('/api/admin/support/tickets?limit=6&status=open', { cache: 'no-store' }),
            fetch('/api/admin/launch/verification', { cache: 'no-store' }),
          ]);
          const overviewPayload = await overviewRes.json().catch(() => ({}));
          const usersPayload = await usersRes.json().catch(() => ({}));
          const reportsPayload = await reportsRes.json().catch(() => ({}));
          const messageReportsPayload = await messageReportsRes.json().catch(() => ({}));
          const safetyFlagsPayload = await safetyFlagsRes.json().catch(() => ({}));
          const ticketsPayload = await ticketsRes.json().catch(() => ({}));
          const verificationPayload = await verificationRes.json().catch(() => ({}));
          if (overviewRes.ok) setAdminOverview(overviewPayload.overview || null);
          else setAdminOverview(null);
          if (usersRes.ok) setAdminUsers(usersPayload.items || []);
          else setAdminUsers([]);
          if (reportsRes.ok) setAdminReports(reportsPayload.items || []);
          else setAdminReports([]);
          if (messageReportsRes.ok) setAdminMessageReports(messageReportsPayload.items || []);
          else setAdminMessageReports([]);
          if (safetyFlagsRes.ok) setAdminSafetyFlags(safetyFlagsPayload.items || []);
          else setAdminSafetyFlags([]);
          if (ticketsRes.ok) setAdminSupportTickets(ticketsPayload.items || []);
          else setAdminSupportTickets([]);
          if (verificationRes.ok) setAdminVerification(verificationPayload.verification || null);
          else setAdminVerification(null);
        } catch (adminError) {
          console.error('admin settings load failed', adminError);
          setAdminOverview(null);
          setAdminUsers([]);
          setAdminReports([]);
          setAdminMessageReports([]);
          setAdminSafetyFlags([]);
          setAdminSupportTickets([]);
          setAdminVerification(null);
        } finally {
          setAdminLoading(false);
        }
      } else {
        setAdminOverview(null);
        setAdminUsers([]);
        setAdminReports([]);
        setAdminMessageReports([]);
        setAdminSafetyFlags([]);
        setAdminSupportTickets([]);
        setAdminVerification(null);
      }
    } catch (loadError) {
      console.warn('settings load fallback enabled', loadError?.message || loadError);
      setError('');
    } finally {
      setLoading(false);
      setDevicesLoading(false);
      setSupportLoading(false);
    }
  };

  useEffect(() => {
    loadSessionData({ silent: Boolean(initialCacheRef.current) });
  }, []);

  useEffect(() => {
    if (!user && !sessions.length && !devices.length && loading) return;
    writePageCache(SETTINGS_CACHE_KEY, {
      user,
      sessions,
      devices,
      securityStatus,
      passkeys,
      e2eeStatus,
      e2eeTransferState,
      supportTickets,
      adminOverview,
      adminUsers,
      adminReports,
      adminMessageReports,
      adminSafetyFlags,
      adminSupportTickets,
      adminVerification,
      preferences,
      accountControlStatus,
    });
  }, [user, sessions, devices, securityStatus, passkeys, e2eeStatus, e2eeTransferState, supportTickets, accountControlStatus, adminOverview, adminUsers, adminReports, adminMessageReports, adminSafetyFlags, adminSupportTickets, adminVerification, preferences, loading]);

  useEffect(() => {
    applyVisualPreferences(preferences);
  }, [preferences]);

  const loadSecurityStatus = async () => {
    try {
      const response = await fetch('/api/auth/security/status', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) setSecurityStatus(payload.status || null);
    } catch (securityError) {
      console.error('security status load failed', securityError);
    }
  };

  const loadPasskeys = async () => {
    try {
      const response = await fetch('/api/auth/passkeys', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) setPasskeys(payload.items || []);
    } catch (passkeyError) {
      console.error('passkeys load failed', passkeyError);
    }
  };

  const loadE2EEStatus = async (deviceKeyId = '') => {
    try {
      const response = await fetch(`/api/e2ee/status?deviceKeyId=${encodeURIComponent(deviceKeyId || getLocalE2EERecord()?.deviceKeyId || '')}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) setE2eeStatus(payload.status || null);
    } catch (e2eeError) {
      console.error('e2ee status load failed', e2eeError);
    }
  };

  const loadE2EETransfer = async (deviceKeyId = '') => {
    try {
      const transfer = await loadE2EETransferState(deviceKeyId || getLocalE2EERecord()?.deviceKeyId || '');
      setE2eeTransferState(transfer);
    } catch (e2eeError) {
      console.error('e2ee transfer load failed', e2eeError);
    }
  };


  const loadAccountControlStatus = async () => {
    try {
      const response = await fetch('/api/account/deletion', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) setAccountControlStatus(payload.status || null);
    } catch (accountError) {
      console.error('account control status load failed', accountError);
    }
  };

  const downloadAccountExport = (data) => {
    const content = JSON.stringify(data, null, 2);
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'friendscape-data-export.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleE2EEBootstrap = async () => {
    clearAlerts();
    try {
      setBusyAction('e2ee-bootstrap');
      const payload = await registerCurrentE2EEDevice();
      setE2eeStatus(payload?.status || null);
      await loadE2EETransfer(payload?.status?.current_device?.device_key_id || getLocalE2EERecord()?.deviceKeyId || '');
      const trusted = Boolean(payload?.status?.current_device?.is_trusted);
      const requiresTransfer = Boolean(payload?.status?.requires_transfer);
      if (requiresTransfer) {
        setMessage('Устройство зарегистрировано. Для старой истории ещё понадобится перенос со старого доверенного устройства или recovery file.');
      } else if (trusted) {
        setMessage('Текущее устройство подготовлено для защищённых чатов.');
      } else {
        setMessage('Локальные ключи устройства обновлены.');
      }
    } catch (e2eeError) {
      setError(e2eeError.message || 'Не удалось подготовить устройство для защищённых чатов.');
    } finally {
      setBusyAction('');
    }
  };

  const handleSaveRecoveryFile = async () => {
    clearAlerts();
    try {
      setBusyAction('e2ee-recovery');
      await registerCurrentE2EEDevice();
      const bundle = await createRecoveryBundle();
      const payload = await saveRecoveryBundleToServer(bundle);
      downloadRecoveryFile(bundle);
      setE2eeStatus(payload?.status || null);
      await loadE2EETransfer(payload?.status?.current_device?.device_key_id || getLocalE2EERecord()?.deviceKeyId || '');
      setMessage('Recovery file сохранён. Храните его отдельно от устройства.');
    } catch (e2eeError) {
      setError(e2eeError.message || 'Не удалось сохранить recovery file.');
    } finally {
      setBusyAction('');
    }
  };


  const handleRestoreRecoveryFile = async (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;
    clearAlerts();
    try {
      setBusyAction('e2ee-restore');
      const recoveryText = await file.text();
      const backupResponse = await fetch('/api/e2ee/backup', { cache: 'no-store' });
      const backupPayload = await backupResponse.json().catch(() => ({}));
      if (!backupResponse.ok || !backupPayload?.backup?.encrypted_blob) {
        throw new Error(backupPayload?.error || 'На сервере не найден зашифрованный backup ключей.');
      }
      const record = await restoreLocalE2EEFromRecoveryFile(recoveryText, backupPayload.backup.encrypted_blob);
      const registered = await registerCurrentE2EEDevice({ record, trustDevice: true });
      await fetch('/api/e2ee/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_restored' }),
      }).catch(() => null);
      setE2eeStatus(registered?.status || null);
      await loadE2EETransfer(registered?.status?.current_device?.device_key_id || record?.deviceKeyId || getLocalE2EERecord()?.deviceKeyId || '');
      setMessage('Локальные ключи восстановлены из recovery file. Это устройство снова может читать защищённые чаты.');
    } catch (e2eeError) {
      setError(e2eeError.message || 'Не удалось восстановить защищённые чаты из recovery file.');
    } finally {
      if (event?.target) event.target.value = '';
      setBusyAction('');
    }
  };


  const handlePreferencesSave = async () => {
    clearAlerts();
    try {
      setBusyAction('preferences');
      const response = await fetch('/api/settings/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Не удалось сохранить настройки.');
      const nextPreferences = { ...DEFAULT_PREFERENCES, ...(payload.preferences || {}) };
      setPreferences(nextPreferences);
      applyVisualPreferences(nextPreferences);
      setMessage(payload.message || 'Настройки приватности сохранены.');
    } catch (saveError) {
      setError(saveError.message || 'Не удалось сохранить настройки приватности.');
    } finally {
      setBusyAction('');
    }
  };

  const setPreference = (key, value) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
  };

  const clearAlerts = () => {
    setError('');
    setMessage('');
  };


  const handleRequestDeviceTransfer = async () => {
    clearAlerts();
    try {
      setBusyAction('e2ee-transfer-request');
      const registered = await registerCurrentE2EEDevice();
      setE2eeStatus(registered?.status || null);
      const transferPayload = await requestE2EEDeviceTransfer();
      setE2eeTransferState(transferPayload?.transfer || null);
      setMessage('Запрос создан. Откройте Friendscape на старом доверенном устройстве и подтвердите перенос защищённых чатов.');
    } catch (e2eeError) {
      setError(e2eeError.message || 'Не удалось запросить перенос со старого устройства.');
    } finally {
      setBusyAction('');
    }
  };

  const handleApproveDeviceTransfer = async (item) => {
    clearAlerts();
    const key = `e2ee-transfer-approve:${item.id}`;
    try {
      setBusyAction(key);
      const payload = await approveE2EEDeviceTransfer(item);
      setE2eeTransferState(payload?.transfer || null);
      await loadE2EEStatus(getLocalE2EERecord()?.deviceKeyId || '');
      setMessage('Перенос подтверждён. Теперь откройте новое устройство и примите защищённые чаты.');
    } catch (e2eeError) {
      setError(e2eeError.message || 'Не удалось подтвердить перенос на новое устройство.');
    } finally {
      setBusyAction('');
    }
  };

  const handleAcceptDeviceTransfer = async () => {
    clearAlerts();
    try {
      setBusyAction('e2ee-transfer-accept');
      const transferRequest = e2eeTransferState?.ready_transfer || e2eeTransferState?.outgoing_request;
      if (!transferRequest?.transfer_package) {
        throw new Error('На сервере ещё нет подтверждённого пакета переноса для этого устройства.');
      }
      const restoredRecord = await restoreLocalE2EEFromTransferPackage(transferRequest);
      const registered = await registerCurrentE2EEDevice({ record: restoredRecord, trustDevice: true });
      await completeE2EEDeviceTransfer(transferRequest.id, restoredRecord.deviceKeyId);
      setE2eeStatus(registered?.status || null);
      await loadE2EETransfer(restoredRecord.deviceKeyId);
      setMessage('Перенос завершён. Это устройство теперь читает старые защищённые чаты.');
    } catch (e2eeError) {
      setError(e2eeError.message || 'Не удалось принять перенос защищённых чатов.');
    } finally {
      setBusyAction('');
    }
  };

  const handleAdminReportStatus = async (item, status) => {
    clearAlerts();
    const key = `report:${item.id}:${status}`;
    try {
      setAdminAction(key);
      const response = await fetch(`/api/admin/reports/posts/${item.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Не удалось обновить жалобу.');
      setAdminReports((prev) => prev.filter((row) => row.id !== item.id));
      setMessage(payload.message || 'Статус жалобы обновлён.');
      loadSessionData();
    } catch (adminError) {
      setError(adminError.message || 'Не удалось обновить жалобу.');
    } finally {
      setAdminAction('');
    }
  };

  const handleAdminMessageReportStatus = async (item, status) => {
    clearAlerts();
    const key = `message-report:${item.id}:${status}`;
    try {
      setAdminAction(key);
      const response = await fetch(`/api/admin/reports/messages/${item.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Не удалось обновить жалобу на сообщение.');
      setAdminMessageReports((prev) => prev.filter((row) => row.id !== item.id));
      setMessage(payload.message || 'Статус жалобы на сообщение обновлён.');
      loadSessionData();
    } catch (adminError) {
      setError(adminError.message || 'Не удалось обновить жалобу на сообщение.');
    } finally {
      setAdminAction('');
    }
  };

  const handleAdminSafetyFlagStatus = async (item, status) => {
    clearAlerts();
    const key = `safety-flag:${item.id}:${status}`;
    try {
      setAdminAction(key);
      const response = await fetch(`/api/admin/safety-flags/${item.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Не удалось обновить safety-флаг.');
      setAdminSafetyFlags((prev) => prev.filter((row) => row.id !== item.id));
      setMessage(payload.message || 'Статус safety-флага обновлён.');
      loadSessionData();
    } catch (adminError) {
      setError(adminError.message || 'Не удалось обновить safety-флаг.');
    } finally {
      setAdminAction('');
    }
  };

  const handleAdminTicketStatus = async (item, status) => {
    clearAlerts();
    const key = `ticket:${item.id}:${status}`;
    try {
      setAdminAction(key);
      const response = await fetch(`/api/admin/support/tickets/${item.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Не удалось обновить тикет.');
      setAdminSupportTickets((prev) => prev.map((row) => (row.id === item.id ? payload.ticket || row : row)).filter((row) => row.status === 'open'));
      setMessage(payload.message || 'Статус тикета обновлён.');
      loadSessionData();
    } catch (adminError) {
      setError(adminError.message || 'Не удалось обновить тикет.');
    } finally {
      setAdminAction('');
    }
  };

  const handleLogout = async () => {
    clearAlerts();
    try {
      setBusyAction('logout');
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось выйти из аккаунта.');
      router.replace('/');
    } catch (logoutError) {
      setError(logoutError.message || 'Не удалось выйти из аккаунта.');
    } finally {
      setBusyAction('');
    }
  };

  const handleLogoutAll = async () => {
    clearAlerts();
    try {
      setBusyAction('logoutAll');
      const response = await fetch('/api/auth/logout-all', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось завершить все сессии.');
      router.replace('/');
    } catch (logoutAllError) {
      setError(logoutAllError.message || 'Не удалось завершить все сессии.');
    } finally {
      setBusyAction('');
    }
  };

  const handleSecretSubmit = async (event) => {
    event.preventDefault();
    clearAlerts();
    if (!secretForm.password || !secretForm.secretAnswer) {
      setError('Введите пароль и новый секретный ответ.');
      return;
    }
    try {
      setBusyAction('secret');
      const endpoint = securityStatus?.has_secret_answer ? '/api/auth/security/update-secret' : '/api/auth/security/setup';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: secretForm.password,
          secret_answer: secretForm.secretAnswer,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить секретный ответ.');
      setMessage(data.message || 'Секретный ответ обновлён.');
      setSecretForm({ password: '', secretAnswer: '' });
      if (Array.isArray(data.backup_codes) && data.backup_codes.length) setFreshCodes(data.backup_codes);
      await loadSecurityStatus();
    } catch (submitError) {
      setError(submitError.message || 'Не удалось обновить секретный ответ.');
    } finally {
      setBusyAction('');
    }
  };

  const handlePasswordSubmit = async (event) => {
    event.preventDefault();
    clearAlerts();
    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setError('Заполни текущий пароль и новый пароль дважды.');
      return;
    }
    try {
      setBusyAction('password');
      const response = await fetch('/api/auth/password/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: passwordForm.currentPassword,
          new_password: passwordForm.newPassword,
          confirm_password: passwordForm.confirmPassword,
          logout_other_sessions: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось обновить пароль.');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setMessage(data.message || 'Пароль обновлён.');
      await loadSessionData();
    } catch (passwordError) {
      setError(passwordError.message || 'Не удалось обновить пароль.');
    } finally {
      setBusyAction('');
    }
  };

  const handleCodesRegenerate = async (event) => {
    event.preventDefault();
    clearAlerts();
    if (!codesPassword) {
      setError('Введите пароль, чтобы перевыпустить резервные коды.');
      return;
    }
    try {
      setBusyAction('codes');
      const response = await fetch('/api/auth/security/regenerate-backup-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: codesPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось перевыпустить резервные коды.');
      setFreshCodes(data.backup_codes || []);
      setCodesPassword('');
      setMessage(data.message || 'Резервные коды перевыпущены. Сохраните их.');
      await loadSecurityStatus();
    } catch (codesError) {
      setError(codesError.message || 'Не удалось перевыпустить резервные коды.');
    } finally {
      setBusyAction('');
    }
  };


  const handleRecoveryPhraseGenerate = async (event) => {
    event.preventDefault();
    clearAlerts();
    setFreshPhrase('');
    if (!phrasePassword) {
      setError('Введите пароль, чтобы создать recovery-фразу.');
      return;
    }
    try {
      setBusyAction('recovery-phrase');
      const response = await fetch('/api/auth/security/recovery-phrase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: phrasePassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось создать recovery-фразу.');
      setFreshPhrase(data.recovery_phrase || '');
      setPhrasePassword('');
      setMessage(data.message || 'Recovery-фраза создана. Сохраните её сейчас.');
      await loadSecurityStatus();
    } catch (phraseError) {
      setError(phraseError.message || 'Не удалось создать recovery-фразу.');
    } finally {
      setBusyAction('');
    }
  };

  const handlePasskeyRegister = async (event) => {
    event.preventDefault();
    clearAlerts();
    if (!passkeyForm.password) {
      setError('Введите текущий пароль, чтобы добавить passkey.');
      return;
    }
    try {
      setBusyAction('passkey-register');
      const payload = await registerPasskey({ password: passkeyForm.password, label: passkeyForm.label || 'Мой passkey' });
      setPasskeyForm({ password: '', label: '' });
      setMessage(payload.message || 'Passkey добавлен.');
      await Promise.all([loadSecurityStatus(), loadPasskeys()]);
    } catch (passkeyError) {
      setError(passkeyError.message || 'Не удалось добавить passkey.');
    } finally {
      setBusyAction('');
    }
  };

  const closeSensitiveAction = () => {
    if (busyAction) return;
    setSensitiveAction(null);
    setSensitiveForm({ password: '', pin: '' });
  };

  const updateSensitiveForm = (patch) => {
    setSensitiveForm((prev) => ({ ...prev, ...patch }));
  };

  const openPasskeyDisable = (item) => {
    clearAlerts();
    setSensitiveForm({ password: '', pin: '' });
    setSensitiveAction({
      type: 'passkey-disable',
      item,
      title: `Отключить passkey «${item.label || 'Passkey'}»?`,
      subtitle: 'Этот способ входа и восстановления перестанет работать для выбранного устройства.',
      warning: 'Для подтверждения нужен текущий пароль аккаунта.',
      confirmLabel: 'Отключить passkey',
      danger: true,
    });
  };

  const openDevicePin = (device) => {
    clearAlerts();
    setSensitiveForm({ password: '', pin: '' });
    setSensitiveAction({
      type: 'device-pin',
      item: device,
      title: device.has_pin ? 'Сменить PIN доверенного устройства' : 'Задать PIN доверенного устройства',
      subtitle: `${device.label || 'Устройство'} · PIN используется для восстановления доступа без email и телефона.`,
      warning: 'PIN должен быть сохранён отдельно. Для изменения нужен текущий пароль.',
      pinPlaceholder: device.has_pin ? 'Новый PIN' : 'PIN для устройства',
      confirmLabel: device.has_pin ? 'Сменить PIN' : 'Задать PIN',
    });
  };

  const openDeviceDelete = (device) => {
    clearAlerts();
    setSensitiveForm({ password: '', pin: '' });
    setSensitiveAction({
      type: 'device-delete',
      item: device,
      title: `Отключить устройство «${device.label || 'Устройство'}»?`,
      subtitle: 'Все активные сессии этого устройства будут завершены.',
      warning: device.is_current ? 'Это текущее устройство. После отключения тебя вернёт на экран входа.' : 'Устройство потеряет доступ к аккаунту до нового входа.',
      confirmLabel: 'Отключить устройство',
      danger: true,
    });
  };

  const handlePasskeyDisable = (item) => {
    openPasskeyDisable(item);
  };

  const handleDevicePin = (device) => {
    openDevicePin(device);
  };

  const handleDeviceDelete = (device) => {
    openDeviceDelete(device);
  };

  const handleSensitiveActionSubmit = async (event) => {
    event.preventDefault();
    const action = sensitiveAction;
    if (!action?.type || !action?.item) return;
    clearAlerts();
    const password = sensitiveForm.password;
    const pin = sensitiveForm.pin;
    if (!password) {
      setError('Введите текущий пароль для подтверждения действия.');
      return;
    }
    if (action.type === 'device-pin' && !pin) {
      setError('Введите PIN для доверенного устройства.');
      return;
    }

    try {
      if (action.type === 'passkey-disable') {
        const item = action.item;
        setBusyAction(`passkey:${item.id}`);
        const response = await fetch(`/api/auth/passkeys/${item.id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Не удалось отключить passkey.');
        setPasskeys((prev) => prev.filter((row) => row.id !== item.id));
        setMessage(payload.message || 'Passkey отключён.');
        setSensitiveAction(null);
        setSensitiveForm({ password: '', pin: '' });
        await loadSecurityStatus();
        return;
      }

      if (action.type === 'device-pin') {
        const device = action.item;
        setBusyAction(`pin:${device.id}`);
        const response = await fetch(`/api/devices/${device.id}/pin`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin, password }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Не удалось обновить PIN устройства.');
        setDevices((prev) => prev.map((item) => item.id === device.id ? { ...item, has_pin: true } : item));
        setMessage(data.message || 'PIN устройства обновлён.');
        setSensitiveAction(null);
        setSensitiveForm({ password: '', pin: '' });
        await loadSecurityStatus();
        return;
      }

      if (action.type === 'device-delete') {
        const device = action.item;
        setBusyAction(`device:${device.id}`);
        const response = await fetch(`/api/devices/${device.id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Не удалось отключить устройство.');
        setDevices((prev) => prev.filter((item) => item.id !== device.id));
        setSessions((prev) => device.is_current ? [] : prev);
        setMessage(data.message || 'Устройство отключено.');
        setSensitiveAction(null);
        setSensitiveForm({ password: '', pin: '' });
        if (device.is_current) {
          router.replace('/');
          return;
        }
      }
    } catch (modalError) {
      setError(modalError.message || 'Не удалось выполнить действие.');
    } finally {
      setBusyAction('');
    }
  };

  const handleAccountExport = async (event) => {
    event.preventDefault();
    clearAlerts();
    if (!accountExportPassword) {
      setError('Введите текущий пароль для экспорта данных.');
      return;
    }
    try {
      setBusyAction('account-export');
      const response = await fetch('/api/account/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: accountExportPassword }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Не удалось подготовить экспорт.');
      downloadAccountExport(payload.data);
      setAccountExportPassword('');
      setMessage('Экспорт подготовлен и скачан как JSON-файл.');
    } catch (exportError) {
      setError(exportError.message || 'Не удалось подготовить экспорт.');
    } finally {
      setBusyAction('');
    }
  };

  const runAccountDeletionAction = async (action) => {
    clearAlerts();
    if (!accountDeletionForm.password) {
      setError('Введите текущий пароль для действия с аккаунтом.');
      return;
    }
    try {
      setBusyAction('account-' + action);
      const response = await fetch('/api/account/deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, password: accountDeletionForm.password, reason: accountDeletionForm.reason }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Не удалось выполнить действие.');
      setAccountControlStatus(payload.status || null);
      setAccountDeletionForm({ password: '', reason: '' });
      setMessage(payload.message || 'Готово.');
      await loadAccountControlStatus();
    } catch (accountError) {
      setError(accountError.message || 'Не удалось выполнить действие.');
    } finally {
      setBusyAction('');
    }
  };
  const openBetaFeedbackForm = () => {
    clearAlerts();
    setActiveSupportView('form');
    setSupportForm((prev) => ({
      ...prev,
      category: 'beta_feedback',
      subject: prev.subject || 'Отзыв о публичной бете',
    }));
  };

  const handleSupportSubmit = async (event) => {
    event.preventDefault();
    clearAlerts();

    const payload = {
      category: supportForm.category,
      subject: supportForm.subject,
      message: supportForm.message,
    };

    if (!String(payload.message || '').trim()) {
      setError('Опиши проблему перед отправкой обращения.');
      return;
    }

    try {
      setBusyAction('support');
      const response = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось отправить обращение.');
      setSupportTickets((prev) => [data.ticket, ...prev].slice(0, 10));
      setSupportForm({ category: 'general', subject: '', message: '' });
      setMessage(data.message || 'Обращение отправлено.');
      setActiveSupportView('list');
    } catch (supportError) {
      setError(supportError.message || 'Не удалось отправить обращение.');
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div className="app-shell">
      <div className="app profile-app settingsM-app">
        <main className="screen settingsM-screen">
          <section className="settingsM-hero">
            <div className="settingsM-title">Настройки</div>
            <div className="settingsM-subtitle">Безопасность и управление сессиями без лишнего шума.</div>
          </section>

          <section className="settingsM-profile-card">
            <div className="settingsM-avatar">{fullName.charAt(0).toUpperCase()}</div>
            <div className="settingsM-profile-main">
              <div className="settingsM-profile-name">{loading ? 'Загрузка...' : fullName}</div>
              <div className="settingsM-profile-meta">{user ? `@${user.first_name.toLowerCase()}.${user.last_name.toLowerCase()}` : 'Текущая учётная запись'}</div>
            </div>
            <button type="button" className="settingsM-edit-btn" onClick={() => router.push('/profile')}>Профиль</button>
          </section>

          {error ? <div className="settingsM-alert is-error">{error}</div> : null}

          <SettingsTabs active={visibleSettingsTab} onChange={setActiveSettingsTab} isAdmin={Boolean(user?.is_admin)} />

          <section className={tabClass('account')}>
            <div className="settingsM-section-title">Активные сессии</div>
            <div className="settingsM-card">
              {sessions.length ? sessions.map((item) => <SessionRow key={item.id} item={item} />) : (
                <div className="settingsM-empty">Активные сессии появятся здесь после входов в аккаунт.</div>
              )}
            </div>
            <ActionPanel
              title="Управление входами"
              subtitle="Можно завершить только текущую сессию или сразу все активные входы."
            >
              <div className="settingsM-action-row">
                <button type="button" className="settingsM-primary-btn" onClick={handleLogout} disabled={busyAction === 'logout'}>
                  {busyAction === 'logout' ? 'Выходим...' : 'Выйти из текущей сессии'}
                </button>
                <button type="button" className="settingsM-secondary-btn" onClick={handleLogoutAll} disabled={busyAction === 'logoutAll'}>
                  {busyAction === 'logoutAll' ? 'Завершаем...' : 'Выйти везде'}
                </button>
              </div>
            </ActionPanel>
          </section>

          <section className={tabClass('account')}>
            <div className="settingsM-section-title">Устройства</div>
            <div className="settingsM-card">
              {devicesLoading ? (
                <div className="settingsM-empty">Загружаем устройства…</div>
              ) : devices.length ? devices.map((item) => (
                <DeviceRow
                  key={item.id}
                  item={item}
                  onSetPin={handleDevicePin}
                  onDelete={handleDeviceDelete}
                  busyAction={busyAction}
                />
              )) : (
                <div className="settingsM-empty">Устройства появятся здесь после входа в аккаунт с браузера или телефона.</div>
              )}
            </div>
            <ActionPanel
              title="Контроль устройств"
              subtitle="Можно задать PIN на конкретное устройство и отключить старые или подозрительные входы без тотального выхода из аккаунта."
            >
              <div className="settingsM-action-row">
                <button type="button" className="settingsM-secondary-btn" onClick={loadSessionData}>
                  Обновить список
                </button>
              </div>
            </ActionPanel>
          </section>

          <section className={tabClass('security')}>
            <div className="settingsM-section-title">Защищённые чаты</div>
            <div className="settingsM-card">
              <div className="settingsM-row static-row">
                <div className="settingsM-row-icon"><ShieldIcon /></div>
                <div className="settingsM-row-text">
                  <div className="settingsM-row-title">Сквозное шифрование по умолчанию</div>
                  <div className="settingsM-row-subtitle">
                    {e2eeStatus?.ready
                      ? 'Текущее устройство уже готово для защищённых переписок.'
                      : e2eeStatus?.requires_transfer
                        ? 'Устройство зарегистрировано, но для старой истории ещё нужен перенос со старого доверенного устройства или recovery file.'
                        : 'Подготовьте локальные ключи и сохраните recovery file на случай потери устройства.'}
                  </div>
                </div>
              </div>
              <div className="settingsM-deviceMetaRow">
                <span className="settingsM-deviceMeta">{e2eeStatus?.has_recovery_file ? 'Recovery file сохранён' : 'Recovery file не сохранён'}</span>
                <span className="settingsM-deviceMeta">{`${e2eeStatus?.trusted_device_count || 0} доверенных устройств`}</span>
                {e2eeStatus?.current_device?.device_key_id ? <span className="settingsM-deviceMeta">ID {String(e2eeStatus.current_device.device_key_id).slice(0, 8)}</span> : null}
              </div>
              <div className="settingsM-action-row">
                <button type="button" className="settingsM-secondary-btn" onClick={handleE2EEBootstrap} disabled={busyAction === 'e2ee-bootstrap'}>
                  {busyAction === 'e2ee-bootstrap' ? 'Готовим…' : e2eeStatus?.current_device ? 'Обновить устройство' : 'Подготовить устройство'}
                </button>
                {e2eeStatus?.requires_transfer ? (
                  <button type="button" className="settingsM-primary-btn" onClick={handleRequestDeviceTransfer} disabled={busyAction === 'e2ee-transfer-request'}>
                    {busyAction === 'e2ee-transfer-request' ? 'Запрашиваем…' : 'Запросить перенос со старого'}
                  </button>
                ) : null}
                <button type="button" className="settingsM-primary-btn" onClick={handleSaveRecoveryFile} disabled={busyAction === 'e2ee-recovery'}>
                  {busyAction === 'e2ee-recovery' ? 'Сохраняем…' : 'Сохранить recovery file'}
                </button>
                <button type="button" className="settingsM-secondary-btn" onClick={() => recoveryFileInputRef.current?.click()} disabled={busyAction === 'e2ee-restore'}>
                  {busyAction === 'e2ee-restore' ? 'Восстанавливаем…' : 'Восстановить из recovery file'}
                </button>
                <input
                  ref={recoveryFileInputRef}
                  type="file"
                  accept="application/json"
                  style={{ display: 'none' }}
                  onChange={handleRestoreRecoveryFile}
                />
              </div>

              {(e2eeTransferState?.ready_transfer || e2eeTransferState?.outgoing_request || e2eeTransferState?.incoming_requests?.length) ? (
                <div className="settingsM-card" style={{ marginTop: 10 }}>
                  {e2eeTransferState?.ready_transfer?.transfer_package ? (
                    <div className="settingsM-action-panel" style={{ marginBottom: 10 }}>
                      <div className="settingsM-action-head">
                        <div className="settingsM-action-title">Пакет переноса готов</div>
                        <div className="settingsM-action-subtitle">Старое доверенное устройство уже подтвердило перенос этой истории.</div>
                      </div>
                      <div className="settingsM-action-row">
                        <button type="button" className="settingsM-primary-btn" onClick={handleAcceptDeviceTransfer} disabled={busyAction === 'e2ee-transfer-accept'}>
                          {busyAction === 'e2ee-transfer-accept' ? 'Подключаем…' : 'Принять защищённые чаты'}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {e2eeTransferState?.outgoing_request ? (
                    <div className="settingsM-action-panel" style={{ marginBottom: e2eeTransferState?.incoming_requests?.length ? 10 : 0 }}>
                      <div className="settingsM-action-head">
                        <div className="settingsM-action-title">Запрос на этом устройстве уже создан</div>
                        <div className="settingsM-action-subtitle">Откройте Friendscape на старом доверенном устройстве и подтвердите перенос защищённых чатов.</div>
                      </div>
                      <div className="settingsM-deviceMetaRow">
                        <span className="settingsM-deviceMeta">Истекает {new Date(e2eeTransferState.outgoing_request.expires_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                        {e2eeTransferState.outgoing_request.package_ready ? <span className="settingsM-deviceMeta">Пакет уже готов</span> : <span className="settingsM-deviceMeta">Ожидает подтверждения</span>}
                      </div>
                    </div>
                  ) : null}

                  {e2eeTransferState?.incoming_requests?.length ? (
                    <>
                      <div className="settingsM-section-title" style={{ marginBottom: 8 }}>Подтвердить на этом доверенном устройстве</div>
                      {e2eeTransferState.incoming_requests.map((item) => (
                        <TransferRequestRow key={item.id} item={item} onApprove={handleApproveDeviceTransfer} busyAction={busyAction} />
                      ))}
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>


          <section className={tabClass('privacy')}>
            <div className="settingsM-section-title">Приватность профиля</div>
            <ActionPanel title="Профиль и публичные разделы" subtitle="Эти настройки переехали сюда из редактора профиля. Сам профиль редактируется отдельно, а видимость управляется в одном месте.">
              <div className="settingsM-form">
                <PrivacySelect
                  label="Профиль"
                  value={preferences.profile_visibility}
                  onChange={(event) => setPreference('profile_visibility', event.target.value)}
                  options={[
                    { value: 'everyone', label: 'Видят все' },
                    { value: 'connections', label: 'Только мой круг' },
                    { value: 'friends', label: 'Только друзья' },
                    { value: 'nobody', label: 'Никто, кроме меня' },
                  ]}
                />
                <PrivacySelect
                  label="Фото и медиа"
                  value={preferences.photo_visibility}
                  onChange={(event) => setPreference('photo_visibility', event.target.value)}
                  options={[
                    { value: 'everyone', label: 'Видят все' },
                    { value: 'connections', label: 'Мой круг' },
                    { value: 'friends', label: 'Только друзья' },
                    { value: 'nobody', label: 'Скрыть от всех' },
                  ]}
                />
                <PrivacySelect
                  label="Онлайн и активность"
                  value={preferences.activity_visibility}
                  onChange={(event) => setPreference('activity_visibility', event.target.value)}
                  options={[
                    { value: 'everyone', label: 'Видят все' },
                    { value: 'connections', label: 'Только мой круг' },
                    { value: 'friends', label: 'Только друзья' },
                    { value: 'nobody', label: 'Не показывать' },
                  ]}
                />
                <PrivacySelect
                  label="Сообщества в профиле"
                  value={preferences.community_visibility}
                  onChange={(event) => setPreference('community_visibility', event.target.value)}
                  options={[
                    { value: 'everyone', label: 'Видят все' },
                    { value: 'connections', label: 'Только мой круг' },
                    { value: 'friends', label: 'Только друзья' },
                    { value: 'nobody', label: 'Не показывать' },
                  ]}
                />
              </div>
              <div className="settingsM-action-row">
                <button type="button" className="settingsM-primary-btn" onClick={handlePreferencesSave} disabled={busyAction === 'preferences'}>
                  {busyAction === 'preferences' ? 'Сохраняем…' : 'Сохранить приватность профиля'}
                </button>
              </div>
            </ActionPanel>

            <ActionPanel title="Переписка и первый контакт" subtitle="Отдельно настройте, кто может написать первым и нужны ли запросы на переписку.">
              <div className="settingsM-card">
                <ToggleRow
                  title="Запросы на переписку"
                  subtitle="Если выключить, пользователи вне разрешённого круга не смогут отправить даже первый запрос."
                  checked={preferences.message_requests_enabled}
                  onToggle={() => setPreference('message_requests_enabled', !preferences.message_requests_enabled)}
                />
              </div>
              <div className="settingsM-form" style={{ marginTop: 10 }}>
                <PrivacySelect
                  label="Кто может написать первым"
                  value={preferences.message_permission}
                  onChange={(event) => setPreference('message_permission', event.target.value)}
                  options={[
                    { value: 'everyone', label: 'Любой пользователь' },
                    { value: 'connections', label: 'Только мой круг' },
                    { value: 'friends', label: 'Только друзья' },
                    { value: 'requests_only', label: 'Только через запрос' },
                  ]}
                />
              </div>
              <div className="settingsM-action-row">
                <button type="button" className="settingsM-primary-btn" onClick={handlePreferencesSave} disabled={busyAction === 'preferences'}>
                  {busyAction === 'preferences' ? 'Сохраняем…' : 'Сохранить настройки переписки'}
                </button>
              </div>
            </ActionPanel>
          </section>

          <section className={tabClass('privacy')}>
            <div className="settingsM-section-title">Уведомления</div>
            <div className="settingsM-card">
              <ToggleRow title="Новые сообщения" subtitle="Личные сообщения и звонки." checked={preferences.notify_messages} onToggle={() => setPreference('notify_messages', !preferences.notify_messages)} />
              <ToggleRow title="Запросы на переписку" subtitle="Когда кто-то пытается написать впервые." checked={preferences.notify_message_requests} onToggle={() => setPreference('notify_message_requests', !preferences.notify_message_requests)} />
              <ToggleRow title="Комментарии" subtitle="Ответы и новые комментарии к вашим постам." checked={preferences.notify_comments} onToggle={() => setPreference('notify_comments', !preferences.notify_comments)} />
              <ToggleRow title="Реакции" subtitle="Лайки и реакции на посты и комментарии." checked={preferences.notify_reactions} onToggle={() => setPreference('notify_reactions', !preferences.notify_reactions)} />
              <ToggleRow title="Подписки и друзья" subtitle="Подписки, заявки и подтверждения дружбы." checked={preferences.notify_follows} onToggle={() => setPreference('notify_follows', !preferences.notify_follows)} />
            </div>
            <ActionPanel title="Тихий режим без хаоса" subtitle="Можно быстро убрать шумные категории, не трогая безопасность и системные действия.">
              <div className="settingsM-action-row">
                <button type="button" className="settingsM-primary-btn" onClick={handlePreferencesSave} disabled={busyAction === 'preferences'}>
                  {busyAction === 'preferences' ? 'Сохраняем…' : 'Сохранить уведомления'}
                </button>
              </div>
            </ActionPanel>
          </section>

          <section className={tabClass('appearance')}>
            <div className="settingsM-section-title">Внешний вид и доступность</div>
            <ActionPanel title="Видимость и комфорт" subtitle="Это сохраняется в браузере и применяется ко всем экранам Friendscape на этом устройстве.">
              <div className="settingsM-form">
                <PrivacySelect
                  label="Тема"
                  value={preferences.appearance}
                  onChange={(event) => setPreference('appearance', event.target.value)}
                  options={[
                    { value: 'system', label: 'Как в системе' },
                    { value: 'light', label: 'Светлая' },
                    { value: 'dark', label: 'Тёмная' },
                  ]}
                />
                <PrivacySelect
                  label="Режим зрения"
                  value={preferences.vision_mode}
                  onChange={(event) => setPreference('vision_mode', event.target.value)}
                  options={[
                    { value: 'none', label: 'Обычный' },
                    { value: 'protanopia', label: 'Протанопия' },
                    { value: 'deuteranopia', label: 'Дейтеранопия' },
                    { value: 'tritanopia', label: 'Тританопия' },
                    { value: 'achromatopsia', label: 'Ахроматопсия' },
                  ]}
                />
              </div>
              <div className="settingsM-card" style={{ marginTop: 8 }}>
                <ToggleRow title="Уменьшить анимации" subtitle="Сгладит резкие motion-эффекты и уберёт лишние переходы." checked={preferences.reduced_motion} onToggle={() => setPreference('reduced_motion', !preferences.reduced_motion)} />
              </div>
              <div className="settingsM-action-row">
                <button type="button" className="settingsM-primary-btn" onClick={handlePreferencesSave} disabled={busyAction === 'preferences'}>
                  {busyAction === 'preferences' ? 'Сохраняем…' : 'Сохранить внешний вид'}
                </button>
              </div>
            </ActionPanel>
          </section>

          <section className={tabClass('security')}>
            <div className="settingsM-section-title">Безопасность</div>
            <div className="settingsM-card">
              <div className="settingsM-row static-row">
                <div className="settingsM-row-icon"><ShieldIcon /></div>
                <div className="settingsM-row-text">
                  <div className="settingsM-row-title">Контроль доступа</div>
                  <div className="settingsM-row-subtitle">
                    {securityStatus?.security_configured
                      ? 'Секретный ответ, резервные коды, recovery-фраза и passkey настроены.'
                      : 'Доведи защиту до конца: секретный ответ, резервные коды, recovery-фраза, passkey и PIN доверенных устройств должны быть готовы заранее.'}
                  </div>
                </div>
              </div>
              <div className="settingsM-deviceMetaRow">
                <span className="settingsM-deviceMeta">{securityStatus?.question_prompt || 'Секретный ответ'}</span>
                <span className="settingsM-deviceMeta">{securityStatus?.has_secret_answer ? 'Ответ настроен' : 'Ответ не настроен'}</span>
                <span className="settingsM-deviceMeta">{securityStatus?.backup_codes_remaining ?? 0} резервных кодов</span>
                <span className="settingsM-deviceMeta">{securityStatus?.has_recovery_phrase ? 'Recovery-фраза готова' : 'Recovery-фразы нет'}</span>
                <span className="settingsM-deviceMeta">{securityStatus?.trusted_recovery_devices ?? 0} устройств с PIN</span>
                <span className="settingsM-deviceMeta">{securityStatus?.passkeys_count ?? passkeys.length} passkey</span>
              </div>
            </div>
            <ActionPanel title="Сменить пароль" subtitle="После смены пароля все остальные сессии автоматически завершатся.">
              <form className="settingsM-form" onSubmit={handlePasswordSubmit}>
                <input
                  className="settingsM-input"
                  type="password"
                  placeholder="Текущий пароль"
                  value={passwordForm.currentPassword}
                  onChange={(event) => setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
                />
                <input
                  className="settingsM-input"
                  type="password"
                  placeholder="Новый пароль"
                  value={passwordForm.newPassword}
                  onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
                />
                <input
                  className="settingsM-input"
                  type="password"
                  placeholder="Повтори новый пароль"
                  value={passwordForm.confirmPassword}
                  onChange={(event) => setPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
                />
                <button type="submit" className="settingsM-primary-btn" disabled={busyAction === 'password'}>
                  {busyAction === 'password' ? 'Сохраняем...' : 'Обновить пароль'}
                </button>
              </form>
            </ActionPanel>
            <ActionPanel title={securityStatus?.has_secret_answer ? 'Обновить секретный ответ' : 'Настроить секретный ответ'} subtitle="Это дополнительная проверка для восстановления доступа и чувствительных действий.">
              <form className="settingsM-form" onSubmit={handleSecretSubmit}>
                <input
                  className="settingsM-input"
                  type="password"
                  placeholder="Текущий пароль"
                  value={secretForm.password}
                  onChange={(event) => setSecretForm((prev) => ({ ...prev, password: event.target.value }))}
                />
                <input
                  className="settingsM-input"
                  type="text"
                  placeholder={securityStatus?.question_prompt || 'Новый секретный ответ'}
                  value={secretForm.secretAnswer}
                  onChange={(event) => setSecretForm((prev) => ({ ...prev, secretAnswer: event.target.value }))}
                />
                <button type="submit" className="settingsM-primary-btn" disabled={busyAction === 'secret'}>
                  {busyAction === 'secret' ? 'Сохраняем...' : securityStatus?.has_secret_answer ? 'Обновить секрет' : 'Настроить секрет'}
                </button>
              </form>
            </ActionPanel>
            <ActionPanel title="Passkey" subtitle="Вход и восстановление без email/телефона: системный ключ устройства, Face ID, Touch ID или Windows Hello.">
              <form className="settingsM-form" onSubmit={handlePasskeyRegister}>
                <input
                  className="settingsM-input"
                  type="text"
                  placeholder="Название passkey, например MacBook или iPhone"
                  value={passkeyForm.label}
                  onChange={(event) => setPasskeyForm((prev) => ({ ...prev, label: event.target.value }))}
                />
                <input
                  className="settingsM-input"
                  type="password"
                  placeholder="Текущий пароль"
                  value={passkeyForm.password}
                  onChange={(event) => setPasskeyForm((prev) => ({ ...prev, password: event.target.value }))}
                />
                <button type="submit" className="settingsM-primary-btn" disabled={busyAction === 'passkey-register'}>
                  {busyAction === 'passkey-register' ? 'Открываем passkey...' : 'Добавить passkey'}
                </button>
              </form>
              <div className="settingsM-deviceList" style={{ marginTop: 10 }}>
                {passkeys.length ? passkeys.map((item) => (
                  <div className="settingsM-deviceItem" key={item.id}>
                    <div className="settingsM-row static-row">
                      <div className="settingsM-row-icon"><KeyIcon /></div>
                      <div className="settingsM-row-text">
                        <div className="settingsM-row-title">{item.label || 'Passkey'}</div>
                        <div className="settingsM-row-subtitle">
                          Добавлен: {new Date(item.created_at).toLocaleString('ru-RU')}
                          {item.last_used_at ? ` · использован: ${new Date(item.last_used_at).toLocaleString('ru-RU')}` : ''}
                        </div>
                      </div>
                      <button type="button" className="settingsM-secondary-btn" onClick={() => handlePasskeyDisable(item)} disabled={busyAction === `passkey:${item.id}`}>
                        {busyAction === `passkey:${item.id}` ? 'Отключаем...' : 'Отключить'}
                      </button>
                    </div>
                  </div>
                )) : (
                  <div className="settingsM-empty-card">Passkey ещё не добавлен. Это лучший способ входа без email и телефона.</div>
                )}
              </div>
            </ActionPanel>
            <ActionPanel title={securityStatus?.has_recovery_phrase ? 'Перевыпустить recovery-фразу' : 'Создать recovery-фразу'} subtitle="Фраза хранится только в хеше. Сервис покажет её один раз — сохраните локально, без email и телефона.">
              <form className="settingsM-form" onSubmit={handleRecoveryPhraseGenerate}>
                <input
                  className="settingsM-input"
                  type="password"
                  placeholder="Текущий пароль"
                  value={phrasePassword}
                  onChange={(event) => setPhrasePassword(event.target.value)}
                />
                <button type="submit" className="settingsM-primary-btn" disabled={busyAction === 'recovery-phrase'}>
                  {busyAction === 'recovery-phrase' ? 'Создаём...' : securityStatus?.has_recovery_phrase ? 'Перевыпустить фразу' : 'Создать фразу'}
                </button>
              </form>
              {freshPhrase ? (
                <div className="settingsM-codes-wrap">
                  <div className="settingsM-code-chip">{freshPhrase}</div>
                  <div className="settingsM-action-row">
                    <button type="button" className="settingsM-secondary-btn" onClick={() => navigator.clipboard?.writeText(freshPhrase)}>
                      Скопировать
                    </button>
                  </div>
                </div>
              ) : null}
            </ActionPanel>
          </section>

          <section className={tabClass('security')}>
            <div className="settingsM-section-title">DFSN-профиль</div>
            <div className="settingsM-card">
              <div className="settingsM-row static-row">
                <div className="settingsM-row-icon"><PulseIcon /></div>
                <div className="settingsM-row-text">
                  <div className="settingsM-row-title">Калибровка поведенческого профиля</div>
                  <div className="settingsM-row-subtitle">
                    {user?.dfsn?.configured
                      ? `Профиль активен${user?.dfsn?.updated_at ? ` · обновлён ${new Date(user.dfsn.updated_at).toLocaleString('ru-RU')}` : ''}`
                      : 'Профиль ещё не калибровался после входа в аккаунт.'}
                  </div>
                </div>
              </div>
            </div>
            <ActionPanel
              title="Перенастроить DFSN"
              subtitle="Запустит отдельную калибровку для текущего аккаунта и мягко обновит уже существующий DFSN-профиль."
            >
              <div className="settingsM-action-row">
                <button type="button" className="settingsM-primary-btn" onClick={() => router.push('/settings/dfsn')}>
                  {user?.dfsn?.configured ? 'Обновить DFSN-профиль' : 'Настроить DFSN-профиль'}
                </button>
              </div>
            </ActionPanel>
          </section>

          <section className={tabClass('security', 'settingsM-section-last')}>
            <div className="settingsM-section-title">Резервные коды</div>
            <div className="settingsM-card">
              <div className="settingsM-row static-row">
                <div className="settingsM-row-icon"><KeyIcon /></div>
                <div className="settingsM-row-text">
                  <div className="settingsM-row-title">Перевыпуск резервных кодов</div>
                  <div className="settingsM-row-subtitle">Старые коды перестанут работать сразу после перевыпуска.</div>
                </div>
              </div>
            </div>
            <ActionPanel title="Создать новый набор кодов">
              <form className="settingsM-form" onSubmit={handleCodesRegenerate}>
                <input
                  className="settingsM-input"
                  type="password"
                  placeholder="Пароль"
                  value={codesPassword}
                  onChange={(event) => setCodesPassword(event.target.value)}
                />
                <button type="submit" className="settingsM-primary-btn" disabled={busyAction === 'codes'}>
                  {busyAction === 'codes' ? 'Генерируем...' : 'Перевыпустить коды'}
                </button>
              </form>
              {freshCodes.length ? (
                <div className="settingsM-codes-wrap">
                  <div className="settingsM-codes-grid">
                    {freshCodes.map((code) => (
                      <div key={code} className="settingsM-code-chip">{code}</div>
                    ))}
                  </div>
                  <div className="settingsM-action-row">
                    <button type="button" className="settingsM-secondary-btn" onClick={() => copyCodes(freshCodes)}>
                      Скопировать
                    </button>
                    <button type="button" className="settingsM-secondary-btn" onClick={() => downloadCodes(freshCodes)}>
                      Скачать .txt
                    </button>
                  </div>
                </div>
              ) : null}
            </ActionPanel>
          </section>

          <section className={tabClass('account')}>
            <div className="settingsM-section-title">Данные и аккаунт</div>
            <div className="settingsM-card">
              <div className="settingsM-row static-row">
                <div className="settingsM-row-icon"><DownloadIcon /></div>
                <div className="settingsM-row-text">
                  <div className="settingsM-row-title">Экспорт и удаление</div>
                  <div className="settingsM-row-subtitle">
                    Статус: {accountControlStatus?.account_status || user?.account_status || 'active'}
                    {accountControlStatus?.deletion_scheduled_at ? ' · удаление запланировано на ' + new Date(accountControlStatus.deletion_scheduled_at).toLocaleDateString('ru-RU') : ''}
                  </div>
                </div>
              </div>
            </div>
            <ActionPanel
              title="Экспорт данных"
              subtitle="Скачайте JSON-экспорт своего профиля, настроек, постов, комментариев, сообществ, сообщений и security-metadata без хэшей, DFSN-секретов и passkey-ключей."
            >
              <form className="settingsM-form" onSubmit={handleAccountExport}>
                <input
                  className="settingsM-input"
                  type="password"
                  placeholder="Текущий пароль"
                  value={accountExportPassword}
                  onChange={(event) => setAccountExportPassword(event.target.value)}
                />
                <button type="submit" className="settingsM-primary-btn" disabled={busyAction === 'account-export'}>
                  {busyAction === 'account-export' ? 'Готовим экспорт…' : 'Скачать экспорт'}
                </button>
              </form>
            </ActionPanel>
            <ActionPanel
              title="Удаление или деактивация"
              subtitle="Удаление ставится в очередь с периодом отмены. Это защищает от случайного или чужого удаления аккаунта."
            >
              <div className="settingsM-form">
                <textarea
                  className="settingsM-input"
                  placeholder="Причина удаления, необязательно"
                  value={accountDeletionForm.reason}
                  onChange={(event) => setAccountDeletionForm((prev) => ({ ...prev, reason: event.target.value }))}
                  rows={3}
                />
                <input
                  className="settingsM-input"
                  type="password"
                  placeholder="Текущий пароль"
                  value={accountDeletionForm.password}
                  onChange={(event) => setAccountDeletionForm((prev) => ({ ...prev, password: event.target.value }))}
                />
                <div className="settingsM-action-row">
                  <button type="button" className="settingsM-secondary-btn" onClick={() => runAccountDeletionAction('deactivate')} disabled={busyAction === 'account-deactivate'}>
                    {busyAction === 'account-deactivate' ? 'Деактивируем…' : 'Деактивировать'}
                  </button>
                  <button type="button" className="settingsM-secondary-btn" onClick={() => runAccountDeletionAction('reactivate')} disabled={busyAction === 'account-reactivate'}>
                    {busyAction === 'account-reactivate' ? 'Возвращаем…' : 'Вернуть активность'}
                  </button>
                  {accountControlStatus?.deletion_request?.status === 'pending' ? (
                    <button type="button" className="settingsM-secondary-btn" onClick={() => runAccountDeletionAction('cancel')} disabled={busyAction === 'account-cancel'}>
                      {busyAction === 'account-cancel' ? 'Отменяем…' : 'Отменить удаление'}
                    </button>
                  ) : (
                    <button type="button" className="settingsM-primary-btn is-danger" onClick={() => runAccountDeletionAction('request')} disabled={busyAction === 'account-request'}>
                      {busyAction === 'account-request' ? 'Планируем…' : 'Запланировать удаление'}
                    </button>
                  )}
                </div>
              </div>
            </ActionPanel>
          </section>
          {user?.is_admin ? (
            <section className={tabClass('admin')}>
              <div className="settingsM-section-title">Админ-панель</div>
              <div className="settingsM-card">
                <div className="settingsM-row static-row">
                  <div className="settingsM-row-icon"><ShieldIcon /></div>
                  <div className="settingsM-row-text">
                    <div className="settingsM-row-title">Краткая сводка</div>
                    <div className="settingsM-row-subtitle">Только для администраторов: общая картина по пользователям, активности и рисковым зонам.</div>
                  </div>
                  <div className="settingsM-session-badge">admin</div>
                </div>
              </div>
              <ActionPanel
                title="Обзор проекта"
                subtitle="Никакой лишней псевдоаналитики: только базовые метрики, которые реально полезны для запуска и ручного контроля."
              >
                {adminLoading ? (
                  <div className="settingsM-empty">Загружаем admin-метрики…</div>
                ) : adminOverview ? (
                  <>
                    <div className="settingsM-adminGrid">
                      <div className="settingsM-adminMetric"><strong>{adminOverview.kpis.users_total}</strong><span>Пользователи</span></div>
                      <div className="settingsM-adminMetric"><strong>{adminOverview.kpis.users_active_30d}</strong><span>Активны за 30 д</span></div>
                      <div className="settingsM-adminMetric"><strong>{adminOverview.kpis.posts_total}</strong><span>Посты</span></div>
                      <div className="settingsM-adminMetric"><strong>{adminOverview.kpis.comments_total}</strong><span>Комментарии</span></div>
                      <div className="settingsM-adminMetric"><strong>{adminOverview.kpis.pending_friend_requests}</strong><span>Заявки в друзья</span></div>
                      <div className="settingsM-adminMetric"><strong>{adminOverview.kpis.open_support_tickets}</strong><span>Открытые тикеты</span></div>
                      <div className="settingsM-adminMetric"><strong>{adminOverview.kpis.new_post_reports}</strong><span>Жалобы на посты</span></div>
                      <div className="settingsM-adminMetric"><strong>{adminOverview.kpis.new_message_reports}</strong><span>Жалобы на сообщения</span></div>
                      <div className="settingsM-adminMetric"><strong>{adminOverview.kpis.open_messenger_safety_flags}</strong><span>Safety-флаги</span></div>
                      <div className="settingsM-adminMetric"><strong>{adminOverview.kpis.trusted_devices}</strong><span>Доверенные устройства</span></div>
                    </div>
                    <div className="settingsM-adminTrust">
                      <div className="settingsM-adminTrustItem">Надёжные: <strong>{adminOverview.trust_distribution.trusted}</strong></div>
                      <div className="settingsM-adminTrustItem">Неуверенные: <strong>{adminOverview.trust_distribution.uncertain}</strong></div>
                      <div className="settingsM-adminTrustItem">Подозрительные: <strong>{adminOverview.trust_distribution.suspicious}</strong></div>
                    </div>
                    {adminOverview.messenger_observability ? (
                      <div className="settingsM-adminMessenger">
                        <div className="settingsM-action-title">Мессенджер за 24 часа</div>
                        <div className="settingsM-adminGrid">
                          <div className="settingsM-adminMetric"><strong>{adminOverview.messenger_observability.messages.send_success_rate_24h}%</strong><span>Send success</span></div>
                          <div className="settingsM-adminMetric"><strong>{adminOverview.messenger_observability.media.upload_success_rate_24h}%</strong><span>Upload success</span></div>
                          <div className="settingsM-adminMetric"><strong>{adminOverview.messenger_observability.realtime.reconnect_attempts_24h}</strong><span>Reconnect attempts</span></div>
                          <div className="settingsM-adminMetric"><strong>{adminOverview.messenger_observability.calls.create_success_rate_24h}%</strong><span>Call create success</span></div>
                          <div className="settingsM-adminMetric"><strong>{adminOverview.messenger_observability.ux.chat_open_avg_ms_24h || '—'} мс</strong><span>Chat open avg</span></div>
                          <div className="settingsM-adminMetric"><strong>{adminOverview.messenger_observability.calls.media_device_errors_24h}</strong><span>Media device errors</span></div>
                        </div>
                        {adminOverview.messenger_observability.recent_failures?.length ? (
                          <div className="settingsM-adminFailureList">
                            {adminOverview.messenger_observability.recent_failures.map((item) => (
                              <div className="settingsM-adminFailure" key={item.id}>
                                <strong>{item.category}.{item.metric}</strong>
                                <span>{new Date(item.created_at).toLocaleString('ru-RU')}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="settingsM-empty">Нет данных для сводки. Проверь admin-права и записи в БД.</div>
                )}
              </ActionPanel>

              <ActionPanel
                title="Launch verification"
                subtitle="Быстрая проверка готовности к живому запуску: база, proxy, cookie, admin-конфиг и несколько операционных рисков."
              >
                {adminLoading ? (
                  <div className="settingsM-empty">Проверяем launch-контур…</div>
                ) : adminVerification ? (
                  <>
                    <div className={`settingsM-verifySummary is-${adminVerification.status}`}>
                      <div>
                        <strong>{adminVerification.status === 'ready' ? 'Готово к запуску' : adminVerification.status === 'warn' ? 'Готово с предупреждениями' : 'Найдены критичные риски'}</strong>
                        <span>{adminVerification.summary.ok} из {adminVerification.summary.total_checks} проверок зелёные</span>
                      </div>
                      <div className="settingsM-verifyScore">{adminVerification.score}%</div>
                    </div>
                    <div className="settingsM-verifyList">
                      {adminVerification.checks.map((item) => (
                        <div className={`settingsM-verifyItem is-${item.status}`} key={item.key}>
                          <div className="settingsM-verifyLabel">{item.label}</div>
                          <div className="settingsM-verifyText">{item.detail}</div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="settingsM-empty">Верификация недоступна. Проверь admin-права, env и доступ к БД.</div>
                )}
              </ActionPanel>

              <ActionPanel
                title="Последние пользователи"
                subtitle="Небольшой список для ручной проверки регистрации, активности и доверия DFSN без тяжёлой админки."
              >
                {adminLoading ? (
                  <div className="settingsM-empty">Загружаем пользователей…</div>
                ) : adminUsers.length ? (
                  <div className="settingsM-adminUserList">
                    {adminUsers.map((item) => (
                      <div className="settingsM-adminUser" key={item.id}>
                        <div className="settingsM-adminUserTop">
                          <div>
                            <div className="settingsM-adminUserName">{item.full_name}</div>
                            <div className="settingsM-adminUserHandle">{item.handle}</div>
                          </div>
                          <div className={`settingsM-ticketStatus is-${item.behavioral_trust_label || 'open'}`}>
                            {item.behavioral_trust_label || 'unknown'}
                          </div>
                        </div>
                        <div className="settingsM-adminUserMeta">
                          {item.summary} · {item.last_seen_label}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="settingsM-empty">Список пользователей пока пуст.</div>
                )}
              </ActionPanel>
              <ActionPanel
                title="Новые жалобы на посты"
                subtitle="Только свежие жалобы без перегруза. Можно быстро просмотреть и закрыть, не уходя в отдельную тяжёлую админку."
              >
                {adminLoading ? (
                  <div className="settingsM-empty">Загружаем жалобы…</div>
                ) : adminReports.length ? (
                  <div className="settingsM-ticketList">
                    {adminReports.map((item) => (
                      <div className="settingsM-ticketItem" key={item.id}>
                        <div className="settingsM-ticketTop">
                          <div className="settingsM-ticketSubject">{item.reason}</div>
                          <div className={`settingsM-ticketStatus is-${item.status}`}>{item.status}</div>
                        </div>
                        <div className="settingsM-ticketMeta">
                          {item.reporter?.full_name || 'Неизвестный пользователь'} · пост #{item.post?.id} · {new Date(item.created_at).toLocaleString('ru-RU')}
                        </div>
                        <div className="settingsM-ticketMessage">{item.post?.text_preview || 'Текст поста недоступен.'}</div>
                        {item.details ? <div className="settingsM-ticketMeta">Комментарий: {item.details}</div> : null}
                        <div className="settingsM-action-row">
                          <button
                            type="button"
                            className="settingsM-secondary-btn"
                            disabled={adminAction === `report:${item.id}:reviewed`}
                            onClick={() => handleAdminReportStatus(item, 'reviewed')}
                          >
                            {adminAction === `report:${item.id}:reviewed` ? 'Сохраняем…' : 'Проверено'}
                          </button>
                          <button
                            type="button"
                            className="settingsM-secondary-btn"
                            disabled={adminAction === `report:${item.id}:dismissed`}
                            onClick={() => handleAdminReportStatus(item, 'dismissed')}
                          >
                            {adminAction === `report:${item.id}:dismissed` ? 'Сохраняем…' : 'Отклонить'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="settingsM-empty">Новых жалоб нет.</div>
                )}
              </ActionPanel>

              <ActionPanel
                title="Новые жалобы на сообщения"
                subtitle="Точечный safety-контур для мессенджера: жалобы на спам, угрозы и злоупотребления без отдельной тяжёлой админки."
              >
                {adminLoading ? (
                  <div className="settingsM-empty">Загружаем жалобы на сообщения…</div>
                ) : adminMessageReports.length ? (
                  <div className="settingsM-ticketList">
                    {adminMessageReports.map((item) => (
                      <div className="settingsM-ticketItem" key={item.id}>
                        <div className="settingsM-ticketTop">
                          <div className="settingsM-ticketSubject">{item.reason}</div>
                          <div className={`settingsM-ticketStatus is-${item.status}`}>{item.status}</div>
                        </div>
                        <div className="settingsM-ticketMeta">
                          {item.reporter?.full_name || 'Неизвестный пользователь'} → {item.message?.sender?.full_name || 'Неизвестный отправитель'} · {new Date(item.created_at).toLocaleString('ru-RU')}
                        </div>
                        <div className="settingsM-ticketMessage">{item.message?.text_preview || 'Текст сообщения недоступен.'}</div>
                        {item.details ? <div className="settingsM-ticketMeta">Комментарий: {item.details}</div> : null}
                        <div className="settingsM-action-row">
                          <button type="button" className="settingsM-secondary-btn" disabled={adminAction === `message-report:${item.id}:reviewed`} onClick={() => handleAdminMessageReportStatus(item, 'reviewed')}>
                            {adminAction === `message-report:${item.id}:reviewed` ? 'Сохраняем…' : 'Проверено'}
                          </button>
                          <button type="button" className="settingsM-secondary-btn" disabled={adminAction === `message-report:${item.id}:dismissed`} onClick={() => handleAdminMessageReportStatus(item, 'dismissed')}>
                            {adminAction === `message-report:${item.id}:dismissed` ? 'Сохраняем…' : 'Отклонить'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="settingsM-empty">Новых жалоб на сообщения нет.</div>
                )}
              </ActionPanel>

              <ActionPanel
                title="Safety-флаги мессенджера"
                subtitle="Мягкие server-side флаги по burst/flood, дубликатам и накопленным жалобам. Это уже не user-report, а эксплуатационный anti-spam слой."
              >
                {adminLoading ? (
                  <div className="settingsM-empty">Загружаем safety-флаги…</div>
                ) : adminSafetyFlags.length ? (
                  <div className="settingsM-ticketList">
                    {adminSafetyFlags.map((item) => (
                      <div className="settingsM-ticketItem" key={item.id}>
                        <div className="settingsM-ticketTop">
                          <div className="settingsM-ticketSubject">{item.category}.{item.reason}</div>
                          <div className={`settingsM-ticketStatus is-${item.status}`}>{item.status}</div>
                        </div>
                        <div className="settingsM-ticketMeta">{item.target?.full_name || 'Без цели'} · severity {item.severity} · срабатываний {item.occurrence_count}</div>
                        <div className="settingsM-ticketMessage">Последнее срабатывание: {new Date(item.last_triggered_at || item.created_at).toLocaleString('ru-RU')}</div>
                        <div className="settingsM-action-row">
                          <button type="button" className="settingsM-secondary-btn" disabled={adminAction === `safety-flag:${item.id}:reviewed`} onClick={() => handleAdminSafetyFlagStatus(item, 'reviewed')}>
                            {adminAction === `safety-flag:${item.id}:reviewed` ? 'Сохраняем…' : 'Проверено'}
                          </button>
                          <button type="button" className="settingsM-secondary-btn" disabled={adminAction === `safety-flag:${item.id}:actioned`} onClick={() => handleAdminSafetyFlagStatus(item, 'actioned')}>
                            {adminAction === `safety-flag:${item.id}:actioned` ? 'Сохраняем…' : 'Приняты меры'}
                          </button>
                          <button type="button" className="settingsM-secondary-btn" disabled={adminAction === `safety-flag:${item.id}:dismissed`} onClick={() => handleAdminSafetyFlagStatus(item, 'dismissed')}>
                            {adminAction === `safety-flag:${item.id}:dismissed` ? 'Сохраняем…' : 'Отклонить'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="settingsM-empty">Открытых safety-флагов сейчас нет.</div>
                )}
              </ActionPanel>

              <ActionPanel
                title="Открытые тикеты поддержки"
                subtitle="Минимальный рабочий контроль: можно взять тикет в работу или закрыть его прямо из настроек."
              >
                {adminLoading ? (
                  <div className="settingsM-empty">Загружаем тикеты…</div>
                ) : adminSupportTickets.length ? (
                  <div className="settingsM-ticketList">
                    {adminSupportTickets.map((item) => (
                      <div className="settingsM-ticketItem" key={item.id}>
                        <div className="settingsM-ticketTop">
                          <div className="settingsM-ticketSubject">{item.subject}</div>
                          <div className={`settingsM-ticketStatus is-${item.status}`}>{item.status}</div>
                        </div>
                        <div className="settingsM-ticketMeta">
                          {item.user?.full_name || 'Пользователь'} · {item.category} · {new Date(item.created_at).toLocaleString('ru-RU')}
                        </div>
                        <div className="settingsM-ticketMessage">{item.message}</div>
                        <div className="settingsM-action-row">
                          <button
                            type="button"
                            className="settingsM-secondary-btn"
                            disabled={adminAction === `ticket:${item.id}:in_progress`}
                            onClick={() => handleAdminTicketStatus(item, 'in_progress')}
                          >
                            {adminAction === `ticket:${item.id}:in_progress` ? 'Сохраняем…' : 'В работу'}
                          </button>
                          <button
                            type="button"
                            className="settingsM-secondary-btn"
                            disabled={adminAction === `ticket:${item.id}:closed`}
                            onClick={() => handleAdminTicketStatus(item, 'closed')}
                          >
                            {adminAction === `ticket:${item.id}:closed` ? 'Сохраняем…' : 'Закрыть'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="settingsM-empty">Открытых тикетов нет.</div>
                )}
              </ActionPanel>
            </section>
          ) : null}

          <section className={tabClass('support', 'settingsM-section-last')}>
            <div className="settingsM-section-title">Поддержка</div>
            <div className="settingsM-card">
              <div className="settingsM-row static-row">
                <div className="settingsM-row-icon"><HelpIcon /></div>
                <div className="settingsM-row-text">
                  <div className="settingsM-row-title">Помощь и обратная связь</div>
                  <div className="settingsM-row-subtitle">Можно отправить обращение в поддержку или отзыв о публичной бете прямо из настроек.</div>
                </div>
                <div className="settingsM-row-actions">
                  <button type="button" className="settingsM-row-action is-primary" onClick={openBetaFeedbackForm}>
                    Отзыв
                  </button>
                  <button type="button" className="settingsM-row-action" onClick={() => setActiveSupportView((prev) => prev === 'form' ? 'list' : 'form')}>
                    {activeSupportView === 'form' ? 'Список' : 'Новое'}
                  </button>
                </div>
              </div>
            </div>
            <ActionPanel
              title={activeSupportView === 'form' ? 'Новое обращение' : 'Последние обращения'}
              subtitle={activeSupportView === 'form' ? 'Опиши проблему спокойно и конкретно. Поддержка увидит это сообщение в твоём аккаунте.' : 'Последние обращения привязаны к текущему аккаунту и видны только тебе.'}
            >
              {activeSupportView === 'form' ? (
                <form className="settingsM-form" onSubmit={handleSupportSubmit}>
                  <select className="settingsM-input" value={supportForm.category} onChange={(event) => setSupportForm((prev) => ({ ...prev, category: event.target.value }))}>
                    <option value="general">Общий вопрос</option>
                    <option value="beta_feedback">Отзыв о бете</option>
                    <option value="beta_bug">Ошибка или баг</option>
                    <option value="beta_onboarding">Первый запуск и онбординг</option>
                    <option value="account">Аккаунт и доступ</option>
                    <option value="abuse">Жалоба на поведение</option>
                  </select>
                  <input
                    className="settingsM-input"
                    type="text"
                    placeholder="Короткая тема"
                    value={supportForm.subject}
                    onChange={(event) => setSupportForm((prev) => ({ ...prev, subject: event.target.value }))}
                  />
                  <textarea
                    className="settingsM-textarea"
                    placeholder="Опиши, что произошло, что ожидалось и что нужно поправить"
                    value={supportForm.message}
                    onChange={(event) => setSupportForm((prev) => ({ ...prev, message: event.target.value }))}
                  />
                  <button type="submit" className="settingsM-primary-btn" disabled={busyAction === 'support'}>
                    {busyAction === 'support' ? 'Отправляем...' : 'Отправить обращение'}
                  </button>
                </form>
              ) : supportLoading ? (
                <div className="settingsM-empty">Загружаем обращения…</div>
              ) : supportTickets.length ? (
                <div className="settingsM-ticketList">
                  {supportTickets.map((ticket) => (
                    <div className="settingsM-ticketItem" key={ticket.id}>
                      <div className="settingsM-ticketTop">
                        <div className="settingsM-ticketSubject">{ticket.subject}</div>
                        <div className={`settingsM-ticketStatus is-${ticket.status}`}>{ticket.status === 'open' ? 'Открыт' : ticket.status}</div>
                      </div>
                      <div className="settingsM-ticketMeta">{new Date(ticket.created_at).toLocaleString('ru-RU')} · {ticket.category}</div>
                      <div className="settingsM-ticketMessage">{ticket.message}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="settingsM-empty">Пока обращений нет. Если что-то сломалось или работает странно, можно написать прямо отсюда.</div>
              )}
              <div className="settingsM-action-row">
                <button type="button" className="settingsM-secondary-btn" onClick={openBetaFeedbackForm}>
                  Оставить отзыв
                </button>
                <button type="button" className="settingsM-secondary-btn" onClick={() => setActiveSupportView((prev) => prev === 'form' ? 'list' : 'form')}>
                  {activeSupportView === 'form' ? 'К списку обращений' : 'Написать в поддержку'}
                </button>
                <button type="button" className="settingsM-secondary-btn" onClick={() => router.push('/recover/support')}>
                  Восстановление доступа
                </button>
              </div>
            </ActionPanel>

            <div className="settingsM-card">
              <div className="settingsM-row static-row is-danger" onClick={handleLogout}>
                <div className="settingsM-row-icon"><LogoutIcon /></div>
                <div className="settingsM-row-text">
                  <div className="settingsM-row-title">Выйти из аккаунта</div>
                  <div className="settingsM-row-subtitle">Завершить текущую сессию прямо сейчас.</div>
                </div>
              </div>
            </div>
          </section>
        </main>

        <SensitiveActionModal
          action={sensitiveAction}
          form={sensitiveForm}
          busyAction={busyAction}
          onChange={updateSensitiveForm}
          onClose={closeSensitiveAction}
          onSubmit={handleSensitiveActionSubmit}
        />
        <PostAuthBottomNav />
      </div>
    </div>
  );
}
