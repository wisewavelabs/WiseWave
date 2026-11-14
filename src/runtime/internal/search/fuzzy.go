package search

import "strings"

func tokenMatch(a, b string) float64 {
	if a == b {
		return 1
	}
	ar, br := []rune(a), []rune(b)
	if len(ar) >= 3 && strings.HasPrefix(b, a) {
		return .9
	}
	if len(ar) < 4 || len(br) < 4 || abs(len(ar)-len(br)) > 2 {
		return 0
	}
	prev := make([]int, len(br)+1)
	before := make([]int, len(br)+1)
	for j := range prev {
		prev[j] = j
	}
	for i, x := range ar {
		row := make([]int, len(br)+1)
		row[0] = i + 1
		for j, y := range br {
			cost := 1
			if x == y {
				cost = 0
			}
			row[j+1] = min(row[j]+1, prev[j+1]+1, prev[j]+cost)
			if i > 0 && j > 0 && x == br[j-1] && ar[i-1] == y {
				row[j+1] = min(row[j+1], before[j-1]+1)
			}
		}
		before, prev = prev, row
	}
	d := prev[len(br)]
	limit := 1
	if len(ar) >= 7 && len(br) >= 7 {
		limit = 2
	}
	if d > limit {
		return 0
	}
	return 1 - float64(d)/float64(max(len(ar), len(br)))
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

func coverage(query, field []string) float64 {
	if len(query) == 0 || len(field) == 0 {
		return 0
	}
	used := make([]bool, len(field))
	total := 0.0
	for _, q := range query {
		best, index := 0.0, -1
		for j, f := range field {
			if !used[j] {
				if s := tokenMatch(q, f); s > best {
					best, index = s, j
				}
			}
		}
		if index >= 0 {
			used[index] = true
			total += best
		}
	}
	return total / float64(len(query))
}
