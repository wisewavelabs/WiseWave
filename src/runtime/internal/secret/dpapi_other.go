//go:build !windows

package secret

import "fmt"

func Protect(plaintext []byte) ([]byte, error) {
	if len(plaintext) == 0 {
		return nil, nil
	}
	return nil, fmt.Errorf("DPAPI is only available on Windows")
}

func Unprotect(ciphertext []byte) ([]byte, error) {
	if len(ciphertext) == 0 {
		return nil, nil
	}
	return nil, fmt.Errorf("DPAPI is only available on Windows")
}

func RestrictPath(path string) error {
	return nil
}
