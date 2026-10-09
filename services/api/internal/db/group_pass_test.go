package db

import "testing"

func TestContentIsGroupPass(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"[PASS]", true},
		{"`[PASS]`", true},
		{"**[PASS]**", true},
		{"【PASS】", true},
		{"PASS。", true},
		{"hello", false},
		{"PASS later", false},
	}
	for _, c := range cases {
		if got := ContentIsGroupPass(c.in); got != c.want {
			t.Fatalf("ContentIsGroupPass(%q)=%v want %v", c.in, got, c.want)
		}
	}
}
