package listening

const QualifyMinMs int64 = 30_000

func Qualify(listenedMs, durationMs int64) (qualified, completed bool) {
	if listenedMs < 0 {
		listenedMs = 0
	}
	if durationMs < 0 {
		durationMs = 0
	}
	threshold := QualifyMinMs
	if durationMs > 0 {
		half := durationMs / 2
		if half < threshold {
			threshold = half
		}
	}
	qualified = listenedMs >= threshold
	completed = durationMs > 0 && listenedMs*10 >= durationMs*9
	return qualified, completed
}

func storedFlags(listenedMs, durationMs int64) (qualified, completed bool) {
	if listenedMs <= 0 {
		return false, false
	}
	return Qualify(listenedMs, durationMs)
}

func flagInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
