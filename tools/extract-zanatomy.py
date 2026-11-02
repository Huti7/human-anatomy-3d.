"""Extract the Z-Anatomy muscles (face, deep back, abdominal wall, fascia) that BodyParts3D lacks,
and place them in the coordinate frame of the male reference body used by this site.

Source: the Z-Anatomy meshes (CC BY-SA 4.0, Gauthier Kervyn) as already aligned to BodyParts3D by
the BodyExplorer project (https://github.com/JohanBellander/BodyExplorer, public/anatomy.glb).

    python3 -I extract-zanatomy.py BodyExplorer/public/anatomy.glb BodyExplorer/public/mesh_mapping.json ../model/male.json OUT_DIR

Writes OUT_DIR/zanatomy.json + OUT_DIR/zanatomy.bin, which convert-atlas.mjs merges into the male body.
The frame is fitted on the BodyParts3D muscles that both files share: millimetres -> metres,
Z-up -> Y-up, plus a translation (median over all shared muscles).
"""
import json, struct, sys, os
import numpy as np

glb_path, mapping_path, manifest_path, out_dir = sys.argv[1:5]
raw = open(glb_path, 'rb').read()
jlen = struct.unpack('<I', raw[12:16])[0]
gltf = json.loads(raw[20:20 + jlen])
binary = raw[20 + jlen + 8:]

def accessor(i):
    a = gltf['accessors'][i]; view = gltf['bufferViews'][a['bufferView']]
    comps = {'SCALAR': 1, 'VEC3': 3}[a['type']]
    dtype = {5123: np.uint16, 5125: np.uint32, 5126: np.float32}[a['componentType']]
    start = view.get('byteOffset', 0) + a.get('byteOffset', 0)
    arr = np.frombuffer(binary, dtype, a['count'] * comps, start)
    return arr.reshape(-1, comps) if comps > 1 else arr

def to_site(p):  # mm, Z-up  ->  m, Y-up (before translation)
    return np.stack([p[:, 0], p[:, 2], -p[:, 1]], axis=1) / 1000.0

mapping = json.load(open(mapping_path))
site = {p['name'].lower(): p for p in json.load(open(manifest_path))['parts']}
mesh_by_name = {gltf['nodes'][i]['name']: gltf['nodes'][i]['mesh'] for i in range(len(gltf['nodes'])) if 'mesh' in gltf['nodes'][i]}

offsets = []
for m in mapping:
    if m['source'] != 'bp3d' or m['name'].lower() not in site: continue
    pos = to_site(accessor(gltf['meshes'][mesh_by_name[m['name']]]['primitives'][0]['attributes']['POSITION']).astype(np.float64))
    p = site[m['name'].lower()]
    offsets.append((np.array(p['b'][0]) + np.array(p['b'][1])) / 2 - (pos.min(0) + pos.max(0)) / 2)
t = np.median(np.array(offsets), axis=0)
print('shared muscles', len(offsets), 'translation', np.round(t, 4))

SKIP = {'iliotibial tract'}  # already in the reference body
parts, chunks, off = [], [], 0
for m in mapping:
    if m['source'] == 'bp3d': continue
    base = m['name'].replace('left ', '').replace('right ', '')
    if base in SKIP: continue
    prim = gltf['meshes'][mesh_by_name[m['name']]]['primitives'][0]
    pos = (to_site(accessor(prim['attributes']['POSITION']).astype(np.float64)) + t).astype(np.float32)
    nor = accessor(prim['attributes']['NORMAL']).astype(np.float64)
    nor = np.stack([nor[:, 0], nor[:, 2], -nor[:, 1]], axis=1)
    nor /= np.maximum(np.linalg.norm(nor, axis=1, keepdims=True), 1e-9)
    nor16 = np.round(nor * 32767).astype(np.int16)
    idx = accessor(prim['indices']).astype(np.uint32)
    name = m['name'][0].upper() + m['name'][1:]
    entry = {'id': 'ZA:' + m['name'], 'name': name, 'conceptId': '', 'system': 'fascia' if 'fascia' in name else 'muscular',
             'vertexCount': int(len(pos)), 'indexCount': int(len(idx)),
             'bounds': [pos.min(0).astype(float).round(5).tolist(), pos.max(0).astype(float).round(5).tolist()]}
    for key, arr in (('positions', pos), ('normals', nor16), ('indices', idx)):
        b = arr.tobytes(); entry[key] = off; chunks.append(b); off += len(b)
        pad = (-len(b)) % 4
        if pad: chunks.append(b'\0' * pad); off += pad
    parts.append(entry)
os.makedirs(out_dir, exist_ok=True)
open(os.path.join(out_dir, 'zanatomy.bin'), 'wb').write(b''.join(chunks))
json.dump({'source': 'Z-Anatomy', 'license': 'CC BY-SA 4.0', 'parts': parts}, open(os.path.join(out_dir, 'zanatomy.json'), 'w'))
print('wrote', len(parts), 'structures,', off // 1024, 'KB')
