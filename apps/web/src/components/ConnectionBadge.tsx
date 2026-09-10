import type { ConnectionStatus } from '../realtime';
import { useI18n, type MessageKey } from '../i18n';

interface ConnectionBadgeProps {
  status: ConnectionStatus;
}

const LABEL_KEYS: Record<ConnectionStatus, MessageKey> = {
  connecting: 'connection.connecting',
  online: 'connection.online',
  offline: 'connection.offline',
  stale: 'connection.stale'
};

export function ConnectionBadge({ status }: ConnectionBadgeProps) {
  const { t } = useI18n();
  return (
    <span className={`connection-badge connection-badge--${status}`} role="status" aria-live="polite">
      <span className="connection-badge__dot" aria-hidden="true" />
      <span className="connection-badge__label">{t(LABEL_KEYS[status])}</span>
    </span>
  );
}
