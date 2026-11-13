export type ListeningRange = "today" | "7d" | "30d" | "month" | "year" | "all";

export type RewindKind = "month" | "year";

export interface ListeningOverview {
  listened_ms: number;
  plays: number;
  tracks: number;
  artists: number;
  albums: number;
  average_daily_ms: number;
  longest_session_ms: number;
  current_streak: number;
  longest_streak: number;
  most_active_day: string;
  most_active_day_ms: number;
  most_active_hour: number;
  most_active_hour_ms: number;
  previous_listened_ms?: number;
}

export interface ListeningDay {
  date: string;
  listened_ms: number;
  plays: number;
}

export interface ListeningHour {
  hour: number;
  listened_ms: number;
  plays: number;
}

export interface ListeningActivity {
  days: ListeningDay[];
  hours: ListeningHour[];
}

export interface ListeningTopTrack {
  track_id: string;
  title: string;
  artist: string;
  artist_id: string;
  album: string;
  album_id: string;
  artwork_url: string;
  listened_ms: number;
  plays: number;
  last_played_ms: number;
  track_duration_ms: number;
}

export interface ListeningTopArtist {
  artist_id: string;
  name: string;
  artwork_url: string;
  listened_ms: number;
  plays: number;
  tracks: number;
}

export interface ListeningTopAlbum {
  album_id: string;
  title: string;
  artist: string;
  artist_id: string;
  artwork_url: string;
  listened_ms: number;
  plays: number;
  tracks: number;
}

export interface ListeningPlay {
  id: number;
  track_id: string;
  title: string;
  artist: string;
  artist_id: string;
  album: string;
  album_id: string;
  artwork_url: string;
  started_at_ms: number;
  ended_at_ms: number;
  listened_ms: number;
  track_duration_ms: number;
  qualified: boolean;
  completed: boolean;
  session_id: string;
}

export interface ListeningHistoryPage {
  items: ListeningPlay[];
  total: number;
}

export interface ListeningSession {
  id: string;
  started_at_ms: number;
  ended_at_ms: number;
  listened_ms: number;
  plays: number;
  top_artist: string;
  top_artist_id: string;
  tracks: ListeningPlay[];
}

export interface ListeningInsight {
  kind: string;
  title: string;
  detail: string;
  track_id: string;
  title_name: string;
  artist: string;
  artist_id: string;
  artwork_url: string;
  listened_ms: number;
  plays: number;
}

export interface ListeningInsights {
  on_repeat: ListeningTopTrack[];
  night_owl: boolean;
  early_bird: boolean;
  discoveries: ListeningTopArtist[];
  old_favorites: ListeningTopTrack[];
  current_streak: number;
  longest_streak: number;
  milestones: string[];
}

export interface ListeningRewind {
  kind: string;
  label: string;
  year: number;
  month: number;
  listened_ms: number;
  plays: number;
  tracks: number;
  artists: number;
  albums: number;
  top_tracks: ListeningTopTrack[];
  top_artists: ListeningTopArtist[];
  top_albums: ListeningTopAlbum[];
  discoveries: ListeningTopArtist[];
  milestones: string[];
  records: ListeningInsight[];
  changes: string[];
}
