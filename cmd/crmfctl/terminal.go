package main

import (
	"context"
	"errors"
	"fmt"
	"os"

	"golang.org/x/term"
)

func readTerminalSecret(ctx context.Context, prompt string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	fd := int(os.Stdin.Fd())
	if !term.IsTerminal(fd) {
		return nil, errors.New("password input requires an interactive terminal")
	}
	state, err := term.GetState(fd)
	if err != nil {
		return nil, errors.New("terminal unavailable")
	}
	// Restore even when cancellation wins while ReadPassword is blocked.
	defer func() { _ = term.Restore(fd, state) }()
	if _, err := fmt.Fprint(os.Stderr, prompt); err != nil {
		return nil, errors.New("terminal unavailable")
	}
	type result struct {
		password []byte
		err      error
	}
	completed := make(chan result)
	go func() {
		password, err := term.ReadPassword(fd)
		select {
		case completed <- result{password, err}:
		case <-ctx.Done():
			clear(password)
		}
	}()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case r := <-completed:
		_, _ = fmt.Fprintln(os.Stderr)
		return r.password, r.err
	}
}
