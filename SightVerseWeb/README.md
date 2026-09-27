# Sight Verse - interactive island

A browser experience: four buildings (About Us, Services, Clients, Contact) on a realistic 3D island.
Drag to orbit, switch to Walk mode (W A S D + drag), click a building (or the nav / minimap) to read about it.

## Run

    npm install
    npm run dev        # http://localhost:5173
    npm run build      # static site in dist/  (upload the folder to any web host)
    npm run preview    # test the production build

URL options: `?quality=ultra|high|medium|low`, `?skipintro`, `?debug` (fps overlay).
Graphics quality also adapts automatically if the frame rate drops.

## Edit content

Everything visitors read lives in `src/config.js`: titles, paragraphs, facts, contact details,
accent colours and where each building stands. The copy is placeholder text - replace it.
Client names go in the `clients: []` list of the Clients entry.

## Replace a building model

1. Put the new `.glb` in `../Assets/` (same file name).
2. `node tools/optimize.mjs` - compresses it into `public/models/`.
3. If needed adjust `position`, `rotationDeg`, `sink` (how far the model is lowered into the ground) in `src/config.js`.

## Re-fetch environment assets (only if you delete `public/env`, `public/textures`, `public/models/env`)

    node tools/fetch-assets.mjs && node tools/process-assets.mjs

HDR skies, ground textures, trees and rocks are CC0 from Poly Haven.
