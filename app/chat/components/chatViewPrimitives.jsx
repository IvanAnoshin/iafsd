export const MAX_BATCH_MESSAGE_SELECTION = 10;

export const MESSAGE_SEARCH_FILTERS = [
  { id: '', label: 'Все' },
  { id: 'image', label: 'Фото' },
  { id: 'video', label: 'Видео' },
  { id: 'link', label: 'Ссылки' },
  { id: 'file', label: 'Файлы' },
];

export function SearchIcon() {
  return <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}

export function BackIcon() {
  return <svg viewBox="0 0 24 24"><path d="M15 18 9 12l6-6" /></svg>;
}

export function SendIcon() {
  return <svg viewBox="0 0 24 24"><path d="M21 3 10 14" /><path d="m21 3-7 18-3.2-7.8L3 10l18-7Z" /></svg>;
}

export function AttachIcon() {
  return <svg viewBox="0 0 24 24"><path d="m21.4 11.1-8.49 8.49a6 6 0 1 1-8.49-8.49l8.49-8.48a4 4 0 1 1 5.66 5.65l-8.49 8.49a2 2 0 0 1-2.82-2.83l7.78-7.77" /></svg>;
}

export function MoreIcon() {
  return <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>;
}

export function PhoneIcon() {
  return <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.34 1.78.65 2.62a2 2 0 0 1-.45 2.11L8 9.77a16 16 0 0 0 6.23 6.23l1.32-1.31a2 2 0 0 1 2.11-.45c.84.31 1.72.53 2.62.65A2 2 0 0 1 22 16.92Z" /></svg>;
}

export function CameraIcon() {
  return <svg viewBox="0 0 24 24"><path d="M23 7l-7 5 7 5V7Z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>;
}

export function MicIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 1 1-6 0V5a3 3 0 0 1 3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><path d="M12 19v3" /><path d="M8 22h8" /></svg>;
}

export function Checks({ state }) {
  if (!state) return null;
  if (state === 'sending') return <span className="chatW-state-label">отправка…</span>;
  if (state === 'failed') return <span className="chatW-state-label is-error">ошибка</span>;
  if (state === 'sent') {
    return (
      <span className="chatW-checks">
        <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
      </span>
    );
  }
  return (
    <span className={`chatW-checks ${state === 'read' ? 'is-read' : ''}`}>
      <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
      {state === 'read' ? <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg> : null}
    </span>
  );
}

export function searchFilterLabel(type) {
  return MESSAGE_SEARCH_FILTERS.find((item) => item.id === String(type || '').trim().toLowerCase())?.label || 'Все';
}

export function canBatchSelectMessage(item) {
  return Boolean(item && !item.deleted && (item.can_forward || item.can_save || item.can_delete));
}

export function mediaPreviewLabel(type, media = null) {
  if (type === 'voice') return 'Голосовое сообщение';
  if (type === 'video_note') return 'Видеокружок';
  if (type === 'image') return 'Изображение';
  if (type === 'video') return 'Видео';
  if (type === 'file') return media?.original_name || 'Файл';
  if (type === 'encrypted') return 'Зашифрованное сообщение';
  return 'Сообщение';
}

export function mediaFileLabel(item) {
  return item?.media?.original_name || item?.metadata?.media?.originalName || item?.metadata?.media?.original_name || item?.preview_text || 'Файл';
}

function formatAttachmentBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value >= 1024 * 1024) return `${Math.max(0.1, Math.round((value / (1024 * 1024)) * 10) / 10)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

export function attachmentStatusLabel(attachment, uploading = false) {
  if (!attachment) return '';
  if (attachment.status === 'queued') return 'Файл в очереди на загрузку…';
  if (uploading || attachment.status === 'uploading') return 'Загружаем вложение…';
  if (attachment.status === 'failed') return attachment.error || 'Не удалось загрузить вложение.';
  if (attachment.status === 'ready') return 'Готово к отправке';
  return '';
}

export function attachmentMetaLabel(attachment) {
  if (!attachment) return '';
  const bits = [formatAttachmentBytes(attachment.file_size || attachment.media?.bytes), attachment.mime || attachment.media?.mime].filter(Boolean);
  return bits.join(' • ');
}

export function mediaPermissionLabel(state) {
  if (state === 'granted') return 'разрешено';
  if (state === 'denied') return 'запрещено';
  if (state === 'prompt') return 'спросит при обращении';
  return 'неизвестно';
}

export function formatVoiceDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor((ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
