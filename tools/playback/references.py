"""Prepare small PCM references by decoding original MP3s from the beginning."""
import json
from pathlib import Path
import struct
import sys

import av

root = Path(sys.argv[1])
output = Path('.local/playback/references')
output.mkdir(parents=True, exist_ok=True)
assets = json.loads(Path('content/assets.json').read_text())['assets']
manifest = json.loads(Path('playback/manifest.json').read_text())['entries']
cases = []
for name, targets in [
    ('Praxis', [208.794059, 180, 240, 2000]),
    ('Radio_Silenced', [360, 240, 450, 6000]),
    ('2005_11_12-Cody', [340, 900]),
    ('Bizarre_NYE', [210, 360]),
]:
    asset, = [a for a in assets if a['kind'] == 'audio' and name in a['relativePath']]
    entry, = [e for e in manifest if e['assetId'] == asset['id']]
    buffers = [bytearray() for _ in targets]
    with av.open(str(root / asset['relativePath'])) as container:
        position = 0
        for frame in container.decode(container.streams.audio[0]):
            for target, data in zip(targets, buffers):
                start, end = int(max(0, target - 20) * 44100), int((target + 25) * 44100)
                first, last = max(start, position), min(end, position + frame.samples)
                if last > first:
                    data.extend(bytes(frame.planes[0])[(first - position) * 4:(last - position) * 4])
            position += frame.samples
            if position > (max(targets) + 25) * 44100:
                break
    for target, data in zip(targets, buffers):
        filename = f'{name}-{target}.wav'
        # IEEE float, mono 44.1 kHz. No lossy reference encoding or approximate seek.
        header = b'RIFF' + struct.pack('<I', 36 + len(data)) + b'WAVEfmt '
        header += struct.pack('<IHHIIHH', 16, 3, 1, 44100, 44100 * 4, 4, 32)
        (output / filename).write_bytes(header + b'data' + struct.pack('<I', len(data)) + data)
        cases.append(dict(episode=name, target=target, reference=filename,
                          referenceStart=int(max(0, target - 20) * 44100) / 44100,
                          path=f"/playback/{entry['sourceSha256']}/{entry['virtual']['sha256']}.m4a"))
(output / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')
