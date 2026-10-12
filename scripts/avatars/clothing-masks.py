"""Build clothing-only UV masks for the bundled Rocketbox body atlases.
Optional authoring tool: Python 3 + Pillow. Runtime only loads the resulting PNGs.
"""
import json
import struct
from pathlib import Path
from io import BytesIO
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
for name in ['aria', 'nova', 'kai', 'leo', 'iris']:
    data = (ROOT / f'public/avatars/{name}.glb').read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20 + size])
    view = gltf['bufferViews'][gltf['images'][0]['bufferView']]
    start = 28 + size + view.get('byteOffset', 0)
    image = Image.open(BytesIO(data[start:start + view['byteLength']])).convert('RGB')
    mask = Image.new('L', image.size)
    pixels, result = image.load(), mask.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b = pixels[x, y]
            u, v = x / image.width, y / image.height
            if name == 'aria':
                cloth = b > g * 1.25 and r > g * 1.15 and b > r * .95
            elif name == 'iris':
                cloth = r > g * 1.18 and b > g * 1.04 and r < b * 1.9
            elif name == 'nova':
                cloth = .335 < u < .665 and v < .76
            elif name == 'kai':
                cloth = (.325 < u < .675 and v < .90) or ((u < .285 or u > .715) and .46 < v < .835)
            else:  # leo: blue shirt; hands and trousers occupy other UV islands.
                cloth = b > r * 1.12 and g > r * 1.04 and .015 < v < .91
            if cloth:
                result[x, y] = 255
    mask.save(ROOT / f'public/avatars/{name}-clothing-mask.png', optimize=True)
