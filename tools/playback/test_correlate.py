import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np


class CorrelationTests(unittest.TestCase):
    def test_identifies_position_despite_repeating_envelopes_and_initial_silence(self):
        rng = np.random.default_rng(57)
        loop = rng.uniform(-1, 1, 20000)
        reference = (np.tile(loop, 10) + rng.uniform(-0.1, 0.1, 200000)).astype('<f4')
        capture = reference[40000:100000].copy()
        capture[:500] = 0
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'reference.wav').write_bytes(b'\0' * 44 + reference.tobytes())
            capture.tofile(root / 'capture.f32')
            result = subprocess.run([sys.executable, 'tools/playback/correlate.py',
                                     str(root / 'reference.wav'), str(root / 'capture.f32')],
                                    check=True, capture_output=True, text=True)
            match = json.loads(result.stdout)
            self.assertAlmostEqual(match['offset'], 40000 / 44100, places=9)
            self.assertGreater(match['correlation'], 0.99999)
