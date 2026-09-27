// Dev helper: node tools/bounds.mjs file.glb ...  -> prints the bounding box size of each GLB
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const b = getBounds(doc.getRoot().listScenes()[0]);
  const s = b.max.map((v, i) => +(v - b.min[i]).toFixed(2));
  console.log(f.split(/[\\/]/).pop(), 'size', s.join(' x '), 'min', b.min.map((v) => +v.toFixed(2)).join(','));
}
