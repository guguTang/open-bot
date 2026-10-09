package httpserver

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

func TestIsCancelErr(t *testing.T) {
	if !isCancelErr(context.Canceled) {
		t.Fatal("context.Canceled should match")
	}
	if !isCancelErr(fmt.Errorf("wrap: %w", context.Canceled)) {
		t.Fatal("wrapped context.Canceled should match")
	}
	if !isCancelErr(errors.New("Get \"http://x\": context canceled")) {
		t.Fatal("net/http-style cancel string should match")
	}
	// Upstream LLM gateway 502 body must NOT look like our run cancel.
	up := errors.New("upstream HTTP 502: downstream request canceled before upstream response headers: context canceled")
	if isCancelErr(up) {
		t.Fatal("gateway cancel-flavored 502 must not be treated as run cancel")
	}
	if isCancelErr(errors.New("upstream HTTP 500: boom")) {
		t.Fatal("generic upstream error is not cancel")
	}
	if isCancelErr(nil) {
		t.Fatal("nil is not cancel")
	}
}
