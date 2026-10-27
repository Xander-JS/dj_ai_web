import { useTranslation } from 'react-i18next';
import { getDeckMessage, translatePanelMessage, type DeckMessageInput, type DeckMessageLevel } from '../services/console/deckPanelModel';

export interface DeckDisplayMessage {
  level: DeckMessageLevel;
  text: string;
  /** Identidad del mensaje, independiente del idioma: cambia solo cuando cambia el mensaje. */
  id: string;
}

/** Mensaje de mayor prioridad del deck, traducido, para su display LED. */
export function useDeckMessage(input: DeckMessageInput): DeckDisplayMessage | null {
  const { t } = useTranslation();
  const message = getDeckMessage(input);
  if (!message) return null;
  return {
    level: message.level,
    text: translatePanelMessage(t, message.message),
    id: `${message.level}:${JSON.stringify(message.message)}`,
  };
}
