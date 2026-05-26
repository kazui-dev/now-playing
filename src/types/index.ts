export interface NowPlayingTrack {
  title: string;
  album: string;
  artists: string[];
  imageUrl: string;
  spotifyUrl: string;
  durationMs: number;
}

export interface NowPlayingResponse {
  isPlaying: boolean;
  track?: NowPlayingTrack;
  progressMs?: number;
  startAt?: number;
  endAt?: number;
  serverTime: number;
}
