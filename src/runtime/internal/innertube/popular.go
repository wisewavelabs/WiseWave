package innertube

import (
	"fmt"
	"strings"
	"wisewave-runtime/internal/models"
)

func chartPlaylist(root interface{}) string {
	var id string
	walkCatalog(root, func(node map[string]interface{}) {
		if id != "" {
			return
		}
		shelf := object(node["musicCarouselShelfRenderer"])
		for _, item := range array(shelf["contents"]) {
			renderer := object(object(item)["musicTwoRowItemRenderer"])
			candidate := stringValue(object(object(renderer["navigationEndpoint"])["browseEndpoint"])["browseId"])
			if strings.HasPrefix(candidate, "VL") {
				id = candidate
				return
			}
		}
	})
	return id
}
func (client *Client) Popular() ([]models.Track, error) {
	root, err := client.browse("FEmusic_charts")
	if err != nil {
		return nil, err
	}
	id := chartPlaylist(root)
	if id == "" {
		return nil, fmt.Errorf("charts unavailable")
	}
	playlist, err := client.browse(id)
	if err != nil {
		return nil, err
	}
	_, _, tracks := catalogItems(playlist)
	if len(tracks) == 0 {
		return nil, fmt.Errorf("charts unavailable")
	}
	if len(tracks) > 20 {
		tracks = tracks[:20]
	}
	return tracks, nil
}
