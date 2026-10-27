/**
 * Fuente completa del deck (secciones 2 y 3) para las pruebas que inspeccionan el código: el
 * organismo, sus moléculas y átomos y el modelo puro que decide textos, luces y avisos.
 */

import fs from 'node:fs';
import path from 'node:path';

const DECK_SOURCE_FILES = [
  'src/components/dj/organisms/Deck.tsx',
  'src/components/dj/molecules/DeckNoticeStrip.tsx',
  'src/components/dj/molecules/DeckSyncRow.tsx',
  'src/components/dj/molecules/DeckHotCues.tsx',
  'src/components/dj/molecules/DeckTransport.tsx',
  'src/components/dj/molecules/DeckPitchFader.tsx',
  'src/components/dj/atoms/JogWheel.tsx',
  'src/components/dj/atoms/ConsoleBadge.tsx',
  'src/services/console/deckPanelModel.ts',
];

const DECK_CSS_FILES = [
  'src/components/dj/organisms/Deck.css',
  'src/components/dj/molecules/DeckNoticeStrip.css',
  'src/components/dj/molecules/DeckSyncRow.css',
  'src/components/dj/molecules/DeckHotCues.css',
  'src/components/dj/molecules/DeckTransport.css',
  'src/components/dj/molecules/DeckPitchFader.css',
  'src/components/dj/atoms/JogWheel.css',
  'src/components/dj/atoms/ConsoleBadge.css',
  'src/components/dj/atoms/ConsoleKey.css',
];

const read = (files: readonly string[]): string =>
  files.map((file) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8')).join('\n');

export const readDeckSource = (): string => read(DECK_SOURCE_FILES);
export const readDeckCss = (): string => read(DECK_CSS_FILES);
