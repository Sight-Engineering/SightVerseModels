// Renders the Sight logo into PNG app icons (public/icons/) with sharp.
import sharp from 'sharp';
import fs from 'node:fs';

const PATH = 'M260 0H1037V298L813 130 382 555V813L0 548V260ZM654 288 1037 552V840L776 1102H0V802L222 971 654 546Z';
const NAVY = '#1b365d';
fs.mkdirSync('public/icons', { recursive: true });

// logoFrac = how much of the square the logo's height fills (maskable icons need a safe zone)
async function icon(file, size, logoFrac, bg = '#ffffff') {
  const h = size * logoFrac, w = h * (1037 / 1102);
  const x = (size - w) / 2, y = (size - h) / 2, s = h / 1102;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="100%" height="100%" fill="${bg}"/>
    <g transform="translate(${x} ${y}) scale(${s})"><path fill="${NAVY}" d="${PATH}"/></g></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(`public/icons/${file}`);
  console.log('wrote', file);
}

await icon('icon-192.png', 192, 0.68);
await icon('icon-512.png', 512, 0.68);
await icon('maskable-512.png', 512, 0.5);
await icon('apple-touch-icon.png', 180, 0.66);
