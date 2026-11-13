package listening

import "testing"

func TestQualify(t *testing.T) {
	tests := []struct {
		name      string
		listened  int64
		duration  int64
		qualified bool
		completed bool
	}{
		{name: "long track at 30s", listened: 30_000, duration: 240_000, qualified: true},
		{name: "long track under 30s", listened: 29_999, duration: 240_000},
		{name: "half of short track", listened: 10_000, duration: 20_000, qualified: true},
		{name: "under half of short track", listened: 9_999, duration: 20_000},
		{name: "thirty second track at half", listened: 15_000, duration: 30_000, qualified: true},
		{name: "completed at 90 percent", listened: 216_000, duration: 240_000, qualified: true, completed: true},
		{name: "just under 90 percent", listened: 215_999, duration: 240_000, qualified: true},
		{name: "short track completed", listened: 18_000, duration: 20_000, qualified: true, completed: true},
		{name: "unknown duration at 30s", listened: 30_000, duration: 0, qualified: true},
		{name: "unknown duration under 30s", listened: 29_999, duration: 0},
		{name: "unknown duration never completed", listened: 120_000, duration: 0, qualified: true},
		{name: "negative duration is unknown", listened: 30_000, duration: -5, qualified: true},
		{name: "negative listened is zero", listened: -1, duration: 20_000},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			qualified, completed := Qualify(test.listened, test.duration)
			if qualified != test.qualified || completed != test.completed {
				t.Fatalf("Qualify(%d, %d) = %v, %v; want %v, %v", test.listened, test.duration, qualified, completed, test.qualified, test.completed)
			}
		})
	}
}
