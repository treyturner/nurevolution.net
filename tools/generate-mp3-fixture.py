"""Generate an original test tone with the system libmp3lame encoder; not a CI dependency."""
import ctypes
import ctypes.util
import hashlib
import math
from pathlib import Path

library = ctypes.util.find_library('mp3lame')
if not library:
    raise SystemExit('libmp3lame is needed only to regenerate this committed fixture')
lame = ctypes.CDLL(library)
lame.lame_init.restype = ctypes.c_void_p
context = lame.lame_init()
for name in ['lame_set_in_samplerate', 'lame_set_num_channels', 'lame_set_brate', 'lame_set_quality', 'lame_set_bWriteVbrTag', 'lame_set_write_id3tag_automatic']:
    getattr(lame, name).argtypes = [ctypes.c_void_p, ctypes.c_int]
for name, value in [('lame_set_in_samplerate', 22050), ('lame_set_num_channels', 1), ('lame_set_brate', 64), ('lame_set_quality', 2), ('lame_set_bWriteVbrTag', 0), ('lame_set_write_id3tag_automatic', 0)]:
    assert getattr(lame, name)(context, value) == 0
lame.lame_init_params.argtypes = [ctypes.c_void_p]
assert lame.lame_init_params(context) == 0
samples = (ctypes.c_short * 44100)(*(round(1638 * math.sin(2 * math.pi * 440 * i / 22050)) for i in range(44100)))
output = (ctypes.c_ubyte * 70000)()
lame.lame_encode_buffer.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_short), ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.POINTER(ctypes.c_ubyte), ctypes.c_int]
length = lame.lame_encode_buffer(context, samples, samples, len(samples), output, len(output))
assert length >= 0
result = bytes(output[:length])
lame.lame_encode_flush.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ubyte), ctypes.c_int]
length = lame.lame_encode_flush(context, output, len(output))
assert length >= 0
result += bytes(output[:length])
lame.lame_close.argtypes = [ctypes.c_void_p]
lame.lame_close(context)
path = Path(__file__).resolve().parents[1] / 'test/fixtures/media-app/public/sample.mp3'
path.write_bytes(result)
print(f'{len(result)} bytes; SHA-256 {hashlib.sha256(result).hexdigest()}')
