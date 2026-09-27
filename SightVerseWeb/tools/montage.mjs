// Dev helper: node tools/montage.mjs out.png in1 in2 ...  -> contact sheet (each tile 400px)
import sharp from 'sharp';
const [out, ...ins] = process.argv.slice(2);
const T = 400;
const tiles = await Promise.all(ins.map((f) => sharp(f).resize(T, T, { fit: 'cover' }).png().toBuffer()));
await sharp({ create: { width: T * Math.min(3, tiles.length), height: T * Math.ceil(tiles.length / 3), channels: 3, background: '#222' } })
  .composite(tiles.map((input, i) => ({ input, left: (i % 3) * T, top: Math.floor(i / 3) * T })))
  .png().toFile(out);
console.log('ok', out);
