package desktop

import (
	"math"
	"sync/atomic"
)

type eqFilter struct {
	b0, b1, b2, a1, a2 float64
	x1, x2, y1, y2     [2]float64
}

type eqSettings struct {
	enabled bool
	gains   [6]float64
}

type eqProcessor struct {
	source  *atomic.Pointer[eqSettings]
	current *eqSettings
	preamp  float64
	filters []eqFilter
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

func (d *eqProcessor) apply(samples []float32, rate, channels int) {
	if d.source == nil || channels < 1 || channels > 2 || rate <= 0 {
		return
	}
	config := d.source.Load()
	if config != d.current {
		d.current, d.filters, d.preamp = config, nil, 1
		if config != nil && config.enabled {
			var boost float64
			for i, gain := range config.gains {
				frequency := [...]float64{60, 150, 400, 1000, 2400, 15000}[i]
				if gain != 0 && frequency < float64(rate)/2 {
					d.filters = append(d.filters, peakFilter(rate, frequency, gain))
					boost += math.Max(gain, 0)
				}
			}
			d.preamp = math.Pow(10, -boost/20)
		}
	}
	for i, sample := range samples {
		channel := i % channels
		value := float64(sample)
		for j := range d.filters {
			f := &d.filters[j]
			out := f.b0*value + f.b1*f.x1[channel] + f.b2*f.x2[channel] - f.a1*f.y1[channel] - f.a2*f.y2[channel]
			f.x2[channel], f.x1[channel] = f.x1[channel], value
			f.y2[channel], f.y1[channel] = f.y1[channel], out
			value = out
		}
		if len(d.filters) > 0 {
			value *= d.preamp
		}
		samples[i] = float32(value)
	}
}
