import React from 'react';
import { useTranslation } from 'react-i18next';
import { ConsoleKey } from '../atoms/ConsoleKey';
import { ConsoleLed } from '../atoms/ConsoleLed';
import './DownbeatActions.css';

export interface DownbeatActionButton {
  disabled: boolean;
  tooltip: string;
}

export interface DownbeatActionsProps {
  confirm: DownbeatActionButton;
  clear: DownbeatActionButton;
  /** Hay algo elegido que no coincide con lo confirmado: el LED de CONFIRMAR parpadea en ámbar. */
  pending: boolean;
  testIdPrefix: string;
  onConfirm: () => void;
  onClear: () => void;
}

/**
 * Zona 4: CONFIRMAR (con su LED de cambio pendiente) y, debajo, LIMPIAR. Atenuados siguen siendo
 * enfocables (aria-disabled) para que su tooltip explique la causa.
 */
export const DownbeatActions: React.FC<DownbeatActionsProps> = ({ confirm, clear, pending, testIdPrefix, onConfirm, onClear }) => {
  const { t } = useTranslation();
  const confirmLabel = t('dj.downbeat_btn_confirm');

  return (
    <div className="downbeat-actions">
      <ConsoleKey
        className="downbeat-actions__confirm"
        aria-disabled={confirm.disabled}
        aria-label={pending ? `${confirmLabel} · ${t('dj.downbeat_confirm_pending')}` : confirmLabel}
        title={confirm.tooltip}
        onClick={confirm.disabled ? undefined : onConfirm}
        data-testid={`${testIdPrefix}-confirm`}
        data-pending={pending}
      >
        <ConsoleLed on={pending} color="amber" blink />
        <span aria-hidden="true">{confirmLabel}</span>
      </ConsoleKey>
      <ConsoleKey
        className="downbeat-actions__clear"
        aria-disabled={clear.disabled}
        title={clear.tooltip}
        onClick={clear.disabled ? undefined : onClear}
        data-testid={`${testIdPrefix}-clear`}
      >
        {t('dj.downbeat_btn_clear')}
      </ConsoleKey>
    </div>
  );
};
