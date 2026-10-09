package httpserver

import "testing"

func TestShouldSteerBusyHarness(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		active string
		target string
		want   bool
	}{
		{name: "same agent steers", active: "bot-a", target: "bot-a", want: true},
		{name: "different @ member does not steer", active: "bot-a", target: "bot-b", want: false},
		{name: "empty active keeps DM/legacy steer", active: "", target: "bot-b", want: true},
		{name: "empty target keeps steer", active: "bot-a", target: "", want: true},
		{name: "whitespace treated as empty active", active: "  ", target: "bot-b", want: true},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := shouldSteerBusyHarness(tc.active, tc.target); got != tc.want {
				t.Fatalf("shouldSteerBusyHarness(%q,%q)=%v want %v", tc.active, tc.target, got, tc.want)
			}
		})
	}
}
