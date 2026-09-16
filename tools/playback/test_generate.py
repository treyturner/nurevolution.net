"""Exercise the actual pinned muxer against the checked-in synthetic audio."""
import gzip
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from generate import generate_asset, mp4_header, pcm_digest, trim_presentation


class IndexTests(unittest.TestCase):
    def test_regeneration_preserves_compressed_audio_and_pcm_timeline(self):
        fixture = Path('test/fixtures/playback')
        expected = json.loads((fixture / 'fixture.json').read_text())
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / 'headers').mkdir()
            entry = generate_asset(expected['asset'], fixture / 'seek.mp3', output, output)
            self.assertEqual(entry, expected['entry'])
            virtual = entry['virtual']
            header = gzip.decompress((output / 'headers' / (virtual['sha256'] + '.gz')).read_bytes())
            source = (fixture / 'seek.mp3').read_bytes()
            reference = header + source[virtual['audioOffset']:virtual['audioOffset'] + virtual['audioByteLength']]
            self.assertEqual(hashlib.sha256(reference).hexdigest(), virtual['sha256'])
            remux = output / 'complete.m4a'
            remux.write_bytes(reference)
            self.assertEqual(mp4_header(remux), (header, virtual['audioByteLength']))
            self.assertEqual(pcm_digest(remux, virtual['samples']), (virtual['samples'], virtual['pcmSha256']))
            # Presentation edits must cap even more than one complete packet of padding.
            shortened = virtual['samples'] - 2304
            remux.write_bytes(trim_presentation(header, shortened) + reference[len(header):])
            import av
            with av.open(str(remux)) as container:
                stream = container.streams.audio[0]
                self.assertEqual(stream.duration * stream.time_base * 44100, shortened)
            self.assertEqual(pcm_digest(remux, shortened), pcm_digest(fixture / 'seek.mp3', shortened))

    def test_rejects_wrong_identity_before_remuxing(self):
        fixture = Path('test/fixtures/playback')
        asset = json.loads((fixture / 'fixture.json').read_text())['asset']
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            for change in [{'sha256': '0' * 64}, {'byteLength': 1}]:
                with self.assertRaisesRegex(ValueError, 'Source identity mismatch'):
                    generate_asset({**asset, **change}, fixture / 'seek.mp3', output, output)


if __name__ == '__main__':
    unittest.main()
