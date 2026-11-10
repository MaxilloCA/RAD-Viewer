"""Compare decoded, processed and PNG bytes with the Windows reference (stdlib only).

Run --record on Windows only when intentionally establishing a new baseline.
Intermediate clinical pixels live in a temporary directory and are removed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--record', action='store_true')
    args = parser.parse_args()
    if args.record and os.name != 'nt':
        raise SystemExit('Record the baseline on Windows only; compare against it on Mac.')
    version = json.loads((ROOT / 'package.json').read_text())['version']
    reference = ROOT / 'verification' / f'windows-pixels-{version}.json'
    subprocess.run(['cargo', 'build', '--locked', '--release', '-p', 'rad-core',
                    '--example', 'platform_pixels'], cwd=ROOT, check=True)
    binary = ROOT / 'target' / 'release' / 'examples' / 'platform_pixels'
    if os.name == 'nt':
        binary = binary.with_suffix('.exe')
    results = {}
    samples = sorted((ROOT / 'demo' / 'John Smith').glob('*.dcm'))
    if len(samples) != 5:
        raise SystemExit('Expected the five embedded demo DICOMs in demo/John Smith.')
    for sample in samples:
        before = hashlib.sha256(sample.read_bytes()).hexdigest()
        with tempfile.TemporaryDirectory(prefix='rad-platform-pixels-') as tmp:
            subprocess.run([str(binary), str(sample), tmp], cwd=ROOT, check=True)
            results[sample.name] = {'input': before, **{
                file.name: hashlib.sha256(file.read_bytes()).hexdigest()
                for file in sorted(Path(tmp).iterdir())
            }}
        if hashlib.sha256(sample.read_bytes()).hexdigest() != before:
            raise SystemExit(f'Source changed: {sample.name}')
    if args.record:
        reference.write_text(json.dumps(results, indent=2) + '\n', encoding='utf-8')
        print(f'Recorded Windows pixel reference: {reference}')
    else:
        expected = json.loads(reference.read_text(encoding='utf-8'))
        if results != expected:
            for name in sorted(set(results) | set(expected)):
                if results.get(name) != expected.get(name):
                    print(f'DIFFERENCE: {name}: inspect raw, neutral, suggested and PNG hashes')
            raise SystemExit('Pixel comparison failed. Investigate before accepting the Mac build.')
        print('PASS: all five sources, decoded samples, neutral/suggested RGBA and PNGs match Windows exactly.')


if __name__ == '__main__':
    main()
