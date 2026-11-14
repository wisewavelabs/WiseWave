package youtube

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"wisewave-runtime/desktop/accounts/storage"
	"wisewave-runtime/internal/innertube"
	"wisewave-runtime/internal/secret"
)

var YouTubeAccountChanged = mygo.NewEvent[bool]("youtube-account-changed")
var ErrYouTubeNotSignedIn = errors.New("YouTube did not return a signed-in account. Please finish signing in.")

type YouTubeIdentity struct {
	AccountIndex int    `json:"account_index"`
	PageID       string `json:"page_id"`
}

type YouTubeAccountStatus struct {
	Linked      bool   `json:"linked"`
	Restoring   bool   `json:"restoring"`
	DisplayName string `json:"display_name"`
	Username    string `json:"username"`
	Email       string `json:"email"`
	ImageURL    string `json:"image_url"`
	Error       string `json:"error"`
}

type youtubeCredentials struct {
	Cookie     string          `json:"cookie"`
	Visitor    string          `json:"visitor"`
	DataSyncID string          `json:"data_sync_id"`
	Identity   YouTubeIdentity `json:"identity"`
}

type youtubeAccountFile struct {
	Version   int    `json:"version"`
	Protected string `json:"protected"`
}

type YouTubeLoginSession struct {
	credentials youtubeCredentials
	auth        *innertube.CookieAuth
	details     *innertube.AccountDetails
}

type YouTubeAccount struct {
	mu           sync.Mutex
	client       *innertube.MusicClient
	path         string
	epoch        uint64
	status       YouTubeAccountStatus
	auth         *innertube.CookieAuth
	library      *YouTubeLibrarySnapshot
	syncing      bool
	syncError    string
	syncID       uint64
	syncCancel   context.CancelFunc
	importing    bool
	importStatus YouTubeImportStatus
}

func NewYouTubeAccount(client *innertube.MusicClient) *YouTubeAccount {
	path, err := storage.Path("youtube-account.json")
	account := &YouTubeAccount{client: client}
	if err != nil {
		account.status.Error = "YouTube account storage is unavailable"
		return account
	}
	account.path = path
	data, err := os.ReadFile(account.path)
	if errors.Is(err, os.ErrNotExist) {
		return account
	}
	if err != nil || len(data) > 256<<10 {
		account.status.Error = "YouTube session could not be restored"
		return account
	}
	var file youtubeAccountFile
	if json.Unmarshal(data, &file) != nil || file.Version != 1 {
		account.status.Error = "YouTube session could not be restored"
		return account
	}
	encrypted, err := base64.StdEncoding.DecodeString(file.Protected)
	if err != nil {
		account.status.Error = "YouTube session could not be restored"
		return account
	}
	plain, err := secret.Unprotect(encrypted)
	if err != nil {
		account.status.Error = "Sign in again to restore your YouTube account"
		return account
	}
	var credentials youtubeCredentials
	if json.Unmarshal(plain, &credentials) != nil {
		account.status.Error = "YouTube session could not be restored"
		return account
	}
	account.status.Restoring = true
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		session, err := ValidateYouTubeLogin(ctx, credentials.Cookie, credentials.Visitor, credentials.DataSyncID, credentials.Identity)
		account.mu.Lock()
		if account.epoch != 0 {
			account.mu.Unlock()
			return
		}
		account.status.Restoring = false
		if err != nil {
			account.status.Error = "YouTube session expired or could not be verified. Sign in again."
		} else {
			account.activateLocked(session)
		}
		linked := account.status.Linked
		account.mu.Unlock()
		_ = YouTubeAccountChanged.Broadcast(linked)
		if linked {
			_, _ = account.SyncLibrary()
		}
	}()
	return account
}

func (a *YouTubeAccount) Status() YouTubeAccountStatus {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.status
}

func ValidateYouTubeLogin(ctx context.Context, cookie, visitor, dataSyncID string, identityOptions ...YouTubeIdentity) (*YouTubeLoginSession, error) {
	if len(cookie) > 64<<10 || len(visitor) > 8192 || len(dataSyncID) > 512 {
		return nil, errors.New("YouTube returned an invalid session")
	}
	identity := YouTubeIdentity{}
	if len(identityOptions) > 0 {
		identity = identityOptions[0]
	}
	if identity.AccountIndex < 0 || identity.AccountIndex >= 100 || len(identity.PageID) > 160 || strings.ContainsAny(identity.PageID, "\r\n\x00") {
		return nil, errors.New("YouTube returned an invalid account identity")
	}
	auth, err := innertube.NewCookieAuth(cookie, innertube.CookieOptions{AccountIndex: identity.AccountIndex, OnBehalfOfUser: identity.PageID})
	if err != nil {
		return nil, errors.New("YouTube sign-in has not finished")
	}
	client := innertube.NewMusicClient(innertube.MusicOptions{CookieAuth: auth, VisitorData: visitor})
	details, err := client.GetAccountDetails(ctx)
	if err != nil {
		return nil, errors.New("YouTube could not verify your account. Please try again.")
	}
	if strings.TrimSpace(details.Name) == "" {
		return nil, ErrYouTubeNotSignedIn
	}
	if details.Handle == "" {
		if accounts, lookupErr := client.GetAccounts(ctx); lookupErr == nil {
			for _, channel := range accounts.Items {
				if channel.Selected && !channel.Disabled {
					details.Handle = channel.Handle
					if details.ChannelID == "" {
						details.ChannelID = channel.ChannelID
					}
					break
				}
			}
		}
	}
	return &YouTubeLoginSession{youtubeCredentials{Cookie: cookie, Visitor: visitor, DataSyncID: dataSyncID, Identity: identity}, auth, details}, nil
}

func SaveYouTubeLogin(account *YouTubeAccount, session *YouTubeLoginSession) error {
	if account == nil || session == nil || session.auth == nil || session.details == nil {
		return errors.New("YouTube session is unavailable")
	}
	plain, err := json.Marshal(session.credentials)
	if err != nil {
		return err
	}
	encrypted, err := secret.Protect(plain)
	if err != nil {
		return errors.New("YouTube session could not be protected")
	}
	data, err := json.Marshal(youtubeAccountFile{1, base64.StdEncoding.EncodeToString(encrypted)})
	if err != nil {
		return err
	}
	account.mu.Lock()
	defer account.mu.Unlock()
	if account.path == "" {
		return errors.New("YouTube account storage is unavailable")
	}
	if err = os.MkdirAll(filepath.Dir(account.path), 0700); err != nil {
		return errors.New("YouTube session could not be saved")
	}
	file, err := os.CreateTemp(filepath.Dir(account.path), "youtube-account-*.tmp")
	if err != nil {
		return errors.New("YouTube session could not be saved")
	}
	temporary := file.Name()
	defer os.Remove(temporary)
	if err = file.Chmod(0600); err == nil {
		_, err = file.Write(data)
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return errors.New("YouTube session could not be saved")
	}
	if err = secret.RestrictPath(temporary); err != nil {
		return errors.New("YouTube session permissions could not be protected")
	}
	if err = os.Rename(temporary, account.path); err != nil {
		return errors.New("YouTube session could not be saved")
	}
	account.epoch++
	account.activateLocked(session)
	return nil
}

func (a *YouTubeAccount) activateLocked(session *YouTubeLoginSession) {
	if a.syncCancel != nil {
		a.syncCancel()
		a.syncCancel = nil
	}
	a.syncID++
	a.syncing = false
	a.syncError = ""
	a.importing = false
	a.importStatus = YouTubeImportStatus{}
	a.library = nil
	a.auth = session.auth
	a.status = YouTubeAccountStatus{Linked: true, DisplayName: session.details.Name, Username: strings.TrimLeft(strings.TrimSpace(session.details.Handle), "@"), Email: session.details.Email, ImageURL: session.details.Thumbnail}
	if a.client != nil {
		a.client.SetCookieAuth(session.auth)
	}
}

func (a *YouTubeAccount) Disconnect() error {
	a.mu.Lock()
	if a.path != "" {
		if err := os.Remove(a.path); err != nil && !errors.Is(err, os.ErrNotExist) {
			a.mu.Unlock()
			return errors.New("YouTube session could not be removed")
		}
	}
	a.epoch++
	if a.syncCancel != nil {
		a.syncCancel()
		a.syncCancel = nil
	}
	a.syncID++
	a.syncing = false
	a.syncError = ""
	a.importing = false
	a.importStatus = YouTubeImportStatus{}
	a.library = nil
	a.auth = nil
	a.status = YouTubeAccountStatus{}
	if a.client != nil {
		a.client.SetCookieAuth(nil)
	}
	a.mu.Unlock()
	_ = YouTubeAccountChanged.Broadcast(false)
	return nil
}
