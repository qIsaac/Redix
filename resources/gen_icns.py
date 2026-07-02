#!/usr/bin/env python3
"""Generate .icns file from icon.png"""
import subprocess
import os
import shutil

base_dir = os.path.dirname(os.path.abspath(__file__))
icon_png = os.path.join(base_dir, 'icon.png')
iconset_dir = os.path.join(base_dir, 'icon.iconset')
icon_icns = os.path.join(base_dir, 'icon.icns')

# Clean up
if os.path.exists(iconset_dir):
    shutil.rmtree(iconset_dir)
os.makedirs(iconset_dir)

# Generate iconset files
sizes = [
    (16, 'icon_16x16.png'),
    (32, 'icon_16x16@2x.png'),
    (32, 'icon_32x32.png'),
    (64, 'icon_32x32@2x.png'),
    (128, 'icon_128x128.png'),
    (256, 'icon_128x128@2x.png'),
    (256, 'icon_256x256.png'),
    (512, 'icon_256x256@2x.png'),
    (512, 'icon_512x512.png'),
    (1024, 'icon_512x512@2x.png'),
]

for size, name in sizes:
    out_path = os.path.join(iconset_dir, name)
    subprocess.run([
        'sips', '-s', 'format', 'png', '-z', str(size), str(size),
        icon_png, '--out', out_path
    ], capture_output=True)

# Convert to icns
if os.path.exists(icon_icns):
    os.remove(icon_icns)

result = subprocess.run([
    'iconutil', '-c', 'icns', iconset_dir, '-o', icon_icns
], capture_output=True, text=True)

if result.returncode == 0:
    print(f"SUCCESS: {icon_icns} ({os.path.getsize(icon_icns)} bytes)")
else:
    print(f"FAILED: {result.stderr}")

# Clean up iconset
shutil.rmtree(iconset_dir)
