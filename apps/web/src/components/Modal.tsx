import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../i18n';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export function getFocusableSelector(): string {
  return FOCUSABLE_SELECTOR;
}

export function getInitialFocusSelector(): string {
  return '[data-autofocus]';
}

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  closeLabel?: string;
  describedBy?: string;
  className?: string;
  scrimClassName?: string;
}

export function Modal({ open, title, onClose, children, closeLabel, describedBy, className = '', scrimClassName = '' }: ModalProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = `modal-title-${useId().replaceAll(':', '')}`;
  const descriptionId = describedBy ?? `modal-description-${useId().replaceAll(':', '')}`;
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const activeElement = document.activeElement;
    previousFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;

    const focusTimer = window.setTimeout(() => {
      const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(getInitialFocusSelector())
        ?? dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (firstFocusable ?? closeButtonRef.current ?? dialogRef.current)?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocusRef.current?.isConnected === true) previousFocusRef.current.focus();
      previousFocusRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  function handleScrimClick(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <div className={`modal-scrim ${scrimClassName}`.trim()} role="presentation" onPointerDown={handleScrimClick}>
      <div
        className={`surface-card modal-card ${className}`.trim()}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button ref={closeButtonRef} className="modal-card__close" type="button" onClick={onClose} aria-label={closeLabel ?? t('common.closeDialog')}><X aria-hidden="true" size={20} strokeWidth={1.8} /></button>
        <h2 id={titleId}>{title}</h2>
        <div id={descriptionId}>{children}</div>
      </div>
    </div>
  );
}

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
  danger?: boolean;
}

export function ConfirmModal({ open, title, description, confirmLabel, cancelLabel, onConfirm, onClose, danger = false }: ConfirmModalProps) {
  const [busy, setBusy] = useState(false);

  async function confirm(): Promise<void> {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={title} onClose={busy ? () => undefined : onClose} className="confirm-modal">
      <p className="modal-card__copy">{description}</p>
      <div className="form-actions">
        <button className="button button--ghost" type="button" onClick={onClose} disabled={busy}>{cancelLabel}</button>
        <button className={`button ${danger ? 'button--danger' : 'button--dark'}`} type="button" onClick={() => void confirm()} disabled={busy} data-autofocus>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
