// Converts the BodyParts3D (male) and Human Reference Atlas (female) reference bodies, as packaged by
// the open-source Human Atlas project (https://github.com/slorksmo/human-atlas, public/models),
// into one compressed file per anatomical system for this site.
//
//   node convert-atlas.mjs /path/to/human-atlas/public/models
//
// Output: ../model/<sex>.json (manifest) and ../model/<sex>-<layer>.bin (meshoptimizer-encoded geometry).
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { MeshoptEncoder } from 'meshoptimizer';

const SRC = process.argv[2];
if (!SRC) { console.error('usage: node convert-atlas.mjs <human-atlas/public/models>'); process.exit(1); }
await MeshoptEncoder.ready;

// source systems -> the systems shown in the interface
export const LAYER_OF = {
  integumentary: 'skin',
  skeletal: 'bones', borrowed: 'bones',
  muscular: 'muscles', 'donor-muscle': 'muscles',
  nervous: 'nerves', brain: 'nerves', sensory: 'nerves',
  connective: 'joints',
  cardiac: 'vessels', arterial: 'vessels', venous: 'vessels',
  lymphatic: 'lymph',
  respiratory: 'organs', digestive: 'organs', urinary: 'organs', endocrine: 'organs', reproductive: 'organs',
};
const LAYERS = ['skin', 'bones', 'muscles', 'nerves', 'joints', 'vessels', 'lymph', 'organs'];
const OUT = new URL('../model/', import.meta.url);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const [sex, manifestName, chunkPrefix] of [['male', 'atlas.json', 'body'], ['female', 'atlas-female.json', 'female']]) {
  const atlas = JSON.parse(readFileSync(`${SRC}/${manifestName}`, 'utf8'));
  const chunks = atlas.chunks.map((_, i) => readFileSync(`${SRC}/${chunkPrefix}-${i}.bin`));
  const out = { sex, source: atlas.source, version: atlas.version, scope: atlas.scope, layers: {}, parts: [] };
  for (const layer of LAYERS) {
    const parts = atlas.parts.filter((p) => LAYER_OF[p.system] === layer);
    if (!parts.length) continue;
    let nv = 0, ni = 0;
    parts.forEach((p) => { nv += p.vertexCount; ni += p.indexCount; });
    const pos = new Float32Array(nv * 3), nor = new Int8Array(nv * 4), idx = new Uint32Array(ni);
    let v = 0, i = 0;
    for (const p of parts) {
      const buf = chunks[p.chunk];
      const P = new Float32Array(buf.buffer, buf.byteOffset + p.positions, p.vertexCount * 3);
      const N = new Int16Array(buf.buffer, buf.byteOffset + p.normals, p.vertexCount * 3);
      const I = new Uint32Array(buf.buffer, buf.byteOffset + p.indices, p.indexCount);
      pos.set(P, v * 3);
      for (let k = 0; k < p.vertexCount; k++) for (let a = 0; a < 3; a++) nor[(v + k) * 4 + a] = Math.round((N[k * 3 + a] / 32767) * 127);
      for (let k = 0; k < p.indexCount; k++) idx[i + k] = I[k] + v;
      out.parts.push({
        id: p.id, fma: p.conceptId, name: p.name, layer, system: p.system,
        v: [v, p.vertexCount], i: [i, p.indexCount],
        b: p.bounds.map((c) => c.map((x) => +x.toFixed(4))),
      });
      v += p.vertexCount; i += p.indexCount;
    }
    // quantise positions to 16 bits inside the layer's bounding box
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < nv * 3; k++) { const a = k % 3; if (pos[k] < min[a]) min[a] = pos[k]; if (pos[k] > max[a]) max[a] = pos[k]; }
    const scale = [0, 1, 2].map((a) => Math.max(max[a] - min[a], 1e-6));
    const q = new Uint16Array(nv * 4);
    for (let k = 0; k < nv; k++) for (let a = 0; a < 3; a++) q[k * 4 + a] = Math.round(((pos[k * 3 + a] - min[a]) / scale[a]) * 65535);
    const vb = MeshoptEncoder.encodeVertexBuffer(new Uint8Array(q.buffer), nv, 8);
    const nb = MeshoptEncoder.encodeVertexBuffer(new Uint8Array(nor.buffer), nv, 4);
    const ib = MeshoptEncoder.encodeIndexBuffer(new Uint8Array(idx.buffer), ni, 4);
    const file = `${sex}-${layer}.bin`;
    const bin = new Uint8Array(vb.length + nb.length + ib.length);
    bin.set(vb, 0); bin.set(nb, vb.length); bin.set(ib, vb.length + nb.length);
    writeFileSync(new URL(file, OUT), bin);
    out.layers[layer] = {
      file, bytes: bin.length, vertexCount: nv, indexCount: ni, structures: parts.length,
      min: min.map((x) => +x.toFixed(6)), scale: scale.map((x) => +x.toFixed(6)),
      vb: [0, vb.length], nb: [vb.length, nb.length], ib: [vb.length + nb.length, ib.length],
    };
    console.log(`${sex} ${layer}: ${parts.length} structures, ${(ni / 3 / 1000).toFixed(0)}k triangles, ${(bin.length / 1048576).toFixed(2)} MB`);
  }
  if (atlas.borrowed) out.borrowed = true;
  writeFileSync(new URL(`${sex}.json`, OUT), JSON.stringify(out));
}
