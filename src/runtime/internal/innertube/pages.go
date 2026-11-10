package innertube

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
)

type BrowseResult struct {
	Title     string `json:"title,omitempty"`
	Thumbnail string `json:"thumbnail,omitempty"`

	Description       string         `json:"description,omitempty"`
	Items             []MusicItem    `json:"items"`
	Sections          []MusicSection `json:"sections,omitempty"`
	ContinuationToken string         `json:"continuationToken,omitempty"`

	Library LibraryState `json:"-"`

	Subscription Subscription `json:"-"`

	QueuePlaylistID string `json:"queuePlaylistId,omitempty"`
}

func pageHeading(root any) (title, thumbnail string) {
	object, ok := root.(*jsonObject)
	if !ok {
		return "", ""
	}
	header, ok := object.get("header").(*jsonObject)
	if !ok {
		return "", ""
	}
	for _, member := range header.members {
		renderer, ok := member.value.(*jsonObject)
		if !ok {
			continue
		}
		if title := rendererText(renderer.get("title")); title != "" {
			return title, rendererThumbnail(renderer.get("thumbnail"))
		}
	}
	return "", ""
}

type MusicSection struct {
	Title             string      `json:"title,omitempty"`
	Kind              string      `json:"kind"`
	Items             []MusicItem `json:"items"`
	ContinuationToken string      `json:"continuationToken,omitempty"`
}

func (client *MusicClient) GetHomeFeed(ctx context.Context) (*BrowseResult, error) {
	return client.browse(ctx, "FEmusic_home")
}

func (client *MusicClient) GetExplore(ctx context.Context) (*BrowseResult, error) {
	return client.browse(ctx, "FEmusic_explore")
}

func (client *MusicClient) GetLibrary(ctx context.Context) (*BrowseResult, error) {
	return client.browse(ctx, "FEmusic_library_landing")
}

func (client *MusicClient) StreamLibrary(ctx context.Context, progress func(*BrowseResult)) (*BrowseResult, error) {
	result, err := client.GetLibrary(ctx)
	if err != nil {
		return nil, err
	}
	if progress != nil && (result.ContinuationToken != "" || slices.ContainsFunc(result.Sections, func(s MusicSection) bool { return s.ContinuationToken != "" })) {
		progress(result.snapshot())
	}
	if err := client.drainBrowse(ctx, result, "library", progress); err != nil {
		return result, err
	}
	return result, nil
}

func (r *BrowseResult) snapshot() *BrowseResult {
	copied := *r
	copied.Items = slices.Clip(r.Items)
	copied.Sections = slices.Clone(r.Sections)
	for index := range copied.Sections {
		copied.Sections[index].Items = slices.Clip(copied.Sections[index].Items)
	}
	return &copied
}

const drainConcurrency = 4

func (client *MusicClient) drainBrowse(ctx context.Context, result *BrowseResult, label string, progress func(*BrowseResult)) error {
	queue := browseContinuationQueue(result)
	seen := make(map[string]struct{})
	for len(queue) > 0 {
		var level []browseContinuation
		exceeded := false
		for _, continuation := range queue {
			if _, exists := seen[continuation.token]; exists {
				continue
			}
			seen[continuation.token] = struct{}{}
			if len(seen) > 1000 {
				exceeded = true
				break
			}
			level = append(level, continuation)
		}
		queue = nil
		pages, errs := client.continueAll(ctx, level)
		for i, continuation := range level {
			if errs[i] != nil {
				return errs[i]
			}
			page := pages[i]
			result.Items = append(result.Items, page.Items...)
			if continuation.section >= 0 {
				result.Sections[continuation.section].Items = append(result.Sections[continuation.section].Items, page.Items...)
			} else {
				result.Sections = append(result.Sections, page.Sections...)
			}
			if page.ContinuationToken != "" {
				queue = append(queue, browseContinuation{token: page.ContinuationToken, section: -1})
			}
			for index, section := range page.Sections {
				if section.ContinuationToken == "" {
					continue
				}
				sectionIndex := continuation.section
				if sectionIndex < 0 {
					sectionIndex = len(result.Sections) - len(page.Sections) + index
				}
				queue = append(queue, browseContinuation{token: section.ContinuationToken, section: sectionIndex})
			}
		}
		if exceeded {
			return fmt.Errorf("youtube: %s exceeded 1000 continuation pages", label)
		}
		if progress != nil && len(queue) > 0 {
			progress(result.snapshot())
		}
	}
	result.ContinuationToken = ""
	for index := range result.Sections {
		result.Sections[index].ContinuationToken = ""
	}
	return nil
}

func (client *MusicClient) continueAll(ctx context.Context, continuations []browseContinuation) ([]*BrowseResult, []error) {
	pages := make([]*BrowseResult, len(continuations))
	errs := make([]error, len(continuations))
	if len(continuations) == 1 {
		pages[0], errs[0] = client.ContinueBrowse(ctx, continuations[0].token)
		return pages, errs
	}
	var group sync.WaitGroup
	slots := make(chan struct{}, drainConcurrency)
	for i, continuation := range continuations {
		slots <- struct{}{}
		group.Add(1)
		go func() {
			defer func() { <-slots; group.Done() }()
			pages[i], errs[i] = client.ContinueBrowse(ctx, continuation.token)
		}()
	}
	group.Wait()
	return pages, errs
}

func (client *MusicClient) ContinueBrowse(ctx context.Context, token string) (*BrowseResult, error) {
	if strings.TrimSpace(token) == "" {
		return nil, errors.New("youtube: browse continuation token is required")
	}
	raw, err := client.executeAs(ctx, musicClient, false, "browse", map[string]any{"continuation": token})
	if err != nil {
		return nil, err
	}
	return client.newBrowseResult(raw), nil
}

func (client *MusicClient) GetArtist(ctx context.Context, artistID string) (*BrowseResult, error) {
	if !strings.HasPrefix(artistID, "UC") && !strings.HasPrefix(artistID, "FEmusic_library_privately_owned_artist") {
		return nil, fmt.Errorf("youtube: invalid artist ID %q", artistID)
	}
	return client.browse(ctx, artistID)
}

func (client *MusicClient) GetAlbum(ctx context.Context, albumID string) (*BrowseResult, error) {
	if !strings.HasPrefix(albumID, "MPR") && !strings.HasPrefix(albumID, "FEmusic_library_privately_owned_release") {
		return nil, fmt.Errorf("youtube: invalid album ID %q", albumID)
	}
	return client.browse(ctx, albumID)
}

func (client *MusicClient) GetPlaylist(ctx context.Context, playlistID string) (*BrowseResult, error) {
	if playlistID == "" {
		return nil, errors.New("youtube: playlist ID is required")
	}
	if !strings.HasPrefix(playlistID, "VL") {
		playlistID = "VL" + playlistID
	}
	return client.browse(ctx, playlistID)
}

func (client *MusicClient) GetPodcast(ctx context.Context, showID string) (*BrowseResult, error) {
	if !isPodcastID(showID) {
		return nil, fmt.Errorf("youtube: invalid podcast ID %q", showID)
	}
	raw, err := client.execute(ctx, "browse", map[string]any{"browseId": showID})
	if err != nil {
		return nil, err
	}
	root := decodeResponse(raw)
	result := episodePage(browseResult(root))

	if header := findRenderer(root, "musicResponsiveHeaderRenderer"); header != nil {
		if result.Title == "" {
			result.Title = rendererText(header.get("title"))
			result.Thumbnail = rendererThumbnail(header.get("thumbnail"))
		}
		if shelf, ok := nestedObject(header.get("description"), "musicDescriptionShelfRenderer"); ok {
			result.Description = strings.Join(strings.Fields(rendererText(shelf.get("description"))), " ")
		}
	}
	return result, nil
}

func (client *MusicClient) ContinuePodcast(ctx context.Context, token string) (*BrowseResult, error) {
	result, err := client.ContinueBrowse(ctx, token)
	if err != nil {
		return nil, err
	}
	return episodePage(result), nil
}

func episodePage(result *BrowseResult) *BrowseResult {
	result.ContinuationToken = ""
	if len(result.Sections) > 0 {
		result.ContinuationToken = result.Sections[len(result.Sections)-1].ContinuationToken
	}
	return result
}

func (client *MusicClient) GetRecap(ctx context.Context) (*BrowseResult, error) {
	return client.browse(ctx, "FEmusic_listening_review")
}

func (client *MusicClient) newBrowseResult(raw json.RawMessage) *BrowseResult {
	return browseResult(decodeResponse(raw))
}

func browseResult(root any) *BrowseResult {
	items, sections, _ := browseParts(root, false)
	title, thumbnail := pageHeading(root)
	return &BrowseResult{
		Title: title, Thumbnail: thumbnail,
		Items: items, Sections: sections,
		ContinuationToken: pageContinuationToken(root),
		Library:           headerLibraryState(root),
		Subscription:      headerSubscription(root),
	}
}

type browseContinuation struct {
	token   string
	section int
}

func browseContinuationQueue(result *BrowseResult) []browseContinuation {
	continuations := make([]browseContinuation, 0, len(result.Sections)+1)
	if result.ContinuationToken != "" {
		continuations = append(continuations, browseContinuation{token: result.ContinuationToken, section: -1})
	}
	for index, section := range result.Sections {
		if section.ContinuationToken != "" {
			continuations = append(continuations, browseContinuation{token: section.ContinuationToken, section: index})
		}
	}
	return continuations
}

func pageContinuationToken(root any) string {
	var walk func(any) string
	walk = func(value any) string {
		switch node := value.(type) {
		case []any:
			for _, child := range node {
				if token := walk(child); token != "" {
					return token
				}
			}
		case *jsonObject:
			if token, ok := node.get("continuation").(string); ok && token != "" {
				return token
			}
			for _, member := range node.members {
				if isSectionRenderer(member.key) {
					continue
				}
				if token := walk(member.value); token != "" {
					return token
				}
			}
		}
		return ""
	}
	return walk(root)
}

func continuationToken(root any) string {
	var walk func(any) string
	walk = func(value any) string {
		switch node := value.(type) {
		case []any:
			for _, child := range node {
				if token := walk(child); token != "" {
					return token
				}
			}
		case *jsonObject:
			if command, ok := node.get("continuationCommand").(*jsonObject); ok {
				if token, ok := command.get("token").(string); ok && token != "" {
					return token
				}
			}
			if next, ok := node.get("nextContinuationData").(*jsonObject); ok {
				if token, ok := next.get("continuation").(string); ok && token != "" {
					return token
				}
			}
			if token, ok := node.get("continuation").(string); ok && token != "" {
				return token
			}
			for _, member := range node.members {
				if token := walk(member.value); token != "" {
					return token
				}
			}
		}
		return ""
	}
	return walk(root)
}

func (client *MusicClient) browse(ctx context.Context, browseID string) (*BrowseResult, error) {
	raw, err := client.execute(ctx, "browse", map[string]any{"browseId": browseID})
	if err != nil {
		return nil, err
	}
	return client.newBrowseResult(raw), nil
}

func (client *MusicClient) GetCharts(ctx context.Context) (*BrowseResult, error) {
	return client.browse(ctx, "FEmusic_charts")
}

func (client *MusicClient) GetMoodsAndGenres(ctx context.Context) (*BrowseResult, error) {
	return client.browse(ctx, "FEmusic_moods_and_genres")
}

func (client *MusicClient) GetNewReleases(ctx context.Context) (*BrowseResult, error) {
	return client.browse(ctx, "FEmusic_new_releases")
}

func (client *MusicClient) GetHistory(ctx context.Context) (*BrowseResult, error) {
	if client.cookieAuth == nil {
		return nil, errors.New("youtube: history requires signed-in session")
	}
	return client.browse(ctx, "FEmusic_history")
}
