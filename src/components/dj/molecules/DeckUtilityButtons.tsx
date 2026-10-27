import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Eject, Target } from 'lucide-react';
import type { DeckId } from '../../../types/deck';
import { HardwareButton } from '../atoms/HardwareButton';
import './DeckUtilityButtons.css';

export interface DeckUtilityButtonsProps {
  deckId: DeckId;
  /** Expulsar responde (hay pista y no se está cargando). */
  ejectEnabled: boolean;
  /** Referencia responde (hay pista). */
  referenceEnabled: boolean;
  /** La pista cargada está marcada como referencia. */
  isReference: boolean;
  onEject: () => void;
  onToggleReference: () => void;
  /** Alterna el display LED entre GUÍA y MAPA. */
  onToggleMode: () => void;
}

/**
 * Expulsar, Referencia y Modo en la esquina exterior del deck, el mismo botón hundido: Expulsar se
 * enciende en blanco con pista; Referencia es enclavable, ámbar con la pista marcada; Modo está
 * siempre encendido en blanco, también sin pista. Deck B es el espejo.
 */
export const DeckUtilityButtons: React.FC<DeckUtilityButtonsProps> = ({
  deckId,
  ejectEnabled,
  referenceEnabled,
  isReference,
  onEject,
  onToggleReference,
  onToggleMode,
}) => {
  const { t } = useTranslation();
  const id = deckId.toLowerCase();
  const referenceLit = referenceEnabled && isReference;

  return (
    <div className="deck-utility" role="group" aria-label={t(`dj.deck_${id}`)}>
      <HardwareButton
        variant="momentary"
        lit={ejectEnabled}
        disabled={!ejectEnabled}
        icon={<Eject />}
        caption={t('dj.eject_button')}
        aria-label={t('dj.eject')}
        title={t('dj.eject_title')}
        data-testid={`deck-${id}-eject`}
        onClick={onEject}
      />
      <HardwareButton
        variant="latching"
        lit={referenceLit}
        disabled={!referenceEnabled}
        icon={<Target />}
        caption={t('dj.reference_short')}
        aria-label={t('dj.reference_button')}
        aria-pressed={referenceLit}
        title={t(referenceLit ? 'seed.unmark' : 'seed.mark')}
        data-testid={`deck-${id}-reference`}
        onClick={onToggleReference}
      />
      <HardwareButton
        variant="momentary"
        lit
        icon={<ArrowLeftRight />}
        caption={t('dj.display_mode')}
        aria-label={t('dj.display_mode_button')}
        title={t('dj.display_mode_button')}
        data-testid={`deck-${id}-mode`}
        onClick={onToggleMode}
      />
    </div>
  );
};
