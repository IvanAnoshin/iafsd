'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

export function useMinimalActionDialog() {
  const [dialog, setDialog] = useState(null);
  const resolverRef = useRef(null);

  const close = useCallback((value) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    if (resolver) resolver(value);
  }, []);

  const open = useCallback((config) => new Promise((resolve) => {
    resolverRef.current = resolve;
    setDialog(config);
  }), []);

  const askText = useCallback((config = {}) => open({
    kind: 'text',
    title: config.title || 'Введите текст',
    text: config.text || '',
    label: config.label || '',
    placeholder: config.placeholder || '',
    initialValue: config.initialValue || '',
    submitLabel: config.submitLabel || 'Готово',
    cancelLabel: config.cancelLabel || 'Отмена',
    multiline: config.multiline !== false,
    required: config.required !== false,
  }), [open]);

  const confirmAction = useCallback((config = {}) => open({
    kind: 'confirm',
    title: config.title || 'Подтвердить действие?',
    text: config.text || '',
    submitLabel: config.submitLabel || 'Подтвердить',
    cancelLabel: config.cancelLabel || 'Отмена',
    danger: Boolean(config.danger),
  }), [open]);

  return {
    dialog,
    askText,
    confirmAction,
    dialogProps: {
      dialog,
      onCancel: () => close(null),
      onSubmit: close,
    },
  };
}

export function MinimalActionDialog({ dialog, onCancel, onSubmit }) {
  const [value, setValue] = useState(dialog?.initialValue || '');
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef(null);

  useEffect(() => {
    setValue(dialog?.initialValue || '');
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return undefined;
    const timer = window.setTimeout(() => dialogRef.current?.focus(), 0);
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [dialog, onCancel]);

  if (!dialog) return null;

  const isText = dialog.kind === 'text';
  const canSubmit = !isText || !dialog.required || String(value || '').trim().length > 0;

  const submit = () => {
    if (isText) {
      if (!canSubmit) return;
      onSubmit(String(value || '').trim());
      return;
    }
    onSubmit(true);
  };

  return (
    <div className="miniAction-backdrop" aria-hidden="false">
      <div
        ref={dialogRef}
        className="miniAction-card"
        role={dialog.danger ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={dialog.text ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="miniAction-head">
          <div>
            <div className="miniAction-title" id={titleId}>{dialog.title}</div>
            {dialog.text ? <div className="miniAction-text" id={descriptionId}>{dialog.text}</div> : null}
          </div>
          <button type="button" className="miniAction-close" onClick={onCancel} aria-label="Закрыть">×</button>
        </div>

        {isText ? (
          <label className="miniAction-field">
            {dialog.label ? <span>{dialog.label}</span> : null}
            {dialog.multiline ? (
              <textarea
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={dialog.placeholder}
                rows={4}
                autoFocus
              />
            ) : (
              <input
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={dialog.placeholder}
                autoFocus
              />
            )}
          </label>
        ) : null}

        <div className="miniAction-actions">
          <button type="button" className="miniAction-secondary" onClick={onCancel}>{dialog.cancelLabel || 'Отмена'}</button>
          <button
            type="button"
            className={`miniAction-primary ${dialog.danger ? 'is-danger' : ''}`.trim()}
            onClick={submit}
            disabled={!canSubmit}
          >
            {dialog.submitLabel || 'Готово'}
          </button>
        </div>
      </div>
    </div>
  );
}
