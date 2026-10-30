from pathlib import Path
import hashlib, json, subprocess

releases = json.loads(subprocess.check_output(['/opt/homebrew/bin/gh', 'api', 'repos/nakhundov02/GhostBar/releases'], text=True))
release, = [item for item in releases if item['tag_name'] == 'v2.0.5']
outputs = Path('/Users/n_akhundov02/Documents/Codex/2026-10-27/i-ha/outputs')
paths = [outputs/'GhostBar/dist/GhostBar-2.0.5-arm64.zip', outputs/'GhostBar/dist/GhostBar-2.0.5-x64.zip', outputs/'GhostBar-source.zip', Path('/private/tmp/ghostbar-2.0.5/SHA256SUMS.txt')]
assert {a['name'] for a in release['assets']} == {p.name for p in paths}
for path in paths:
    asset, = [a for a in release['assets'] if a['name'] == path.name]
    assert asset['state'] == 'uploaded'
    assert asset['size'] == path.stat().st_size
    assert asset['digest'] == 'sha256:' + hashlib.sha256(path.read_bytes()).hexdigest()
    print('GitHub size and SHA-256 verified:', path.name)
print('Release draft:', release['draft'])
