import { type Track, MOCK_LIBRARY } from './library';

export interface Playlist {
  id: string;
  name: string;
  description: string;
  coverColor: string;
  tracks: Track[];
}

export const MOCK_PLAYLISTS: Playlist[] = [
  {
    id: 'p1',
    name: 'Deep House Vibes',
    description: 'Perfect for late night mixing and chill sessions.',
    coverColor: 'hsl(260, 70%, 55%)',
    tracks: [MOCK_LIBRARY[0], MOCK_LIBRARY[1], MOCK_LIBRARY[3]]
  },
  {
    id: 'p2',
    name: 'Techno Bunker',
    description: 'High energy techno tracks for peak time.',
    coverColor: 'hsl(348, 80%, 50%)',
    tracks: [MOCK_LIBRARY[2], MOCK_LIBRARY[7], MOCK_LIBRARY[8]]
  },
  {
    id: 'p3',
    name: 'Sunset Chill',
    description: 'Warm grooves for the sunset.',
    coverColor: 'hsl(38, 90%, 50%)',
    tracks: [MOCK_LIBRARY[4], MOCK_LIBRARY[5], MOCK_LIBRARY[6]]
  },
  {
    id: 'p4',
    name: 'Empty Playlist',
    description: 'Just started building this one.',
    coverColor: 'hsl(142, 70%, 45%)',
    tracks: []
  }
];
