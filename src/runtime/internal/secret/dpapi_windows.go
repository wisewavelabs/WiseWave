//go:build windows

package secret

import (
	"fmt"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

var appEntropy = []byte{
	0x6a, 0x3f, 0x91, 0xc2, 0x4e, 0xb8, 0x17, 0xd5,
	0xa0, 0x5c, 0xe9, 0x2b, 0x74, 0x8f, 0x01, 0xde,
	0x33, 0x9a, 0x46, 0xf1, 0x7c, 0x0d, 0xb6, 0x58,
	0xe2, 0x19, 0xaf, 0x6d, 0x83, 0x40, 0xc7, 0x25,
}

func Protect(plaintext []byte) ([]byte, error) {
	if len(plaintext) == 0 {
		return nil, nil
	}
	in := windows.DataBlob{
		Size: uint32(len(plaintext)),
		Data: &plaintext[0],
	}
	entropy := windows.DataBlob{
		Size: uint32(len(appEntropy)),
		Data: &appEntropy[0],
	}
	var out windows.DataBlob
	name, err := windows.UTF16PtrFromString("WiseWave")
	if err != nil {
		return nil, err
	}
	if err := windows.CryptProtectData(&in, name, &entropy, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, fmt.Errorf("DPAPI protect failed: %w", err)
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	protected := make([]byte, out.Size)
	copy(protected, unsafe.Slice(out.Data, out.Size))
	return protected, nil
}

func Unprotect(ciphertext []byte) ([]byte, error) {
	if len(ciphertext) == 0 {
		return nil, nil
	}
	in := windows.DataBlob{
		Size: uint32(len(ciphertext)),
		Data: &ciphertext[0],
	}
	entropy := windows.DataBlob{
		Size: uint32(len(appEntropy)),
		Data: &appEntropy[0],
	}
	var out windows.DataBlob
	if err := windows.CryptUnprotectData(&in, nil, &entropy, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, fmt.Errorf("DPAPI unprotect failed: %w", err)
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	plain := make([]byte, out.Size)
	copy(plain, unsafe.Slice(out.Data, out.Size))
	return plain, nil
}

func RestrictPath(path string) error {
	token := windows.GetCurrentProcessToken()
	user, err := token.GetTokenUser()
	if err != nil {
		return err
	}
	sid := user.User.Sid

	var pinner runtime.Pinner
	defer pinner.Unpin()
	pinner.Pin(sid)

	access := []windows.EXPLICIT_ACCESS{{
		AccessPermissions: windows.GENERIC_ALL,
		AccessMode:        windows.GRANT_ACCESS,
		Inheritance:       windows.NO_INHERITANCE,
		Trustee: windows.TRUSTEE{
			TrusteeForm:  windows.TRUSTEE_IS_SID,
			TrusteeType:  windows.TRUSTEE_IS_USER,
			TrusteeValue: windows.TrusteeValueFromSID(sid),
		},
	}}
	acl, err := windows.ACLFromEntries(access, nil)
	if err != nil {
		return err
	}
	return windows.SetNamedSecurityInfo(
		path,
		windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		nil,
		nil,
		acl,
		nil,
	)
}
