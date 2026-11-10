"""Package the current working source, including untracked code and embedded demo files.

Uses an allowlist, excludes build/dependency folders, and verifies every ZIP entry.
The resulting ZIP includes patient-derived demo pixels; keep it private.
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SKIP = {'node_modules', 'target', 'dist', 'gen', '__pycache__', '.git'}
EXTENSIONS = {'.rs', '.toml', '.json', '.lock', '.ts', '.tsx', '.css', '.html',
              '.md', '.py', '.ps1', '.sh', '.txt', '.png', '.jpg', '.svg', '.ico', '.icns'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def verify(directory):
    manifest = json.loads((directory / 'SOURCE-MANIFEST.json').read_text(encoding='utf-8'))
    for name, digest in manifest['files'].items():
        file = directory / name
        if not file.resolve().is_relative_to(directory.resolve()):
            raise SystemExit(f'Unsafe manifest path: {name}')
        if file.is_symlink() or sha(file.read_bytes()) != digest:
            raise SystemExit(f'Source verification failed: {name}')
    print(f"Verified {len(manifest['files'])} source files for {manifest['version']}.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify', type=Path, metavar='EXTRACTED_PROJECT')
    args = parser.parse_args()
    if args.verify:
        verify(args.verify)
        return
    version = json.loads((ROOT / 'package.json').read_text())['version']
    names = {p.relative_to(ROOT).as_posix() for p in ROOT.glob('*.md')}
    names.update({'.gitignore', 'Cargo.toml', 'Cargo.lock', 'package.json',
                  'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html'})
    for folder in ['src', 'src-tauri', 'crates', 'scripts', 'public', 'verification']:
        for file in (ROOT / folder).rglob('*'):
            if file.is_file() and not set(file.relative_to(ROOT).parts) & SKIP:
                if file.suffix in EXTENSIONS and not file.name.startswith('.env'):
                    names.add(file.relative_to(ROOT).as_posix())
    names.update({'demo/John Smith/PatientInfo.xml', *{
        f'demo/John Smith/Radiograph-{i:02}.dcm' for i in range(1, 6)
    }})
    payload = {}
    for name in sorted(names):
        file = ROOT / name
        if file.is_symlink() or not file.resolve().is_relative_to(ROOT):
            raise SystemExit(f'Unsafe source path: {name}')
        payload[name] = file.read_bytes()
    manifest = {'version': version, 'containsPatientDerivedDemoPixels': True,
                'files': {name: sha(data) for name, data in payload.items()}}
    payload['SOURCE-MANIFEST.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    destination = ROOT / 'output' / f'RAD-Viewer-{version}-Mac-source.zip'
    destination.parent.mkdir(exist_ok=True)
    prefix = f'RAD-Viewer-{version}-Mac-source/'
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in payload.items():
            archive.writestr(prefix + name, data)
    with zipfile.ZipFile(destination) as archive:
        if archive.testzip() is not None or set(archive.namelist()) != {prefix + n for n in payload}:
            raise SystemExit('Archive content verification failed')
        for name, data in payload.items():
            if sha(archive.read(prefix + name)) != sha(data):
                raise SystemExit(f'Archive hash verification failed: {name}')
    digest = sha(destination.read_bytes())
    destination.with_suffix('.zip.sha256').write_text(f'{digest}  {destination.name}\n')
    print(json.dumps({'archive': str(destination), 'files': len(payload),
                      'bytes': destination.stat().st_size, 'sha256': digest}, indent=2))


if __name__ == '__main__':
    main()
