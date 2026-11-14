package innertube

import (
	"context"
	"errors"
	"strings"
)

type AccountDetails struct {
	Name      string `json:"name,omitempty"`
	Email     string `json:"email,omitempty"`
	ChannelID string `json:"channelId,omitempty"`
	Thumbnail string `json:"thumbnail,omitempty"`
	Handle    string `json:"handle,omitempty"`
}

type AccountChannel struct {
	Name       string `json:"name,omitempty"`
	Byline     string `json:"byline,omitempty"`
	Handle     string `json:"handle,omitempty"`
	ChannelID  string `json:"channelId,omitempty"`
	Thumbnail  string `json:"thumbnail,omitempty"`
	Selected   bool   `json:"selected,omitempty"`
	Disabled   bool   `json:"disabled,omitempty"`
	HasChannel bool   `json:"hasChannel,omitempty"`
}

type AccountList struct {
	Items []AccountChannel `json:"items"`
}

func (client *MusicClient) GetAccountDetails(ctx context.Context) (*AccountDetails, error) {
	if client.cookieAuth.Load() == nil {
		return nil, errors.New("youtube: GetAccountDetails requires cookie authentication")
	}
	raw, err := client.execute(ctx, "account/account_menu", map[string]any{})
	if err != nil {
		return nil, err
	}
	details := &AccountDetails{}
	root := decodeResponse(raw)

	if header := findRenderer(root, "activeAccountHeaderRenderer"); header != nil {
		details.Name = rendererText(header.get("accountName"))
		details.Email = rendererText(header.get("email"))
		details.Thumbnail = rendererThumbnail(header.get("accountPhoto"))
		details.Handle = rendererText(header.get("channelHandle"))
	}

	for _, channel := range extractAccountChannels(root) {
		if !channel.Selected {
			continue
		}
		details.ChannelID = channel.ChannelID
		if details.Handle == "" {
			details.Handle = channel.Handle
		}
		if details.Thumbnail == "" {
			details.Thumbnail = channel.Thumbnail
		}
		break
	}
	return details, nil
}

func (client *MusicClient) GetAccounts(ctx context.Context) (*AccountList, error) {
	if client.cookieAuth.Load() == nil {
		return nil, errors.New("youtube: GetAccounts requires cookie authentication")
	}
	raw, err := client.executeAs(ctx, webClient, false, "account/accounts_list", map[string]any{
		"requestType":      "ACCOUNTS_LIST_REQUEST_TYPE_CHANNEL_SWITCHER",
		"callCircumstance": "SWITCHING_USERS_FULL",
	})
	if err != nil {
		return nil, err
	}
	return &AccountList{Items: extractAccountChannels(decodeResponse(raw))}, nil
}

func extractAccountChannels(root any) []AccountChannel {
	var channels []AccountChannel
	seen := make(map[string]struct{})
	appendChannel := func(channel AccountChannel) {
		identity := channel.ChannelID + channel.Name + channel.Handle
		if identity == "" {
			return
		}
		if _, exists := seen[identity]; exists {
			return
		}
		seen[identity] = struct{}{}
		channels = append(channels, channel)
	}
	var walk func(any)
	walk = func(value any) {
		switch node := value.(type) {
		case []any:
			for _, child := range node {
				walk(child)
			}
		case *jsonObject:
			if hasAccountChannelFields(node) {
				appendChannel(parseAccountChannel(node))
				return
			}
			for _, member := range node.members {
				child, ok := member.value.(*jsonObject)
				if !ok {
					walk(member.value)
					continue
				}
				if member.key == "accountItemRenderer" || member.key == "accountItem" {
					appendChannel(parseAccountChannel(child))
					continue
				}
				if hasAccountChannelFields(child) {
					appendChannel(parseAccountChannel(child))
					continue
				}
				walk(child)
			}
		}
	}
	walk(root)
	return channels
}

func parseAccountChannel(renderer *jsonObject) AccountChannel {
	channel := AccountChannel{
		Name:       rendererText(renderer.get("accountName")),
		Byline:     rendererText(renderer.get("accountByline")),
		Handle:     rendererText(renderer.get("channelHandle")),
		Thumbnail:  rendererThumbnail(renderer.get("accountPhoto")),
		Selected:   rendererBool(renderer.get("isSelected")),
		Disabled:   rendererBool(renderer.get("isDisabled")),
		HasChannel: rendererBool(renderer.get("hasChannel")),
		ChannelID:  navigationID(renderer.get("endpoint")),
	}
	if channel.Name == "" {
		channel.Name = rendererText(renderer.get("account_name"))
	}
	if channel.Name == "" {
		channel.Name = rendererText(renderer.get("name"))
	}
	if channel.ChannelID == "" {
		channel.ChannelID, _ = renderer.get("channelId").(string)
	}
	if channel.ChannelID == "" {
		channel.ChannelID = accountChannelPageID(renderer.get("serviceEndpoint"))
	}
	if channel.Handle == "" {
		channel.Handle, _ = renderer.get("handle").(string)
	}
	if channel.Handle == "" {
		channel.Handle, _ = renderer.get("channel_handle").(string)
	}
	if channel.Byline == "" {
		channel.Byline = rendererText(renderer.get("account_byline"))
	}
	if channel.Handle == "" && strings.HasPrefix(channel.Byline, "@") && !strings.ContainsAny(channel.Byline, " \t\r\n") {
		channel.Handle = channel.Byline
	}
	if channel.Thumbnail == "" {
		channel.Thumbnail = rendererThumbnail(renderer.get("account_photo"))
	}
	return channel
}

func accountChannelPageID(serviceEndpoint any) string {
	identity, ok := nestedObject(serviceEndpoint, "selectActiveIdentityEndpoint")
	if !ok {
		return ""
	}
	tokens, ok := identity.get("supportedTokens").([]any)
	if !ok {
		return ""
	}
	for _, token := range tokens {
		if token, ok := token.(*jsonObject); ok {
			if pageID := nestedString(token.get("pageIdToken"), "pageId"); pageID != "" {
				return pageID
			}
		}
	}
	return ""
}

func hasAccountChannelFields(value *jsonObject) bool {
	for _, key := range []string{"channelId", "accountName", "account_name", "channelHandle", "channel_handle"} {
		if value.get(key) != nil {
			return true
		}
	}
	return false
}

func rendererBool(value any) bool {
	result, _ := value.(bool)
	return result
}
