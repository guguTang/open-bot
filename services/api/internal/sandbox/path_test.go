package sandbox

import "testing"

func TestResolveWorkspacePath(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"", "/workspace"},
		{"tetris.html", "/workspace/tetris.html"},
		{"/tetris.html", "/workspace/tetris.html"},
		{"/workspace/tetris.html", "/workspace/tetris.html"},
		{"workspace/tetris.html", "/workspace/workspace/tetris.html"}, // relative segment
		// remark-rehype percent-encodes non-ASCII in sandbox: hrefs
		{"/workspace/bots/a/out/%E7%A4%BE%E4%BC%9A.html", "/workspace/bots/a/out/社会.html"},
		{"/workspace/out/%E4%B8%AD%E6%96%87.html", "/workspace/out/中文.html"},
	}
	for _, c := range cases {
		got, err := ResolveWorkspacePath(c.in)
		if err != nil {
			t.Fatalf("%q: %v", c.in, err)
		}
		if got != c.want {
			t.Fatalf("%q: got %q want %q", c.in, got, c.want)
		}
	}
}
