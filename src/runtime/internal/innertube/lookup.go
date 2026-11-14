package innertube

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"wisewave-runtime/internal/models"
	"wisewave-runtime/internal/search"
)

type SearchFilter struct {
	Label  string `json:"label,omitempty"`
	Params string `json:"params,omitempty"`
}

type SearchOptions struct {
	Params string
}

type SearchResult struct {
	Items             []MusicItem `json:"items"`
	ContinuationToken string      `json:"continuationToken,omitempty"`

	TopResult MusicItem `json:"topResult,omitempty"`

	Filters []SearchFilter `json:"filters,omitempty"`
}

type SearchSuggestions struct {
	Queries []string    `json:"queries"`
	Items   []MusicItem `json:"items,omitempty"`
}

func (client *MusicClient) Search(ctx context.Context, query string, options SearchOptions) (*SearchResult, error) {
	if strings.TrimSpace(query) == "" {
		return nil, errors.New("youtube: search query is required")
	}
	payload := map[string]any{"query": query}
	if options.Params != "" {

		payload["params"] = options.Params
	}
	raw, err := client.execute(ctx, "search", payload)
	if err != nil {
		return nil, err
	}
	result := client.newSearchResult(raw)
	rankSearchItemsWithRanker(query, result, client.searchState.Ranker())
	client.rememberSearchPage(query, result, search.PageState{})
	return result, nil
}

func rankSearchItems(query string, result *SearchResult) {
	rankSearchItemsWithRanker(query, result, search.Ranker{})
}

func rankSearchItemsWithRanker(query string, result *SearchResult, ranker search.Ranker) {
	var tracks []models.Track
	items := make(map[string]MusicItem)
	for _, item := range result.Items {
		if item.IsTrack() {
			artist := item.Artists
			if artist == "" {
				artist = item.Artist
			}
			tracks = append(tracks, models.Track{ID: item.VideoID, Title: item.Title, Artist: artist, Album: item.Album, Duration: item.Duration, DurationSeconds: parseDurationSeconds(item.Duration)})
			if _, ok := items[item.VideoID]; !ok {
				items[item.VideoID] = item
			}
		}
	}
	ranked := ranker.Tracks(query, tracks)
	out := make([]MusicItem, 0, len(result.Items))
	index := 0
	for _, item := range result.Items {
		if !item.IsTrack() {
			out = append(out, item)
		} else if index < len(ranked) {
			out = append(out, items[ranked[index].ID])
			index++
		}
	}
	result.Items = out
	if result.TopResult.IsTrack() && len(ranked) > 0 {
		result.TopResult = items[ranked[0].ID]
	}
}

func (client *MusicClient) ContinueSearch(ctx context.Context, token string, originalQuery ...string) (*SearchResult, error) {
	if strings.TrimSpace(token) == "" {
		return nil, errors.New("youtube: search continuation token is required")
	}
	state := client.searchState.Page(token)
	query := state.Query
	if len(originalQuery) > 0 && strings.TrimSpace(originalQuery[0]) != "" {
		if query != "" && search.Normalize(query) != search.Normalize(originalQuery[0]) {
			return nil, errors.New("youtube: continuation query mismatch")
		}
		query = originalQuery[0]
	}
	if len(query) > 512 || len(token) > 8192 {
		return nil, errors.New("youtube: invalid search continuation")
	}
	raw, err := client.execute(ctx, "search", map[string]any{"continuation": token})
	if err != nil {
		return nil, err
	}
	result := client.newSearchResult(raw)
	if query != "" {
		items := make([]MusicItem, 0, len(result.Items))
		for _, item := range result.Items {
			if !item.IsTrack() || !state.Seen[item.VideoID] {
				items = append(items, item)
			}
		}
		result.Items = items
		rankSearchItemsWithRanker(query, result, client.searchState.Ranker())
		client.rememberSearchPage(query, result, state)
	}
	return result, nil
}

func (client *MusicClient) GetSearchSuggestions(ctx context.Context, input string) (*SearchSuggestions, error) {
	if strings.TrimSpace(input) == "" {
		return nil, errors.New("youtube: suggestion input is required")
	}
	raw, err := client.execute(ctx, "music/get_search_suggestions", map[string]any{"input": input})
	if err != nil {
		return nil, err
	}
	root := decodeResponse(raw)
	items, _, _ := browseParts(root, false)
	return &SearchSuggestions{Queries: searchSuggestions(root), Items: items}, nil
}

func searchSuggestions(root any) []string {
	var suggestions []string
	seen := make(map[string]struct{})
	var walk func(any)
	walk = func(value any) {
		switch node := value.(type) {
		case []any:
			for _, child := range node {
				walk(child)
			}
		case *jsonObject:
			if renderer, ok := node.get("searchSuggestionRenderer").(*jsonObject); ok {
				if text := rendererText(renderer.get("suggestion")); text != "" {
					if _, exists := seen[text]; !exists {
						seen[text] = struct{}{}
						suggestions = append(suggestions, text)
					}
				}
			}
			for _, member := range node.members {
				walk(member.value)
			}
		}
	}
	walk(root)
	return suggestions
}

func (client *MusicClient) newSearchResult(raw json.RawMessage) *SearchResult {
	root := decodeResponse(raw)
	items, _, top := browseParts(root, true)
	return &SearchResult{
		Items: items, TopResult: top, Filters: searchFilters(root),
		ContinuationToken: continuationToken(root),
	}
}

func searchFilters(root any) []SearchFilter {
	cloud := findRenderer(root, "chipCloudRenderer")
	if cloud == nil {
		return nil
	}
	chips, _ := cloud.get("chips").([]any)
	filters := make([]SearchFilter, 0, len(chips))
	for _, value := range chips {
		chip, ok := value.(*jsonObject)
		if !ok {
			continue
		}
		renderer, ok := chip.get("chipCloudChipRenderer").(*jsonObject)
		if !ok {
			continue
		}
		filters = append(filters, SearchFilter{
			Label:  rendererText(renderer.get("text")),
			Params: searchEndpointParams(renderer),
		})
	}
	return filters
}

func searchEndpointParams(renderer *jsonObject) string {
	endpoint, ok := renderer.get("navigationEndpoint").(*jsonObject)
	if !ok {
		return ""
	}
	search, ok := endpoint.get("searchEndpoint").(*jsonObject)
	if !ok {
		return ""
	}
	params, _ := search.get("params").(string)
	return params
}

func (client *MusicClient) SetSearchPreferences(snapshot func() func(models.Track) float64) {
	client.searchState.SetPreferences(snapshot)
}

func (client *MusicClient) rememberSearchPage(query string, result *SearchResult, previous search.PageState) {
	ids := make([]string, 0, len(result.Items))
	for _, item := range result.Items {
		if item.IsTrack() {
			ids = append(ids, item.VideoID)
		}
	}
	client.searchState.RememberPage(query, result.ContinuationToken, ids, previous)
}
