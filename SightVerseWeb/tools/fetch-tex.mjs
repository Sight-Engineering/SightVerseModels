// Dev helper: node tools/fetch-tex.mjs id1 id2 ...   -> downloads Diffuse + nor_gl (1k jpg) into _raw/tex/<id>/
import fs from 'node:fs';
import path from 'node:path';
for (const id of process.argv.slice(2)) {
  try {
    const f = await (await fetch('https://api.polyhaven.com/files/' + id)).json();
    for (const map of ['Diffuse', 'nor_gl']) {
      const e = f[map]?.['1k']?.jpg;
      if (!e) { console.log('no', map, id); continue; }
      const dest = path.join('_raw', 'tex', id, map + '.jpg');
      if (fs.existsSync(dest)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(await (await fetch(e.url)).arrayBuffer()));
    }
    console.log('ok', id);
  } catch (e) { console.log('fail', id, e.message); }
}
