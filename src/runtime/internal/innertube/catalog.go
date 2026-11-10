package innertube

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"wisewave-runtime/internal/models"
)

type CatalogArtist struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	ArtworkURL string `json:"artwork_url"`
}
type CatalogAlbum struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Artist     string `json:"artist"`
	ArtworkURL string `json:"artwork_url"`
	Year       string `json:"year"`
}

type CatalogPlaylist struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Author     string `json:"author"`
	ArtworkURL string `json:"artwork_url"`
}

type PlaylistDetail struct {
	CatalogPlaylist
	Description string         `json:"description"`
	Tracks      []models.Track `json:"tracks"`
}
type ArtistDetail struct {
	CatalogArtist
	BannerURL        string         `json:"banner_url"`
	Description      string         `json:"description"`
	Subscribers      string         `json:"subscribers"`
	MonthlyListeners string         `json:"monthly_listeners"`
	Tracks           []models.Track `json:"tracks"`
	Albums           []CatalogAlbum `json:"albums"`
}
type AlbumDetail struct {
	CatalogAlbum
	Description string         `json:"description"`
	Tracks      []models.Track `json:"tracks"`
}
type byline struct{ artist, artistID, album, albumID string }

func object(value interface{}) map[string]interface{} {
	result, _ := value.(map[string]interface{})
	return result
}
func array(value interface{}) []interface{} { result, _ := value.([]interface{}); return result }
func stringValue(value interface{}) string  { result, _ := value.(string); return result }
func browseID(value interface{}) string {
	return stringValue(object(object(object(value)["navigationEndpoint"])["browseEndpoint"])["browseId"])
}
func textValue(value interface{}) string {
	item := object(value)
	if text := stringValue(item["simpleText"]); text != "" {
		return text
	}
	var result strings.Builder
	for _, run := range array(item["runs"]) {
		result.WriteString(stringValue(object(run)["text"]))
	}
	return result.String()
}
func isArtistID(id string) bool { return strings.HasPrefix(id, "UC") }
func isAlbumID(id string) bool  { return strings.HasPrefix(id, "MPRE") || strings.HasPrefix(id, "MPLA") }
func isPlaylistID(id string) bool {
	return strings.HasPrefix(id, "VL") || strings.HasPrefix(id, "PL") || strings.HasPrefix(id, "OLAK5uy_")
}
func normalizePlaylistID(id string) string {
	id = strings.TrimSpace(id)
	if id == "" {
		return ""
	}
	if strings.HasPrefix(id, "VL") || strings.HasPrefix(id, "OLAK5uy_") {
		return id
	}
	if strings.HasPrefix(id, "PL") {
		return "VL" + id
	}
	return id
}

func parseByline(value interface{}) byline {
	result := byline{}
	artists := []string{}
	for _, run := range array(object(value)["runs"]) {
		id := browseID(run)
		text := strings.TrimSpace(stringValue(object(run)["text"]))
		if text == "" {
			continue
		}
		if isArtistID(id) {
			artists = append(artists, text)
			if result.artistID == "" {
				result.artistID = id
			}
		} else if isAlbumID(id) {
			result.album, result.albumID = text, id
		}
	}
	result.artist = strings.Join(artists, " & ")
	if result.artist == "" {
		first := strings.TrimSpace(strings.Split(textValue(value), " • ")[0])
		if first != "Song" && first != "Video" && first != "Album" && first != "Single" && first != "EP" && !yearPattern.MatchString(first) && !strings.Contains(first, ":") && result.albumID == "" {
			result.artist = first
		}
	}
	return result
}

var yearPattern = regexp.MustCompile(`^(19|20)\d{2}$`)
var catalogIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{3,160}$`)

func ValidCatalogID(id string, artist bool) bool {
	return catalogIDPattern.MatchString(id) && ((artist && isArtistID(id)) || (!artist && isAlbumID(id)))
}

func ValidPlaylistID(id string) bool {
	return catalogIDPattern.MatchString(id) && isPlaylistID(id)
}

func walkCatalog(value interface{}, visit func(map[string]interface{})) {
	switch node := value.(type) {
	case map[string]interface{}:
		visit(node)
		keys := make([]string, 0, len(node))
		for key := range node {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			walkCatalog(node[key], visit)
		}
	case []interface{}:
		for _, child := range node {
			walkCatalog(child, visit)
		}
	}
}

func artwork(value interface{}) string {
	result := ""
	walkCatalog(value, func(node map[string]interface{}) {
		for _, thumbnail := range array(node["thumbnails"]) {
			if url := stringValue(object(thumbnail)["url"]); url != "" {
				result = url
			}
		}
	})
	return UpgradeArtworkURL(result)
}

func (client *Client) catalogRequest(method string, payload map[string]interface{}) (map[string]interface{}, error) {
	payload["context"] = map[string]interface{}{"client": map[string]interface{}{"clientName": "WEB_REMIX", "clientVersion": PlayerClients[3].Version, "hl": "en", "gl": "US"}}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequest(http.MethodPost, "https://music.youtube.com/youtubei/v1/"+method+"?key="+PlayerClients[3].APIKey, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", PlayerClients[3].UserAgent)
	request.Header.Set("Origin", "https://music.youtube.com")
	response, err := client.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("catalog unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("catalog unavailable")
	}
	var root map[string]interface{}
	err = json.NewDecoder(io.LimitReader(response.Body, 8<<20)).Decode(&root)
	if err != nil {
		return nil, fmt.Errorf("catalog response unavailable")
	}
	return root, nil
}

type catalogEntry struct {
	root    map[string]interface{}
	expires time.Time
}

var catalogCache = struct {
	sync.Mutex
	entries map[string]catalogEntry
}{entries: make(map[string]catalogEntry)}

func (client *Client) browse(id string) (map[string]interface{}, error) {
	catalogCache.Lock()
	defer catalogCache.Unlock()
	if cached, ok := catalogCache.entries[id]; ok && time.Now().Before(cached.expires) {
		return cached.root, nil
	}
	root, err := client.catalogRequest("browse", map[string]interface{}{"browseId": id})
	if err != nil {
		return nil, err
	}
	if len(catalogCache.entries) >= 64 {
		for key, entry := range catalogCache.entries {
			if time.Now().After(entry.expires) {
				delete(catalogCache.entries, key)
			}
		}
		if len(catalogCache.entries) >= 64 {
			for key := range catalogCache.entries {
				delete(catalogCache.entries, key)
				break
			}
		}
	}
	catalogCache.entries[id] = catalogEntry{root: root, expires: time.Now().Add(10 * time.Minute)}
	return root, nil
}

func catalogItems(root interface{}) ([]CatalogArtist, []CatalogAlbum, []models.Track) {
	artists, albums, _, tracks := catalogSearchItems(root)
	return artists, albums, tracks
}

func catalogSearchItems(root interface{}) ([]CatalogArtist, []CatalogAlbum, []CatalogPlaylist, []models.Track) {
	artists := []CatalogArtist{}
	albums := []CatalogAlbum{}
	playlists := []CatalogPlaylist{}
	tracks := []models.Track{}
	seenArtists := map[string]bool{}
	seenAlbums := map[string]bool{}
	seenPlaylists := map[string]bool{}
	seenTracks := map[string]bool{}
	walkCatalog(root, func(node map[string]interface{}) {
		if renderer := object(node["musicResponsiveListItemRenderer"]); renderer != nil {
			if track := extractTrackFromRenderer(renderer); track != nil && !seenTracks[track.ID] && len(tracks) < 200 {
				tracks = append(tracks, *track)
				seenTracks[track.ID] = true
			}
		}
		renderer := object(node["musicTwoRowItemRenderer"])
		if renderer == nil {
			renderer = object(node["musicResponsiveListItemRenderer"])
		}
		if renderer == nil {
			return
		}
		id := browseID(renderer)
		if id == "" {
			id = stringValue(object(object(object(renderer["navigationEndpoint"])["watchEndpoint"])["playlistId"]))
			id = normalizePlaylistID(id)
		}
		title := textValue(renderer["title"])
		subtitle := renderer["subtitle"]
		if columns := array(renderer["flexColumns"]); len(columns) > 0 {
			title = textValue(object(object(columns[0])["musicResponsiveListItemFlexColumnRenderer"])["text"])
			if len(columns) > 1 {
				subtitle = object(object(columns[1])["musicResponsiveListItemFlexColumnRenderer"])["text"]
			}
		}
		if title == "" {
			return
		}
		image := artwork(renderer["thumbnailRenderer"])
		if image == "" {
			image = artwork(renderer["thumbnail"])
		}
		if isArtistID(id) && !seenArtists[id] && len(artists) < 100 {
			artists = append(artists, CatalogArtist{ID: id, Name: title, ArtworkURL: image})
			seenArtists[id] = true
		}
		if isAlbumID(id) && !seenAlbums[id] && len(albums) < 100 {
			metadata := parseByline(subtitle)
			albums = append(albums, CatalogAlbum{ID: id, Title: title, Artist: metadata.artist, ArtworkURL: image, Year: findYear(subtitle)})
			seenAlbums[id] = true
		}
		if isPlaylistID(id) && !seenPlaylists[id] && len(playlists) < 100 {
			metadata := parseByline(subtitle)
			author := metadata.artist
			if author == "" {
				author = strings.TrimSpace(textValue(subtitle))
			}
			playlists = append(playlists, CatalogPlaylist{ID: normalizePlaylistID(id), Title: title, Author: author, ArtworkURL: image})
			seenPlaylists[id] = true
		}
	})
	return artists, albums, playlists, tracks
}

func findYear(value interface{}) string {
	for _, run := range array(object(value)["runs"]) {
		text := strings.TrimSpace(stringValue(object(run)["text"]))
		if yearPattern.MatchString(text) {
			return text
		}
	}
	return ""
}

func catalogHeader(root interface{}) map[string]interface{} {
	var header map[string]interface{}
	walkCatalog(root, func(node map[string]interface{}) {
		for _, key := range []string{"musicImmersiveHeaderRenderer", "musicVisualHeaderRenderer", "musicResponsiveHeaderRenderer", "musicDetailHeaderRenderer"} {
			if candidate := object(node[key]); candidate != nil && header == nil {
				header = candidate
			}
		}
	})
	return header
}

var wikipediaFooter = regexp.MustCompile(`(?im)(?:^|\n)[\t ]*(?:from wikipedia\b|source:[\t ]*wikipedia\b)`)

func artistBiography(description string) string {
	if footer := wikipediaFooter.FindStringIndex(description); footer != nil {
		description = description[:footer[0]]
	}
	return strings.TrimSpace(description)
}

func artistSongsEndpoint(root interface{}) map[string]interface{} {
	var endpoint map[string]interface{}
	walkCatalog(root, func(node map[string]interface{}) {
		if endpoint != nil {
			return
		}
		for _, key := range []string{"musicShelfRenderer", "musicCarouselShelfRenderer"} {
			shelf := object(node[key])
			if shelf == nil {
				continue
			}
			heading := textValue(shelf["title"])
			if heading == "" {
				walkCatalog(shelf["header"], func(item map[string]interface{}) {
					if heading == "" {
						heading = textValue(item["title"])
					}
				})
			}
			heading = strings.ToLower(heading)
			if !strings.Contains(heading, "song") && !strings.Contains(heading, "track") {
				continue
			}
			for _, part := range []interface{}{shelf["bottomEndpoint"], shelf["bottomText"], shelf["title"], shelf["header"]} {
				walkCatalog(part, func(item map[string]interface{}) {
					if browse := object(item["browseEndpoint"]); endpoint == nil && browse != nil && stringValue(browse["browseId"]) != "" {
						endpoint = browse
					}
				})
			}
		}
	})
	return endpoint
}

func (client *Client) artistSongs(root interface{}) []models.Track {
	endpoint := artistSongsEndpoint(root)
	if endpoint == nil {
		return nil
	}
	payload := map[string]interface{}{"browseId": stringValue(endpoint["browseId"])}
	if params := stringValue(endpoint["params"]); params != "" {
		payload["params"] = params
	}
	var tracks []models.Track
	seenTracks := map[string]bool{}
	seenContinuations := map[string]bool{}
	for len(tracks) < 200 {
		page, err := client.catalogRequest("browse", payload)
		if err != nil {
			break
		}
		_, _, found := catalogItems(page)
		for _, track := range found {
			if !seenTracks[track.ID] {
				tracks = append(tracks, track)
				seenTracks[track.ID] = true
			}
		}
		continuation := ""
		walkCatalog(page, func(node map[string]interface{}) {
			if continuation == "" {
				continuation = stringValue(object(node["nextContinuationData"])["continuation"])
				if continuation == "" {
					continuation = stringValue(object(node["continuationCommand"])["token"])
				}
			}
		})
		if continuation == "" || seenContinuations[continuation] || len(seenContinuations) >= 10 {
			break
		}
		seenContinuations[continuation] = true
		payload = map[string]interface{}{"continuation": continuation}
	}
	return tracks
}

func artistBanner(header map[string]interface{}) string {
	banner, width := "", 0.0
	walkCatalog(header["thumbnail"], func(node map[string]interface{}) {
		for _, value := range array(node["thumbnails"]) {
			thumbnail := object(value)
			w, _ := thumbnail["width"].(float64)
			h, _ := thumbnail["height"].(float64)
			if w > h && h > 0 && (width == 0 || (w > width && w <= 1440) || (width > 1440 && w < width)) {
				banner, width = stringValue(thumbnail["url"]), w
			}
		}
	})
	return banner
}

func artistAlbums(root interface{}) []CatalogAlbum {
	albums := []CatalogAlbum{}
	walkCatalog(root, func(node map[string]interface{}) {
		shelf := object(node["musicCarouselShelfRenderer"])
		if shelf == nil {
			return
		}
		header := object(object(shelf["header"])["musicCarouselShelfBasicHeaderRenderer"])
		if strings.EqualFold(textValue(header["title"]), "Albums") {
			_, albums, _ = catalogItems(shelf["contents"])
		}
	})
	return albums
}

func (client *Client) Artist(id string) (*ArtistDetail, error) {
	if !ValidCatalogID(id, true) {
		return nil, fmt.Errorf("invalid artist")
	}
	root, err := client.browse(id)
	if err != nil {
		return nil, err
	}
	header := catalogHeader(root)
	name := textValue(header["title"])
	if name == "" {
		return nil, fmt.Errorf("artist unavailable")
	}
	_, _, tracks := catalogItems(root)
	albums := artistAlbums(root)
	if expanded := client.artistSongs(root); len(expanded) > 0 {
		tracks = expanded
	}
	description := textValue(header["description"])
	walkCatalog(root, func(node map[string]interface{}) {
		if shelf := object(node["musicDescriptionShelfRenderer"]); shelf != nil && description == "" {
			description = textValue(shelf["description"])
		}
	})
	subscribers := textValue(header["subscriberCountText"])
	if subscribers == "" {
		subscription := object(object(header["subscriptionButton"])["subscribeButtonRenderer"])
		subscribers = textValue(subscription["longSubscriberCountText"])
	}
	return &ArtistDetail{CatalogArtist: CatalogArtist{ID: id, Name: name, ArtworkURL: artwork(header["thumbnail"])}, BannerURL: artistBanner(header), Description: artistBiography(description), Subscribers: subscribers, MonthlyListeners: textValue(header["monthlyListenerCount"]), Tracks: tracks, Albums: albums}, nil
}

func (client *Client) Album(id string) (*AlbumDetail, error) {
	if !ValidCatalogID(id, false) {
		return nil, fmt.Errorf("invalid album")
	}
	root, err := client.browse(id)
	if err != nil {
		return nil, err
	}
	header := catalogHeader(root)
	title := textValue(header["title"])
	if title == "" {
		return nil, fmt.Errorf("album unavailable")
	}
	metadata := parseByline(header["subtitle"])
	if metadata.artist == "" {
		metadata = parseByline(header["straplineTextOne"])
	}
	_, _, tracks := catalogItems(root)
	image := artwork(header["thumbnail"])
	for i := range tracks {
		tracks[i].AlbumID = id
		tracks[i].Album = title
		if tracks[i].Artist == "" {
			tracks[i].Artist = metadata.artist
			tracks[i].ArtistID = metadata.artistID
		}
		if tracks[i].AlbumArtURL == "" {
			tracks[i].AlbumArtURL = image
		}
	}
	return &AlbumDetail{CatalogAlbum: CatalogAlbum{ID: id, Title: title, Artist: metadata.artist, ArtworkURL: image, Year: findYear(header["subtitle"])}, Description: textValue(header["description"]), Tracks: tracks}, nil
}

func (client *Client) SearchCatalog(query string, kind string) (interface{}, error) {
	params := ""
	switch kind {
	case "artists":
		params = "EgWKAQIgAWoKEAkQChAFEAMQBA=="
	case "albums":
		params = "EgWKAQIYAWoKEAkQChAFEAMQBA=="
	case "playlists":
		params = "EgWKAQIoAWoKEAkQChAFEAMQBA=="
	}
	payload := map[string]interface{}{"query": query}
	if params != "" {
		payload["params"] = params
	}
	root, err := client.catalogRequest("search", payload)
	if err != nil {
		return nil, err
	}
	artists, albums, playlists, _ := catalogSearchItems(root)
	if kind == "" || kind == "top" {
		// Unfiltered search returns top shelves across types.
		return map[string]interface{}{"artists": artists, "albums": albums, "playlists": playlists}, nil
	}
	switch kind {
	case "artists":
		if len(artists) == 0 {
			if top, topErr := client.catalogRequest("search", map[string]interface{}{"query": query}); topErr == nil {
				artists, _, _, _ = catalogSearchItems(top)
			}
		}
		return artists, nil
	case "albums":
		if len(albums) == 0 {
			if top, topErr := client.catalogRequest("search", map[string]interface{}{"query": query}); topErr == nil {
				_, albums, _, _ = catalogSearchItems(top)
			}
		}
		return albums, nil
	case "playlists":
		if len(playlists) == 0 {
			if top, topErr := client.catalogRequest("search", map[string]interface{}{"query": query}); topErr == nil {
				_, _, playlists, _ = catalogSearchItems(top)
			}
		}
		return playlists, nil
	default:
		return albums, nil
	}
}

func (client *Client) Playlist(id string) (*PlaylistDetail, error) {
	browse := normalizePlaylistID(id)
	if !ValidPlaylistID(browse) && !ValidPlaylistID(id) {
		return nil, fmt.Errorf("invalid playlist")
	}
	if browse == "" {
		browse = id
	}
	root, err := client.browse(browse)
	if err != nil {
		return nil, err
	}
	header := catalogHeader(root)
	title := textValue(header["title"])
	if title == "" {
		return nil, fmt.Errorf("playlist unavailable")
	}
	metadata := parseByline(header["subtitle"])
	if metadata.artist == "" {
		metadata = parseByline(header["straplineTextOne"])
	}
	_, _, tracks := catalogItems(root)
	image := artwork(header["thumbnail"])
	for i := range tracks {
		if tracks[i].AlbumArtURL == "" {
			tracks[i].AlbumArtURL = image
		}
	}
	return &PlaylistDetail{
		CatalogPlaylist: CatalogPlaylist{ID: browse, Title: title, Author: metadata.artist, ArtworkURL: image},
		Description:     textValue(header["description"]),
		Tracks:          tracks,
	}, nil
}

func (client *Client) NewReleases() ([]CatalogAlbum, error) {
	root, err := client.catalogRequest("browse", map[string]interface{}{"browseId": "FEmusic_new_releases_albums"})
	if err != nil {
		return nil, err
	}
	_, albums, _ := catalogItems(root)
	return albums, nil
}
