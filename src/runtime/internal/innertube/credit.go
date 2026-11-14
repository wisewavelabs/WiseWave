package innertube

import "strings"

func playlistSubtitleOwner(subtitle string) string {
	parts := strings.FieldsFunc(subtitle, func(r rune) bool { return r == '\u2022' || r == '\u00b7' })
	for i, part := range parts {
		if strings.EqualFold(strings.TrimSpace(part), "Playlist") && i+1 < len(parts) {
			owner := strings.TrimSpace(parts[i+1])
			lower := strings.ToLower(owner)
			if owner != "" && lower != "private" && lower != "public" && lower != "unlisted" && !strings.Contains(lower, " songs") && !strings.Contains(lower, " tracks") && !strings.Contains(lower, " videos") {
				return owner
			}
		}
	}
	if strings.EqualFold(strings.TrimSpace(subtitle), "YouTube Music") {
		return strings.TrimSpace(subtitle)
	}
	return ""
}

func (item *MusicItem) setPlaylistOwner(renderer *jsonObject) {
	if item.Target().Kind != TargetPlaylist {
		return
	}
	owners, _ := rendererCredits(renderer)
	item.Owner = strings.Join(owners, ", ")
	if item.Owner == "" {
		item.Owner = playlistSubtitleOwner(item.Subtitle)
	}
}

func (item *MusicItem) setAlbumCredit(renderer *jsonObject) {
	if item == nil {
		return
	}
	item.AlbumID = albumBrowseID(renderer)
	if item.Album == "" {
		_, item.Album = rendererCredits(renderer)
	}
	if item.Album == "" {
		if columns, ok := renderer.get("flexColumns").([]any); ok && len(columns) > 2 {
			if column, ok := columns[2].(*jsonObject); ok {
				if flex, ok := column.get("musicResponsiveListItemFlexColumnRenderer").(*jsonObject); ok {
					text, _ := flex.get("text").(*jsonObject)
					item.Album = rendererText(text)
					if item.Album == "—" || item.Album == "–" || item.Album == "-" {
						item.Album = ""
					}
					if runs, ok := text.get("runs").([]any); ok && len(runs) > 0 {
						if run, ok := runs[0].(*jsonObject); ok && item.AlbumID == "" {
							item.AlbumID = albumBrowseID(run.get("navigationEndpoint"))
						}
					}
				}
			}
		}
	}
	if item.Album == "" {
		item.Album = secondaryLineAlbum(renderer)
	}
}

func secondaryLineAlbum(renderer *jsonObject) string {
	columns, ok := renderer.get("flexColumns").([]any)
	if !ok || len(columns) < 2 {
		return ""
	}
	column, ok := columns[1].(*jsonObject)
	if !ok {
		return ""
	}
	flex, ok := column.get("musicResponsiveListItemFlexColumnRenderer").(*jsonObject)
	if !ok {
		return ""
	}
	text, ok := flex.get("text").(*jsonObject)
	if !ok {
		return ""
	}
	runs, ok := text.get("runs").([]any)
	if !ok {
		return ""
	}
	segment := 0
	for _, value := range runs {
		run, ok := value.(*jsonObject)
		if !ok {
			continue
		}
		name, _ := run.get("text").(string)
		name = strings.TrimSpace(name)
		if name == "•" || name == "·" {
			segment++
			continue
		}
		if name == "" || segment != 1 {
			continue
		}
		if endpoint, ok := nestedObject(run.get("navigationEndpoint"), "browseEndpoint"); ok {
			if id, _ := endpoint.get("browseId").(string); musicIsAlbumID(id) {
				return name
			}
		}
		lower := strings.ToLower(name)
		if name == "—" || name == "–" || name == "-" || name == "Song" || name == "Video" || name == "Album" || name == "Single" || name == "EP" || len(name) == 4 && name[0] >= '0' && name[0] <= '9' || strings.Contains(lower, " view") || strings.Contains(lower, " song") || isDurationText(name) {
			continue
		}
		return name
	}
	return ""
}

func albumBrowseID(value any) string {
	switch node := value.(type) {
	case []any:
		for _, child := range node {
			if id := albumBrowseID(child); id != "" {
				return id
			}
		}
	case *jsonObject:
		if endpoint, ok := node.get("browseEndpoint").(*jsonObject); ok {
			if id, _ := endpoint.get("browseId").(string); musicIsAlbumID(id) {
				return id
			}
		}
		for _, key := range []string{"navigationEndpoint", "endpoint", "runs", "text", "flexColumns"} {
			if child := node.get(key); child != nil {
				if id := albumBrowseID(child); id != "" {
					return id
				}
			}
		}
	}
	return ""
}

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
		if len(found) > len(artists) {
			artists = found
		}
		if album == "" {
			album = sourceAlbum
		}
	}
	if len(artists) == 0 {
		if columns, ok := renderer.get("flexColumns").([]any); ok && len(columns) > 1 {
			if column, ok := columns[1].(*jsonObject); ok {
				if flex, ok := column.get("musicResponsiveListItemFlexColumnRenderer").(*jsonObject); ok {
					if text, ok := flex.get("text").(*jsonObject); ok {
						if runs, ok := text.get("runs").([]any); ok {
							for index, value := range runs {
								if index%2 != 0 {
									continue
								}
								run, ok := value.(*jsonObject)
								if !ok {
									continue
								}
								name, _ := run.get("text").(string)
								name = strings.TrimSpace(name)
								if name == "" || name == "Song" || name == "Video" || name == "Album" || name == "Single" || name == "EP" || len(name) == 4 && name[0] >= '0' && name[0] <= '9' {
									continue
								}
								id := ""
								if endpoint, ok := nestedObject(run.get("navigationEndpoint"), "browseEndpoint"); ok {
									id, _ = endpoint.get("browseId").(string)
								}
								if id == "" || musicIsArtistID(id) {
									artists = append(artists, name)
								}
							}
						}
					}
				}
			}
		}
	}
	return artists, album
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
		case id != "" && albumBrowseID(run.get("navigationEndpoint")) != "" && album == "":
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
