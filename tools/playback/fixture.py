"""Regenerate original, synthetic VBR seek-test audio using the pinned encoder."""
from array import array
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import random
import tempfile

import av
from generate import generate_asset


def generate(output):
    output.mkdir(parents=True, exist_ok=True)
    source = output / 'seek.mp3'
    rng = random.Random(78341)
    with av.open(str(source), 'w') as container:
        stream = container.add_stream('libmp3lame', rate=44100)
        stream.layout = 'stereo'
        stream.codec_context.flags |= av.codec.context.Flags.qscale
        for block in range(24 * 40):
            frame = av.AudioFrame(format='fltp', layout='stereo', samples=1102)
            frame.sample_rate = 44100
            frame.time_base = Fraction(1, 44100)
            frame.pts = block * 1102
            samples = array('f')
            for index in range(1102):
                t = (block * 1102 + index) / 44100
                # Vary spectral complexity and amplitude, making positions
                # identifiable without relying on the browser-reported time.
                envelope = 0.1 + 0.08 * math.sin(t * 13.7) * math.sin(t * 7.3)
                noise = rng.uniform(-1, 1) * (0.04 if int(t) % 3 else 0)
                samples.append(envelope * math.sin(2 * math.pi * (440 * t + 3 * t * t)) + noise)
            for plane in frame.planes:
                plane.update(samples.tobytes())
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
    raw = source.read_bytes()
    asset = dict(id='synthetic-vbr', kind='audio', mediaType='audio/mpeg',
                 sourceRoot='audio', relativePath='seek.mp3', url='https://podcast.nurevolution.net/seek.mp3',
                 byteLength=len(raw), sha256=hashlib.sha256(raw).hexdigest())
    (output / 'headers').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as temp:
        entry = generate_asset(asset, source, output, Path(temp))
    if entry['mode'] != 'VBR':
        raise ValueError('Fixture must contain genuinely variable frame bitrates')
    (output / 'fixture.json').write_text(json.dumps(dict(asset=asset, entry=entry), indent=2) + '\n')


if __name__ == '__main__':
    generate(Path('test/fixtures/playback'))
