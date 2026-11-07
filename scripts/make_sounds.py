#!/usr/bin/env python3
"""Synthesize BabelWurm's built-in alert sounds into resources/sounds/.

Every sound is generated from scratch here (sine partials, envelopes and a
little filtered noise), so the files are reproducible and owned by the project.
Needs numpy. Run from the repository root:  python3 scripts/make_sounds.py
"""
import os
import wave

import numpy as np

RATE = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "resources", "sounds")


def t(seconds):
    return np.arange(int(RATE * seconds)) / RATE


def env(n, attack=0.004, decay=None, release=0.02):
    """Attack ramp, optional exponential decay (time constant in s), short release."""
    x = np.ones(n)
    a = max(1, int(RATE * attack))
    x[:a] = np.linspace(0, 1, a)
    if decay:
        x *= np.exp(-np.arange(n) / (RATE * decay))
    r = max(1, int(RATE * release))
    x[-r:] *= np.linspace(1, 0, r)
    return x


def tone(freq, seconds, partials=((1, 1.0),), decay=None, attack=0.004, release=0.02):
    tt = t(seconds)
    y = sum(amp * np.sin(2 * np.pi * freq * mult * tt) for mult, amp in partials)
    return y * env(len(tt), attack, decay, release)


def place(total, *parts):
    """Mix (offset_seconds, signal) parts into one buffer of `total` seconds."""
    out = np.zeros(int(RATE * total))
    for offset, sig in parts:
        i = int(RATE * offset)
        out[i:i + len(sig)] += sig[: len(out) - i]
    return out


def normalize(y, peak=0.7):
    return y / (np.max(np.abs(y)) or 1) * peak


def save(name, y):
    y = normalize(y)
    data = (y * 32767).astype("<i2").tobytes()
    with wave.open(os.path.join(OUT, f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(data)
    print(f"{name}.wav  {len(y) / RATE:.2f}s")


soft = ((1, 1.0), (2, 0.18), (3, 0.05))

# beep: the default, two quick soft blips going up
beep = place(0.26,
             (0.00, tone(880, 0.08, soft, attack=0.006, release=0.03)),
             (0.12, tone(1174.7, 0.11, soft, decay=0.08, attack=0.006, release=0.03)))

# chime: an open arpeggio (C6, G6, E7) with glassy partials
glass = ((1, 1.0), (2.01, 0.25), (3.98, 0.08))
chime = place(1.2,
              (0.00, tone(1046.5, 1.0, glass, decay=0.35)),
              (0.11, tone(1568.0, 0.95, glass, decay=0.32)),
              (0.22, tone(2637.0, 0.95, glass, decay=0.28)))

# bell: one struck bell, inharmonic partials decaying at different speeds
bell_t = t(1.9)
bell = np.zeros(len(bell_t))
for mult, amp, dec in [(0.5, 0.35, 0.9), (1.0, 1.0, 0.7), (1.19, 0.45, 0.5), (1.56, 0.3, 0.4),
                       (2.0, 0.35, 0.35), (2.66, 0.18, 0.25), (3.01, 0.12, 0.2), (4.1, 0.06, 0.12)]:
    bell += amp * np.sin(2 * np.pi * 440 * mult * bell_t) * np.exp(-bell_t / dec)
bell *= env(len(bell_t), attack=0.002, release=0.05)

# ding: a single bright, short tone
ding = tone(1760, 0.32, ((1, 1.0), (2.76, 0.22), (5.4, 0.05)), decay=0.09, attack=0.002)

# pop: a bubble — a sine sweeping down fast, plus a click of filtered noise
pop_t = t(0.12)
freq = 900 * np.exp(-pop_t / 0.03) + 180
phase = 2 * np.pi * np.cumsum(freq) / RATE
rng = np.random.default_rng(7)
noise = np.convolve(rng.standard_normal(len(pop_t)), np.ones(8) / 8, mode="same")
pop = (np.sin(phase) + 0.25 * noise * np.exp(-pop_t / 0.004)) * env(len(pop_t), attack=0.001, decay=0.03, release=0.01)

# alarm: two alternating tones, four times, with a few odd harmonics for bite
bite = ((1, 1.0), (3, 0.22), (5, 0.08))
parts = []
for k in range(4):
    parts.append((k * 0.25, tone(784, 0.11, bite, attack=0.005, release=0.015)))
    parts.append((k * 0.25 + 0.125, tone(1046.5, 0.11, bite, attack=0.005, release=0.015)))
alarm = place(1.02, *parts)

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, y in [("beep", beep), ("chime", chime), ("bell", bell), ("ding", ding), ("pop", pop), ("alarm", alarm)]:
        save(name, y)
