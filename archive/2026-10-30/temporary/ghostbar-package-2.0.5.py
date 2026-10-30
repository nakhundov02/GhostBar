from pathlib import Path
import hashlib, json, plistlib, shutil, struct, subprocess, zipfile

root = Path('/private/tmp/ghostbar-publish-2.0.4/GhostBar')
base = Path('/private/tmp/ghostbar-2.0.5')
previous = Path('/private/tmp/ghostbar-2.0.4')
outputs = Path('/Users/n_akhundov02/Documents/Codex/2026-10-27/i-ha/outputs')
canonical = outputs / 'GhostBar'
base.mkdir(exist_ok=True)
payload = base / 'payload'
shutil.copytree(previous / 'payload', payload, dirs_exist_ok=True)
shutil.rmtree(payload / 'core')
(payload / 'core').mkdir()
for source in (root / 'core').glob('*.js'):
    shutil.copy2(source, payload / 'core' / source.name)
shutil.copytree(root / 'src', payload / 'src', dirs_exist_ok=True)
shutil.copy2(root / 'package.json', payload / 'package.json')
subprocess.run(['/opt/homebrew/bin/node', '-e', "require('/private/tmp/ghostbar-2.0.2-tools/node_modules/@electron/asar/lib/asar.js').createPackage(process.argv[1],process.argv[2]).catch(e=>{console.error(e);process.exitCode=1})", str(payload), str(base / 'app.asar')], check=True)
data = (base / 'app.asar').read_bytes()
length = struct.unpack('<I', data[12:16])[0]
digest = hashlib.sha256(data[16:16+length]).hexdigest()
for arch in ('arm64', 'x64'):
    app = base / 'bundles' / arch / 'GhostBar.app'
    if app.exists():
        shutil.rmtree(app)
    shutil.copytree(previous / 'bundles' / arch / 'GhostBar.app', app, symlinks=True, dirs_exist_ok=True)
    resources = app / 'Contents/Resources'
    shutil.copy2(base / 'app.asar', resources / 'app.asar')
    for source, dest in ((root/'core/addon.py', 'addon.py'), (root/'src/snippet.html', 'snippet.html')):
        shutil.copy2(source, resources / dest)
    info = app / 'Contents/Info.plist'
    plist = plistlib.loads(info.read_bytes())
    plist['CFBundleShortVersionString'] = plist['CFBundleVersion'] = '2.0.5'
    plist['ElectronAsarIntegrity'] = {'Resources/app.asar': {'algorithm': 'SHA256', 'hash': digest}}
    info.write_bytes(plistlib.dumps(plist))
    subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', '--preserve-metadata=entitlements,requirements,flags,runtime', '--timestamp=none', str(app)], check=True)
    subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(app)], check=True)
    target = outputs / 'GhostBar/dist' / ('GhostBar-2.0.5-' + arch + '.zip')
    subprocess.run(['/usr/bin/ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(app), str(target)], check=True)
    with zipfile.ZipFile(target) as z:
        assert z.testzip() is None
        published = plistlib.loads(z.read('GhostBar.app/Contents/Info.plist'))
        assert published['CFBundleShortVersionString'] == '2.0.5'
        assert z.read('GhostBar.app/Contents/Resources/app.asar') == data
        certificate_paths = [p for p in z.namelist() if p.endswith(('.pem', '.key', '.p12')) and not p.startswith('__MACOSX/')]
        ca_path = 'GhostBar.app/Contents/Resources/mitmproxy/' + arch + '/mitmproxy.app/Contents/Resources/certifi/cacert.pem'
        assert certificate_paths == [ca_path]
        assert z.read(ca_path) == (previous / 'bundles' / arch / ca_path).read_bytes()
    print('Verified', target.name, flush=True)

files = subprocess.check_output(['git', 'ls-files'], cwd=root, text=True).splitlines()
files += ['core/certificate.js', 'tests/certificate.test.js']
for name in files:
    source = root / name
    target = canonical / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
with zipfile.ZipFile(outputs / 'GhostBar-source.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for name in files:
        assert not name.endswith(('.pem', '.key', '.p12'))
        z.write(root / name, 'GhostBar/' + name)
with zipfile.ZipFile(outputs / 'GhostBar-source.zip') as z:
    assert z.testzip() is None
    assert len(z.namelist()) == len(set(z.namelist()))
names = ['GhostBar/dist/GhostBar-2.0.5-arm64.zip', 'GhostBar/dist/GhostBar-2.0.5-x64.zip', 'GhostBar-source.zip']
checksums = [(hashlib.sha256((outputs/name).read_bytes()).hexdigest(), name) for name in names]
(outputs / 'SHA256SUMS.txt').write_text(''.join(f'{sha}  {name}\n' for sha, name in checksums))
(base / 'SHA256SUMS.txt').write_text(''.join(f'{sha}  {Path(name).name}\n' for sha, name in checksums))
print('Source, checksums and canonical workspace updated.', flush=True)
