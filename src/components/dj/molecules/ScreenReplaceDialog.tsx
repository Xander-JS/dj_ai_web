import React, { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeckId } from '../../../types/deck';
import './ScreenReplaceDialog.css';

export interface ScreenReplaceDialogProps {
  deckId: DeckId;
  outTitle: string;
  inTitle: string;
  onCancel(): void;
  onReplace(): void;
}

/**
 * Confirmación de reemplazo de una pista que suena, centrada sobre la pantalla (no sobre la
 * página): el resto de la consola sigue operativo. Las teclas las explica la barra de teclas.
 */
export const ScreenReplaceDialog: React.FC<ScreenReplaceDialogProps> = ({ deckId, outTitle, inTitle, onCancel, onReplace }) => {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const replaceRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    replaceRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="screen-replace-dialog__backdrop">
      <div
        className={`screen-replace-dialog console-tone-${deckId.toLowerCase()}`}
        role="alertdialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid="screen-replace-dialog"
      >
        <p id={titleId} className="screen-replace-dialog__title">{t('mixer.screen.replace_title', { deck: deckId })}</p>
        <p id={descriptionId} className="screen-replace-dialog__body">
          <span>{t('mixer.screen.replace_out', { title: outTitle })}</span>
          <span>{t('mixer.screen.replace_in', { title: inTitle })}</span>
        </p>
        <div className="screen-replace-dialog__actions">
          <button type="button" className="screen-replace-dialog__btn" onClick={onCancel} data-testid="screen-replace-cancel">
            {t('mixer.screen.replace_cancel')}
          </button>
          <button
            ref={replaceRef}
            type="button"
            className="screen-replace-dialog__btn is-primary"
            onClick={onReplace}
            data-testid="screen-replace-confirm"
          >
            {t('mixer.screen.replace_confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};
