package innertube

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"wisewave-runtime/internal/models"
)

func (client *Client) Related(videoID string) ([]models.Track, error) {
	return client.RelatedMulti([]string{videoID})
}

func (client *Client) RelatedMulti(videoIDs []string) ([]models.Track, error) {
	if len(videoIDs) == 0 {
		return nil, fmt.Errorf("no video IDs provided for radio")
	}

	primaryID := videoIDs[0]
	playlistID := "RDAMVM" + primaryID
	if len(videoIDs) > 1 {
		playlistID = "RDAMVM" + strings.Join(videoIDs, ",")
	}

	hl := "en"
	gl := "US"
	if client.MusicClient != nil {
		if client.MusicClient.language != "" {
			hl = client.MusicClient.language
		}
		if client.MusicClient.country != "" {
			gl = client.MusicClient.country
		}
	}

	payload, err := json.Marshal(map[string]interface{}{
		"context": map[string]interface{}{
			"client": map[string]interface{}{
				"clientName":    "WEB_REMIX",
				"clientVersion": PlayerClients[3].Version,
				"hl":            hl,
				"gl":            gl,
			},
		},
		"videoId":     primaryID,
		"playlistId":  playlistID,
		"isAudioOnly": true,
	})
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequest(http.MethodPost, "https://music.youtube.com/youtubei/v1/next?key="+PlayerClients[3].APIKey, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", PlayerClients[3].UserAgent)
	response, err := client.httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("radio request failed")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	var root interface{}
	if err = json.Unmarshal(data, &root); err != nil {
		return nil, err
	}
	tracks := []models.Track{}
	seen := map[string]bool{}
	for _, id := range videoIDs {
		seen[id] = true
	}

	var walk func(interface{})
	walk = func(value interface{}) {
		switch node := value.(type) {
		case map[string]interface{}:
			if item, ok := node["playlistPanelVideoRenderer"].(map[string]interface{}); ok {
				id, _ := item["videoId"].(string)
				text := func(key string) string {
					textField, _ := item[key].(map[string]interface{})
					if simple, ok := textField["simpleText"].(string); ok {
						return simple
					}
					result := ""
					runs, _ := textField["runs"].([]interface{})
					for _, run := range runs {
						if textRun, ok := run.(map[string]interface{}); ok {
							text, _ := textRun["text"].(string)
							result += text
						}
					}
					return result
				}
				title := text("title")
				if id != "" && !seen[id] && !IsJunkTrack(title, "") {
					seen[id] = true
					artwork := ""
					thumbnail, _ := item["thumbnail"].(map[string]interface{})
					images, _ := thumbnail["thumbnails"].([]interface{})
					if len(images) > 0 {
						if image, ok := images[len(images)-1].(map[string]interface{}); ok {
							artwork, _ = image["url"].(string)
						}
					}
					duration := text("lengthText")
					metadata := parseByline(item["longBylineText"])
					tracks = append(tracks, models.Track{
						ID:              id,
						Title:           title,
						Artist:          metadata.artist,
						ArtistID:        metadata.artistID,
						Album:           metadata.album,
						AlbumID:         metadata.albumID,
						Duration:        duration,
						DurationSeconds: parseDurationSeconds(duration),
						AlbumArtURL:     UpgradeArtworkURL(artwork),
						StreamURL:       "/api/v1/stream/" + url.PathEscape(id),
					})
				}
			}
			for _, child := range node {
				walk(child)
			}
		case []interface{}:
			for _, child := range node {
				walk(child)
			}
		}
	}
	walk(root)
	return tracks, nil
}
