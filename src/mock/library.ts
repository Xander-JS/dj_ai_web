export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  bpm: number;
  key: string;
  energy: number; // 0 to 10
  duration: string;
  type: 'audio' | 'video';
}

export const MOCK_LIBRARY: Track[] = [
  { id: '1', title: 'Strobe (Club Edit)', artist: 'deadmau5', album: 'For Lack of a Better Name', bpm: 128, key: 'F#m', energy: 8, duration: '6:15', type: 'audio' },
  { id: '2', title: 'Innerbloom', artist: 'RÜFÜS DU SOL', album: 'Bloom', bpm: 122, key: 'Cm', energy: 7, duration: '9:38', type: 'audio' },
  { id: '3', title: 'Opus', artist: 'Eric Prydz', album: 'Opus', bpm: 126, key: 'Fm', energy: 9, duration: '9:03', type: 'audio' },
  { id: '4', title: 'Midnight City', artist: 'M83', album: 'Hurry Up, We\'re Dreaming', bpm: 105, key: 'Bm', energy: 8, duration: '4:03', type: 'audio' },
  { id: '5', title: 'Latch', artist: 'Disclosure ft. Sam Smith', album: 'Settle', bpm: 122, key: 'Fm', energy: 7, duration: '4:16', type: 'video' },
  { id: '6', title: 'One More Time', artist: 'Daft Punk', album: 'Discovery', bpm: 123, key: 'D', energy: 9, duration: '5:20', type: 'audio' },
  { id: '7', title: 'Inspector Norse', artist: 'Todd Terje', album: 'It\'s Album Time', bpm: 120, key: 'G', energy: 8, duration: '6:40', type: 'audio' },
  { id: '8', title: 'Bicep', artist: 'Glue', album: 'Bicep', bpm: 130, key: 'Am', energy: 6, duration: '4:29', type: 'audio' },
  { id: '9', title: 'Losing It', artist: 'FISHER', album: 'Losing It', bpm: 125, key: 'F', energy: 10, duration: '4:08', type: 'audio' },
  { id: '10', title: 'Titanium', artist: 'David Guetta ft. Sia', album: 'Nothing but the Beat', bpm: 126, key: 'Eb', energy: 9, duration: '4:05', type: 'video' }
];
