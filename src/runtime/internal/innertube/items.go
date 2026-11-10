package innertube

import (
	"net/url"
	"strings"
)

type ItemKind string

const (
	KindTrack     ItemKind = "track"
	KindMusicItem ItemKind = "music_item"
	KindVideo     ItemKind = "video"
	KindPlaylist  ItemKind = "playlist"
	KindAlbum     ItemKind = "album"
	KindArtist    ItemKind = "artist"

	KindEpisode ItemKind = "episode"
)

type TargetKind uint8

const (
	TargetNone TargetKind = iota

	TargetTrack

	TargetAlbum
	TargetPlaylist
	TargetArtist
	TargetPodcast
)

type Target struct {
	Kind TargetKind
	ID   string
}

func (t Target) Opens() bool {
	return t.Kind == TargetAlbum || t.Kind == TargetPlaylist || t.Kind == TargetArtist || t.Kind == TargetPodcast
}

func (item MusicItem) Target() Target {
	browse, playlist := item.BrowseID, item.PlaylistID
	if playlist == "" {
		playlist = browse
	}
	album, list := musicIsAlbumID(browse), isBrowsablePlaylist(playlist)
	switch {
	case item.VideoID != "" && !album && !list:
		return Target{TargetTrack, item.VideoID}
	case album:
		return Target{TargetAlbum, browse}
	case list:
		return Target{TargetPlaylist, playlist}
	case isPodcastID(browse):
		return Target{TargetPodcast, browse}
	case musicIsArtistID(browse):
		return Target{TargetArtist, browse}
	case item.VideoID != "":
		return Target{TargetTrack, item.VideoID}
	}
	return Target{}
}

func (item MusicItem) IsTrack() bool { return item.Target().Kind == TargetTrack }

func (item MusicItem) IsEpisode() bool { return item.Kind == KindEpisode }

func (item MusicItem) IsVideo() bool { return item.Kind == KindVideo }

func (item MusicItem) ArtistID() string {
	if item.VideoID != "" && musicIsArtistID(item.BrowseID) {
		return item.BrowseID
	}
	return ""
}

func WatchURL(videoID string) string {
	return "https://music.youtube.com/watch?v=" + url.QueryEscape(videoID)
}

func BrowseURL(browseID string) string {
	return "https://music.youtube.com/browse/" + url.PathEscape(browseID)
}

func musicIsAlbumID(id string) bool {
	return strings.HasPrefix(id, "MPR") || strings.Contains(id, "privately_owned_release")
}

func isPodcastID(id string) bool { return strings.HasPrefix(id, "MPSPP") }

func episodeVideoIDFromBrowseID(id string) string {
	videoID, ok := strings.CutPrefix(id, "MPED")
	if !ok || len(videoID) != 11 {
		return ""
	}
	return videoID
}

func musicIsArtistID(id string) bool {
	return strings.HasPrefix(id, "UC") || strings.Contains(id, "privately_owned_artist")
}

func isBrowsablePlaylist(id string) bool {
	return strings.HasPrefix(id, "VL") || strings.HasPrefix(id, "PL")
}

type MusicItem struct {
	ID            string   `json:"id,omitempty"`
	VideoID       string   `json:"videoId,omitempty"`
	BrowseID      string   `json:"browseId,omitempty"`
	PlaylistID    string   `json:"playlistId,omitempty"`
	PlaylistSetID string   `json:"playlistSetVideoId,omitempty"`
	Title         string   `json:"title,omitempty"`
	Subtitle      string   `json:"subtitle,omitempty"`
	Kind          ItemKind `json:"kind,omitempty"`
	Duration      string   `json:"duration,omitempty"`
	Thumbnail     string   `json:"thumbnail,omitempty"`

	Description string `json:"-"`

	ProgressPercent int `json:"-"`

	Like LikeStatus `json:"-"`

	Library *LibraryState `json:"-"`

	Artist string `json:"artist,omitempty"`

	Artists string `json:"artists,omitempty"`
	Album   string `json:"album,omitempty"`
}

func (item *MusicItem) setCredits(artists []string, album string) {
	item.Album = album
	item.Artists = strings.Join(artists, ", ")
	item.Artist = ""
	if len(artists) > 0 {
		item.Artist = artists[0]
	}
}
