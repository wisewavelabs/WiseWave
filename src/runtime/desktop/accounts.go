package desktop

import "wisewave-runtime/desktop/accounts/YouTube"

func NewYouTubeAccount(music *Music) *youtube.YouTubeAccount {
	return youtube.NewYouTubeAccount(music.client.MusicClient)
}
