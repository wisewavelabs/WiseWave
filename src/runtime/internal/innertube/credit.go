package innertube

import "strings"

func cardArtistBrowseID(renderer *jsonObject) string {
	subtitle, ok := renderer.get("subtitle").(*jsonObject)
	if !ok {
		return ""
	}
	runs, ok := subtitle.get("runs").([]any)
	if !ok {
		return ""
	}
	for _, value := range runs {
		run, ok := value.(*jsonObject)
		if !ok {
			continue
		}
		endpoint, ok := run.get("navigationEndpoint").(*jsonObject)
		if !ok {
			continue
		}
		if browse, ok := endpoint.get("browseEndpoint").(*jsonObject); ok {
			if id, _ := browse.get("browseId").(string); id != "" {
				return id
			}
		}
	}
	return ""
}

func rendererArtistBrowseID(renderer *jsonObject) string {
	for _, byline := range []string{"subtitle", "longBylineText", "shortBylineText"} {
		if id := artistBrowseEndpoint(renderer.get(byline)); id != "" {
			return id
		}
	}
	columns, ok := renderer.get("flexColumns").([]any)
	if !ok || len(columns) < 2 {
		return ""
	}
	return artistBrowseEndpoint(columns[1])
}

func rendererCredits(renderer *jsonObject) (artists []string, album string) {
	sources := []any{renderer.get("subtitle"), renderer.get("longBylineText"), renderer.get("shortBylineText")}
	if columns, ok := renderer.get("flexColumns").([]any); ok && len(columns) >= 2 {
		if column, ok := columns[1].(*jsonObject); ok {
			if flex, ok := column.get("musicResponsiveListItemFlexColumnRenderer").(*jsonObject); ok {
				sources = append(sources, flex.get("text"))
			}
		}
	}
	for _, source := range sources {
		found, sourceAlbum := bylineCredits(source)
		if len(found) > 0 {
			return found, sourceAlbum
		}
		album = sourceAlbum
	}
	return nil, album
}

func bylineCredits(byline any) (artists []string, album string) {
	object, ok := byline.(*jsonObject)
	if !ok {
		return nil, ""
	}
	runs, _ := object.get("runs").([]any)
	for _, value := range runs {
		run, ok := value.(*jsonObject)
		if !ok {
			continue
		}
		text, _ := run.get("text").(string)
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}
		id := ""
		if browse, ok := nestedObject(run.get("navigationEndpoint"), "browseEndpoint"); ok {
			id, _ = browse.get("browseId").(string)
		}
		switch {
		case musicIsArtistID(id):
			artists = append(artists, text)
		case musicIsAlbumID(id) && album == "":
			album = text
		}
	}
	return artists, album
}

func artistBrowseEndpoint(value any) string {
	switch node := value.(type) {
	case []any:
		for _, child := range node {
			if id := artistBrowseEndpoint(child); id != "" {
				return id
			}
		}
	case *jsonObject:
		if endpoint, ok := node.get("browseEndpoint").(*jsonObject); ok {
			if id, _ := endpoint.get("browseId").(string); strings.HasPrefix(id, "UC") || strings.Contains(id, "privately_owned_artist") {
				return id
			}
		}
		for _, member := range node.members {
			if id := artistBrowseEndpoint(member.value); id != "" {
				return id
			}
		}
	}
	return ""
}
