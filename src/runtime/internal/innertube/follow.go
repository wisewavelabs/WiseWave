package innertube

import (
	"context"
	"errors"
	"strings"
)

type Subscription struct {
	ChannelID  string
	Subscribed bool
}

func (client *MusicClient) Subscribe(ctx context.Context, channelID string) error {
	return client.writeSubscription(ctx, "Subscribe", "subscription/subscribe", channelID)
}

func (client *MusicClient) Unsubscribe(ctx context.Context, channelID string) error {
	return client.writeSubscription(ctx, "Unsubscribe", "subscription/unsubscribe", channelID)
}

func (client *MusicClient) writeSubscription(ctx context.Context, name, endpoint, channelID string) error {
	if client.cookieAuth.Load() == nil {
		return errors.New("youtube: " + name + " requires cookie authentication")
	}
	channelID = strings.TrimSpace(channelID)
	if channelID == "" {
		return errors.New("youtube: " + name + " needs an artist")
	}
	raw, err := client.execute(ctx, endpoint, map[string]any{"channelIds": []string{channelID}})
	if err != nil {
		return err
	}
	return writeFailure(endpoint, raw)
}

func headerSubscription(root any) Subscription {
	object, ok := root.(*jsonObject)
	if !ok {
		return Subscription{}
	}
	var walk func(any) (Subscription, bool)
	walk = func(value any) (Subscription, bool) {
		switch node := value.(type) {
		case []any:
			for _, child := range node {
				if found, ok := walk(child); ok {
					return found, true
				}
			}
		case *jsonObject:
			if button, ok := node.get("subscribeButtonRenderer").(*jsonObject); ok {
				if id, _ := button.get("channelId").(string); id != "" {
					return Subscription{ChannelID: id, Subscribed: rendererBool(button.get("subscribed"))}, true
				}
			}
			for _, member := range node.members {
				if found, ok := walk(member.value); ok {
					return found, true
				}
			}
		}
		return Subscription{}, false
	}
	found, _ := walk(object.get("header"))
	return found
}
