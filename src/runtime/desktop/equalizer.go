package desktop

import "math"

type eqFilter struct {
	b0, b1, b2, a1, a2 float64
	x1, x2, y1, y2     [2]float64
}

func peakFilter(rate int, frequency, gain float64) eqFilter {
	a := math.Pow(10, gain/40)
	w := 2 * math.Pi * frequency / float64(rate)
	alpha := math.Sin(w) / (2 * 0.8)
	a0 := 1 + alpha/a
	return eqFilter{
		b0: (1 + alpha*a) / a0,
		b1: -2 * math.Cos(w) / a0,
		b2: (1 - alpha*a) / a0,
		a1: -2 * math.Cos(w) / a0,
		a2: (1 - alpha/a) / a0,
	}
}

func (d *opusDecoder) applyEqualizer(samples []float32) {
	if d.equalizer == nil || d.channels < 1 || d.channels > 2 {
		return
	}
	preset := d.equalizer.Load()
	if preset != d.eqPreset {
		d.eqPreset, d.eqFilters = preset, nil
		var gains [3]float64
		switch preset {
		case 1:
			gains = [3]float64{5, 0, 0}
		case 2:
			gains = [3]float64{-2, 4, 1}
		case 3:
			gains = [3]float64{0, 0, 5}
		case 4:
			gains = [3]float64{3, -1, 3}
		}
		for i, gain := range gains {
			if gain != 0 {
				d.eqFilters = append(d.eqFilters, peakFilter(d.rate, [...]float64{120, 1500, 7000}[i], gain))
			}
		}
	}
	for i, sample := range samples {
		channel := i % d.channels
		value := float64(sample)
		for j := range d.eqFilters {
			f := &d.eqFilters[j]
			out := f.b0*value + f.b1*f.x1[channel] + f.b2*f.x2[channel] - f.a1*f.y1[channel] - f.a2*f.y2[channel]
			f.x2[channel], f.x1[channel] = f.x1[channel], value
			f.y2[channel], f.y1[channel] = f.y1[channel], out
			value = out
		}
		if len(d.eqFilters) > 0 {
			value *= 0.56
		}
		samples[i] = float32(value)
	}
}
