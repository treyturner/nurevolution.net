"""Offline, lossless MP3-in-MP4 indexing. Never run conversion on the web host."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import struct
import tempfile

import av


def digest(path, offset=0, length=None):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        stream.seek(offset)
        while length is None or length > 0:
            chunk = stream.read(min(length, 1024 * 1024) if length is not None else 1024 * 1024)
            if not chunk:
                if length:
                    raise ValueError('Truncated audio payload')
                break
            result.update(chunk)
            if length is not None:
                length -= len(chunk)
    return result.hexdigest()


def pcm_digest(path, samples=None):
    """Hash presented planar PCM, excluding MP4's last partial packet padding."""
    hashes = None
    count = 0
    with av.open(str(path)) as container:
        for frame in container.decode(container.streams.audio[0]):
            if frame.format.name != 'fltp':
                raise ValueError('Expected floating point planar MP3 decoding')
            if hashes is None:
                hashes = [hashlib.sha256() for _ in frame.planes]
            take = frame.samples if samples is None else min(frame.samples, samples - count)
            for channel, plane in zip(hashes, frame.planes, strict=True):
                channel.update(bytes(plane)[:take * 4])
            count += take
    if (samples is not None and count != samples) or hashes is None:
        raise ValueError('Decoded presentation sample count mismatch')
    return count, [channel.hexdigest() for channel in hashes]


def mp4_header(path):
    """Require one final mdat, preceded by the complete fast-start index."""
    size = path.stat().st_size
    found_moov = False
    with path.open('rb') as stream:
        while stream.tell() < size:
            start = stream.tell()
            length, kind = struct.unpack('>I4s', stream.read(8))
            if length == 1:
                length = struct.unpack('>Q', stream.read(8))[0]
            if length < stream.tell() - start or start + length > size:
                raise ValueError('Invalid MP4 atom')
            if kind == b'moov':
                found_moov = True
            if kind == b'mdat':
                if not found_moov or start + length != size:
                    raise ValueError('Expected a single final audio payload')
                prefix_size = stream.tell()
                stream.seek(0)
                return stream.read(prefix_size), size - prefix_size
            stream.seek(start + length)
    raise ValueError('Missing audio payload')


def trim_presentation(header, samples):
    """An MP3 can end in multiple padding packets; trim via its MP4 edit list.

    libavformat substitutes a full duration for zero-duration audio packets.
    Keep those encoded packets but set the presented movie/track/edit duration.
    The media duration (mdhd) continues to describe all coded samples.
    """
    header = bytearray(header)
    found = set()

    def walk(start, end):
        while start + 8 <= end:
            size, kind = struct.unpack_from('>I4s', header, start)
            if size < 8:
                raise ValueError('Unexpected MP4 metadata atom')
            payload = start + 8
            if kind in (b'moov', b'trak', b'mdia', b'edts'):
                walk(payload, start + size)
            if kind in (b'mvhd', b'tkhd', b'elst'):
                version = header[payload]
                if version not in (0, 1) or kind in found:
                    raise ValueError('Unexpected MP4 timeline')
                found.add(kind)
                if kind == b'elst':
                    if struct.unpack_from('>I', header, payload + 4)[0] != 1:
                        raise ValueError('Expected a single presentation edit')
                    offset = 8
                else:
                    offset = (24 if version else 16) + (4 if kind == b'tkhd' else 0)
                struct.pack_into('>Q' if version else '>I', header, payload + offset, samples)
            start += size
    walk(0, len(header))
    if found != {b'mvhd', b'tkhd', b'elst'}:
        raise ValueError('Missing presentation edit metadata')
    return bytes(header)


def generate_asset(asset, source, output, temporary):
    if source.is_symlink() or source.stat().st_size != asset['byteLength'] or digest(source) != asset['sha256']:
        raise ValueError(f"Source identity mismatch: {asset['id']}")
    entry = dict(assetId=asset['id'], sourceSha256=asset['sha256'], sourceByteLength=asset['byteLength'])
    rates = set()
    count = 0
    first = None
    end = None
    # Inspect actual audio packets, excluding Xing/Info metadata frames.
    with av.open(str(source)) as inp:
        stream = inp.streams.audio[0]
        if stream.codec_context.name != 'mp3float' or stream.codec_context.sample_rate != 44100:
            raise ValueError('Only the audited 44.1 kHz MP3 profile is supported')
        for packet in inp.demux(stream):
            if packet.dts is None:
                continue
            if first is None:
                first = packet.pos
            if end is not None and packet.pos != end:
                raise ValueError('Noncontiguous MP3 audio packets')
            end = packet.pos + packet.size
            header = int.from_bytes(bytes(packet)[:4], 'big')
            if (header >> 19) & 3 != 3 or (header >> 17) & 3 != 1:
                raise ValueError('Expected MPEG-1 layer III audio')
            rates.add([0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0][(header >> 12) & 15])
            count += 1
        if not rates or 0 in rates:
            raise ValueError('Invalid MP3 bitrate')
    entry.update(mode='CBR' if len(rates) == 1 else 'VBR', bitrates=sorted(rates), frameCount=count)
    if entry['mode'] == 'CBR':
        return entry
    # Some VBRI tags count their non-audio header as an additional frame.
    # The decoded presentation, rather than that estimate, is authoritative.
    samples, pcm = pcm_digest(source)
    remux = temporary / 'reference.m4a'
    with av.open(str(source)) as inp, av.open(str(remux), 'w', format='mp4', options={
        'movflags': '+faststart', 'movie_timescale': '44100',
    }) as out:
        stream = inp.streams.audio[0]
        target = out.add_stream_from_template(stream)
        start_time = stream.start_time
        end_time = start_time + samples * stream.time_base.denominator // (44100 * stream.time_base.numerator)
        for packet in inp.demux(stream):
            if packet.dts is None:
                continue
            packet.duration = min(packet.duration, max(0, end_time - packet.pts))
            packet.pts -= start_time
            packet.dts -= start_time
            packet.stream = target
            out.mux(packet)
    header, audio_length = mp4_header(remux)
    header = trim_presentation(header, samples)
    with remux.open('r+b') as stream:
        stream.write(header)
    if audio_length != end - first or digest(remux, len(header), audio_length) != digest(source, first, audio_length):
        raise ValueError('Remux changed the compressed audio')
    with av.open(str(remux)) as check:
        stream = check.streams.audio[0]
        if stream.start_time != 0 or stream.duration * stream.time_base * 44100 != samples:
            raise ValueError(f"{asset['relativePath']}: remux timeline {stream.start_time}, {stream.duration * stream.time_base * 44100} differs from {samples}")
    if (samples, pcm) != pcm_digest(remux, samples):
        raise ValueError('Remux changed the presented decoded audio')
    representation = digest(remux)
    filename = representation + '.gz'
    (output / 'headers' / filename).write_bytes(gzip.compress(header, compresslevel=9, mtime=0))
    entry['virtual'] = dict(
        sha256=representation, headerSha256=hashlib.sha256(header).hexdigest(),
        headerByteLength=len(header), byteLength=len(header) + audio_length,
        audioOffset=first, audioByteLength=audio_length, samples=samples,
        sampleRate=44100, pcmSha256=pcm,
    )
    remux.unlink()
    return entry


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', type=Path, default=Path('content/assets.json'))
    parser.add_argument('--audio', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('playback'))
    args = parser.parse_args()
    if av.__version__ != '16.1.0' or av.library_versions['libavformat'] != (62, 3, 100):
        raise ValueError('Use the pinned PyAV wheel and bundled FFmpeg libraries')
    (args.output / 'headers').mkdir(parents=True, exist_ok=True)
    assets = json.loads(args.assets.read_text())['assets']
    entries = []
    with tempfile.TemporaryDirectory(prefix='virtual-m4a-') as directory:
        for asset in sorted((a for a in assets if a['kind'] == 'audio'), key=lambda a: a['id']):
            entry = generate_asset(asset, args.audio / asset['relativePath'], args.output, Path(directory))
            entries.append(entry)
            print(f"Verified {entry['mode']}: {asset['relativePath']}", flush=True)
    manifest = dict(schemaVersion=1, generator='PyAV 16.1.0 / libavformat 62.3.100', entries=entries)
    pending = args.output / 'manifest.json.tmp'
    pending.write_text(json.dumps(manifest, indent=2) + '\n')
    pending.replace(args.output / 'manifest.json')
    expected = {e['virtual']['sha256'] + '.gz' for e in entries if 'virtual' in e}
    for old in (args.output / 'headers').glob('*.gz'):
        if len(old.stem) == 64 and all(c in '0123456789abcdef' for c in old.stem) and old.name not in expected:
            old.unlink()


if __name__ == '__main__':
    main()
