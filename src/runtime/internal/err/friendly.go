package err

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type WarmError struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	Suggestion string `json:"suggestion"`
	Status     int    `json:"status"`
}

func (e *WarmError) Error() string {
	return e.Message
}

type errorRule struct {
	patterns   []string
	code       string
	message    string
	suggestion string
	status     int
}

var errorRules = []errorRule{
	{
		patterns:   []string{"track not found in local library", "track not found"},
		code:       "TRACK_NOT_FOUND",
		message:    "We couldn't find this song in your local library.",
		suggestion: "Check if the file is in your music folder, or run a quick library rescan.",
		status:     http.StatusNotFound,
	},
	{
		patterns:   []string{"not found on saavn", "track %s not found on saavn", "song detail not found for", "song detail not found"},
		code:       "MIRROR_TRACK_NOT_FOUND",
		message:    "This track is currently unavailable on this audio mirror.",
		suggestion: "WiseWave will search other sources to keep your music playing.",
		status:     http.StatusNotFound,
	},
	{
		patterns:   []string{"all streams require signature cipher", "signature cipher"},
		code:       "STREAM_CIPHER_RESTRICTED",
		message:    "This stream has an active restriction from the provider.",
		suggestion: "WiseWave is tuning into a fallback audio mirror for you.",
		status:     http.StatusBadGateway,
	},
	{
		patterns:   []string{"no audio formats available", "no formats"},
		code:       "NO_AUDIO_FORMATS",
		message:    "No compatible audio format was delivered for this track.",
		suggestion: "WiseWave is checking fallback mirrors to keep the music going.",
		status:     http.StatusBadGateway,
	},
	{
		patterns:   []string{"no streaming data in player response", "no streaming data"},
		code:       "PLAYER_STREAM_EMPTY",
		message:    "The audio provider didn't return any streaming data.",
		suggestion: "Please try again in a moment, or switch to an alternate mirror.",
		status:     http.StatusBadGateway,
	},
	{
		patterns:   []string{"player response error", "unable to resolve playable audio stream"},
		code:       "STREAM_UNRESOLVABLE",
		message:    "We're having trouble catching this audio stream right now.",
		suggestion: "Give it a moment to reconnect, or try choosing another track.",
		status:     http.StatusBadGateway,
	},
	{
		patterns: []string{
			"failed to resolve saavn stream",
			"saavn stream resolution failed",
			"saavn search returned",
			"saavn details returned",
			"invalid saavn audio host",
			"failed to resolve gaana stream",
			"gaana stream resolution failed",
			"gaana stream-url returned",
			"gaana stream data missing",
			"no gaana stream path available",
			"gaana search returned",
			"gaana songdetail returned",
		},
		code:       "AUDIO_MIRROR_UNAVAILABLE",
		message:    "The audio mirror couldn't stream this track right now.",
		suggestion: "WiseWave will automatically look for alternative audio mirrors.",
		status:     http.StatusBadGateway,
	},
	{
		patterns: []string{
			"invalid ciphertext block alignment",
			"hls segment path missing from decoded payload",
			"insufficient ciphertext payload",
			"invalid stream path length",
			"invalid stream path header offset",
			"no encrypted stream url provided",
		},
		code:       "STREAM_DECRYPT_FAILED",
		message:    "We couldn't unpack the audio stream from this provider.",
		suggestion: "WiseWave will seamlessly fall back to an alternate source.",
		status:     http.StatusBadGateway,
	},
	{
		patterns:   []string{"stream resolution failed", "failed to resolve audio stream"},
		code:       "STREAM_RESOLUTION_FAILED",
		message:    "We couldn't tune into this audio stream at the moment.",
		suggestion: "Give it a moment to reconnect, or try selecting another song.",
		status:     http.StatusBadGateway,
	},
	{
		patterns: []string{
			"playlist not found or is private",
			"this playlist is unavailable or private",
		},
		code:       "PLAYLIST_UNAVAILABLE",
		message:    "This playlist seems to be private or unavailable.",
		suggestion: "Make sure the playlist link is public, or try searching for another playlist.",
		status:     http.StatusNotFound,
	},
	{
		patterns: []string{
			"invalid spotify playlist identifier",
			"playlist identifier or url is required",
		},
		code:       "INVALID_PLAYLIST_ID",
		message:    "We couldn't recognize this playlist link.",
		suggestion: "Paste a full playlist link or a valid identifier.",
		status:     http.StatusBadRequest,
	},
	{
		patterns: []string{
			"spotify token service returned",
			"no spotify token providers available",
			"spotify authentication was rejected",
		},
		code:       "AUTH_UNAVAILABLE",
		message:    "Music authentication took a brief breather.",
		suggestion: "WiseWave will automatically reconnect on your next request.",
		status:     http.StatusServiceUnavailable,
	},
	{
		patterns: []string{
			"spotify search is busy",
		},
		code:       "SEARCH_BUSY",
		message:    "Music search is receiving high traffic right now.",
		suggestion: "Please try again in just a few seconds.",
		status:     http.StatusTooManyRequests,
	},
	{
		patterns: []string{
			"spotify query returned status",
			"spotify service error",
		},
		code:       "SERVICE_ERROR",
		message:    "The music service ran into a temporary bump.",
		suggestion: "Try your search again or explore another playlist.",
		status:     http.StatusBadGateway,
	},
	{
		patterns:   []string{"audio file unreadable or moved"},
		code:       "AUDIO_FILE_UNREADABLE",
		message:    "This audio file seems to have moved or become inaccessible.",
		suggestion: "Make sure the file still exists in your audio folder and is readable.",
		status:     http.StatusNotFound,
	},
	{
		patterns:   []string{"cannot read file metadata"},
		code:       "FILE_METADATA_UNREADABLE",
		message:    "We had trouble reading the audio file information.",
		suggestion: "Check if the file is corrupted or in an unsupported format.",
		status:     http.StatusInternalServerError,
	},
	{
		patterns: []string{
			"query parameters 'title' and 'artist' are required",
			"title and artist are required",
			"title is required",
		},
		code:       "MISSING_SEARCH_PARAMS",
		message:    "We need a song title and artist to find what you're looking for.",
		suggestion: "Make sure to provide both the song name and artist.",
		status:     http.StatusBadRequest,
	},
	{
		patterns: []string{
			"lyrics not found",
			"no lyrics found",
			"no matching lrc.red lyrics found",
			"no lrclib lyrics found",
			"no kugou candidates found",
			"empty kugou content",
			"no parsed krc lines",
			"failed to parse amll ttml",
			"failed to parse lrc.red lyrics",
			"kugou lyrics parsing failed",
		},
		code:       "LYRICS_NOT_FOUND",
		message:    "The lyrics for this song haven't made their way here yet.",
		suggestion: "Enjoy the melody as an instrumental, or check back soon as public archives update.",
		status:     http.StatusNotFound,
	},
	{
		patterns:   []string{"valid 22-character spotify id required"},
		code:       "INVALID_SPOTIFY_ID",
		message:    "A valid Spotify track ID is needed to fetch lyrics from this source.",
		suggestion: "Verify the Spotify track identifier and try again.",
		status:     http.StatusBadRequest,
	},
	{
		patterns: []string{
			"connection refused",
			"connect: connection refused",
			"dial tcp",
		},
		code:       "CONNECTION_REFUSED",
		message:    "We couldn't establish a connection to the audio service.",
		suggestion: "Please check if your internet or local service is running and accessible.",
		status:     http.StatusServiceUnavailable,
	},
	{
		patterns: []string{
			"context deadline exceeded",
			"client.timeout",
			"timeout",
			"i/o timeout",
		},
		code:       "REQUEST_TIMEOUT",
		message:    "The request took longer than expected to answer.",
		suggestion: "Check your connection speed or try again in a few moments.",
		status:     http.StatusGatewayTimeout,
	},
	{
		patterns: []string{
			"no such host",
			"network is unreachable",
		},
		code:       "NETWORK_UNREACHABLE",
		message:    "It looks like your internet connection took a brief pause.",
		suggestion: "Check your Wi-Fi or mobile data, and we'll pick right back up.",
		status:     http.StatusServiceUnavailable,
	},
	{
		patterns: []string{
			"too many requests",
			"429",
			"rate limit",
		},
		code:       "RATE_LIMITED",
		message:    "The music stream is a bit crowded right now.",
		suggestion: "We're slowing things down gently to keep playback smooth for you.",
		status:     http.StatusTooManyRequests,
	},
	{
		patterns: []string{
			"bad gateway",
			"returned 502",
		},
		code:       "BAD_GATEWAY",
		message:    "The upstream audio service is taking a brief breather.",
		suggestion: "WiseWave will automatically attempt alternate mirror sources.",
		status:     http.StatusBadGateway,
	},
	{
		patterns: []string{
			"service unavailable",
			"returned 503",
		},
		code:       "SERVICE_UNAVAILABLE",
		message:    "The service is momentarily resting for maintenance.",
		suggestion: "Please give it a minute and try again.",
		status:     http.StatusServiceUnavailable,
	},
	{
		patterns: []string{
			"cannot get",
			"cannot post",
			"route not found",
		},
		code:       "ROUTE_NOT_FOUND",
		message:    "This music destination doesn't seem to exist.",
		suggestion: "Double-check the endpoint or return to your library.",
		status:     http.StatusNotFound,
	},
}

func Map(err error, fallbackStatus ...int) WarmError {
	if err == nil {
		return WarmError{
			Code:       "OK",
			Message:    "All good.",
			Suggestion: "",
			Status:     http.StatusOK,
		}
	}

	var warmErr *WarmError
	if errors.As(err, &warmErr) {
		if warmErr == nil {
			return Map(nil, fallbackStatus...)
		}
		return *warmErr
	}

	var fiberErr *fiber.Error
	if errors.As(err, &fiberErr) {
		return MapString(fiberErr.Message, fiberErr.Code)
	}

	defaultStatus := http.StatusInternalServerError
	if len(fallbackStatus) > 0 && fallbackStatus[0] > 0 {
		defaultStatus = fallbackStatus[0]
	}

	return MapString(err.Error(), defaultStatus)
}

func MapString(errMsg string, fallbackStatus ...int) WarmError {
	lowerMsg := strings.ToLower(strings.TrimSpace(errMsg))
	defaultStatus := http.StatusInternalServerError
	if len(fallbackStatus) > 0 && fallbackStatus[0] > 0 {
		defaultStatus = fallbackStatus[0]
	}

	for _, rule := range errorRules {
		for _, pattern := range rule.patterns {
			if strings.Contains(lowerMsg, pattern) {
				status := rule.status
				if defaultStatus != http.StatusInternalServerError && defaultStatus != http.StatusOK {
					status = defaultStatus
				}
				return WarmError{
					Code:       rule.code,
					Message:    rule.message,
					Suggestion: rule.suggestion,
					Status:     status,
				}
			}
		}
	}

	if defaultStatus == http.StatusNotFound {
		return WarmError{
			Code:       "NOT_FOUND",
			Message:    "We couldn't find the item you're looking for.",
			Suggestion: "Double-check your search or library filter and try again.",
			Status:     http.StatusNotFound,
		}
	}

	if defaultStatus == http.StatusBadRequest {
		return WarmError{
			Code:       "INVALID_REQUEST",
			Message:    "A little piece of information was missing or incorrect.",
			Suggestion: "Check your request details and give it another try.",
			Status:     http.StatusBadRequest,
		}
	}

	if defaultStatus == http.StatusBadGateway {
		return WarmError{
			Code:       "MIRROR_STREAM_UNAVAILABLE",
			Message:    "The audio stream is temporarily unavailable from this source.",
			Suggestion: "WiseWave will automatically attempt to tune into a backup mirror.",
			Status:     http.StatusBadGateway,
		}
	}

	return WarmError{
		Code:       "INTERNAL_ERROR",
		Message:    "Something hit a gentle bump on our end, but we're on it.",
		Suggestion: "Try your request again, or restart the WiseWave runtime if it continues.",
		Status:     defaultStatus,
	}
}

func Respond(c *fiber.Ctx, err error, fallbackStatus ...int) error {
	warm := Map(err, fallbackStatus...)
	return c.Status(warm.Status).JSON(fiber.Map{
		"success":    false,
		"error":      warm.Message,
		"message":    warm.Message,
		"code":       warm.Code,
		"suggestion": warm.Suggestion,
		"status":     warm.Status,
	})
}

func RespondCustom(c *fiber.Ctx, err error, customMessage string, customSuggestion string, fallbackStatus ...int) error {
	warm := Map(err, fallbackStatus...)
	if customMessage != "" {
		warm.Message = customMessage
	}
	if customSuggestion != "" {
		warm.Suggestion = customSuggestion
	}
	return c.Status(warm.Status).JSON(fiber.Map{
		"success":    false,
		"error":      warm.Message,
		"message":    warm.Message,
		"code":       warm.Code,
		"suggestion": warm.Suggestion,
		"status":     warm.Status,
	})
}

func FiberErrorHandler(c *fiber.Ctx, err error) error {
	return Respond(c, err)
}
