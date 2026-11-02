# Anatomica 3D

An interactive 3D human anatomy website with a beige theme. Explore a male and a female reference body system by system, click any structure to learn about it, and browse every structure piece by piece.

**Live site:** https://huti7.github.io/human-anatomy-3d./ (republished automatically from `main`)

## Systems

| System | Male structures | Female structures |
| --- | ---: | ---: |
| Skin | 2 | 7 |
| Bones & cartilage | 280 | 245 |
| Muscles, tendons & fascia | 482 | 92 |
| Nervous system (brain, nerves, sense organs) | 184 | 362 |
| Joints & ligaments | 35 | 76 |
| Heart & vessels | 1,071 | 124 |
| Lymphatic system | 3 | 14 |
| Internal organs | 238 | 292 |

The male body is **BodyParts3D 4.0**, a whole-body scientific reference built from MRI, with the face, deep back and abdominal-wall muscles it lacks added from **Z-Anatomy** (CC BY-SA 4.0). The female body is the **Human Reference Atlas** female, which has whole-body skin, a detailed brain and organs, but no muscles above the hips; its skull, rib, arm and foot bones are taken from the male body and shown in grey. Both are explained in [ATTRIBUTION.md](ATTRIBUTION.md).

## Features
- **3D Body Explorer**: scroll or pinch zooms toward the spot under the pointer, double-click flies to a structure; turn each system on or off from the sidebar, switch between the male and female body, X-ray mode, zoom and view buttons, and search every structure by name.
- **Click any structure**: a panel slides in from the left with its name, side, identifier, a description and key facts. You can zoom to it, show only that structure, or open it in the Atlas.
- **Parts Atlas**: every structure of a system shown on its own. Selecting one slides in a 3D view from the right that shows it inside its whole system only (for example a bone inside the full skeleton, with no muscles).

## Run locally
The site is static. Serve the folder with any web server (ES modules need `http://`):

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Rebuilding the model files
`model/` holds one compressed file per system and body. They are made from the browser-ready meshes of the open-source [Human Atlas](https://github.com/slorksmo/human-atlas) project:

```bash
git clone --depth 1 https://github.com/slorksmo/human-atlas
git clone --depth 1 https://github.com/JohanBellander/BodyExplorer
python3 -I tools/extract-zanatomy.py BodyExplorer/public/anatomy.glb BodyExplorer/public/mesh_mapping.json model/male.json /tmp/za
cd tools && npm install && node convert-atlas.mjs ../human-atlas/public/models /tmp/za
```

(`extract-zanatomy.py` reads `model/male.json` for alignment, so run it before rebuilding, against the current file.)

## Files
- `index.html`, `css/style.css`: page layout and theme
- `js/app.js`: viewer, systems sidebar, picking, info panel, Parts Atlas and full-body view
- `js/data.js`: extra facts for well-known structures
- `js/explanations.js`: structure descriptions from Human Atlas (MIT)
- `model/`: the compressed anatomy, one file per system
- `tools/convert-atlas.mjs`: builds `model/` from the source meshes (with the classification fixes)
- `tools/extract-zanatomy.py`: extracts and aligns the Z-Anatomy muscles
- `lib/`: three.js, three-mesh-bvh and the meshoptimizer decoder

This is an educational explorer, not a clinical tool.
