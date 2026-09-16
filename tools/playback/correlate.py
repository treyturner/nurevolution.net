"""Full-resolution normalized waveform correlation for the opt-in listening audit."""
import json
import sys

import numpy as np

reference = np.fromfile(sys.argv[1], dtype='<f4', offset=44).astype(np.float64)
captured = np.fromfile(sys.argv[2], dtype='<f4').astype(np.float64)
skip = int(0.25 * 44100)
signal = captured[skip:]
signal -= signal.mean()
size = 1 << (len(reference) + len(signal) - 2).bit_length()
spectrum = np.fft.rfft(reference, size)
spectrum *= np.conj(np.fft.rfft(signal, size))
dots = np.fft.irfft(spectrum, size)[:len(reference) - len(signal) + 1]
sums = np.concatenate(([0], np.cumsum(reference)))
squares = np.concatenate(([0], np.cumsum(reference * reference)))
window_energy = squares[len(signal):] - squares[:-len(signal)]
window_energy -= (sums[len(signal):] - sums[:-len(signal)]) ** 2 / len(signal)
scores = dots / np.sqrt(np.maximum(window_energy, 1e-30) * np.dot(signal, signal))
best = int(np.argmax(scores))
print(json.dumps(dict(offset=(best - skip) / 44100, correlation=float(scores[best]))))
