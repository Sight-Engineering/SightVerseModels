// ============================================================================
//  SIGHT VERSE - CONTENT & LAYOUT
//  Everything a visitor reads lives here. Edit the text, then refresh the page.
//  (The copy below is professional placeholder text - replace it with your own.)
// ============================================================================

export const COMPANY = {
  name: 'Sight Verse',
  legalName: 'Sight Engineering',
  tagline: 'Step inside the built world before it exists.',
  intro:
    'Welcome to our island. Each building is a part of our story - drag to look around, '
    + 'or click a building to step inside.',
};

// Position is in metres on the island (x = east/west, z = south/north), centre of the island is 0,0.
// rotationDeg turns a building around its own vertical axis so its front faces where you want.
export const BUILDINGS = [
  {
    id: 'about',
    model: 'AboutUs',
    footprint: 70,        // largest horizontal size (m) of the optimised model - used to keep trees away
    label: 'About Us',
    kicker: 'Who we are',
    title: 'Engineers with an eye for the story',
    summary:
      'We are a team of engineers, architects and real-time 3D specialists who believe a design '
      + 'should be experienced, not just drawn.',
    sections: [
      {
        heading: 'Our mission',
        body:
          'We turn plans, models and site data into immersive, photorealistic experiences that anyone '
          + 'can explore in a browser - no downloads, no special hardware.',
      },
      {
        heading: 'How we work',
        body:
          'Engineering rigour first, then craft. Every project starts with accurate data and ends with '
          + 'an experience that makes stakeholders say "now I understand".',
      },
    ],
    facts: [
      { value: 'Engineering-led', label: 'Accurate to the source model' },
      { value: 'Real-time', label: 'Explore live, on any device' },
      { value: 'End-to-end', label: 'From survey to interactive delivery' },
    ],
    cta: { label: 'See what we do', goto: 'services' },
    accent: '#7dd3fc',
    position: [-95, -62],
    sink: 2.1,            // metres the model is lowered into the ground (its raised podium becomes a low curb)
    rotationDeg: 90,
	viewDistance: 50,
  },
  {
    id: 'services',
    model: 'Services',
    footprint: 70,
    label: 'Services',
    kicker: 'What we do',
    title: 'From reality capture to real-time delivery',
    summary:
      'A complete pipeline for architecture, engineering and construction teams who want to design, '
      + 'review and sell in 3D.',
    sections: [
      {
        heading: 'Real-time architectural visualisation',
        body: 'Photorealistic walkthroughs and flythroughs built in Unreal Engine and delivered on the web.',
      },
      {
        heading: 'Reality capture & Gaussian splatting',
        body: 'Photogrammetry and radiance-field scans that turn real sites into navigable digital twins.',
      },
      {
        heading: 'Interactive web experiences',
        body: 'Branded 3D tours, configurators and sales tools that load in seconds and run in any browser.',
      },
      {
        heading: 'BIM & digital-twin coordination',
        body: 'Clean, optimised models prepared from your BIM/CAD data for review, presentation and handover.',
      },
    ],
    facts: [
      { value: 'ArchViz', label: 'Stills, films & live tours' },
      { value: 'Scan-to-3D', label: 'Photogrammetry & splats' },
      { value: 'Web 3D', label: 'Zero-install delivery' },
    ],
    cta: { label: 'Start a project', goto: 'contact' },
    accent: '#a7f3d0',
    position: [78, -88],
    sink: 0.5,
    rotationDeg: 180,
	viewDistance: 125,
	viewAngleDeg: 0,
  },
  {
    id: 'clients',
    model: 'Clients',
    footprint: 70,
    label: 'Clients',
    kicker: 'Who we work with',
    title: 'Partners who build the future',
    summary:
      'We collaborate with the people who shape our cities - and help them show their vision with confidence.',
    sections: [
      {
        heading: 'Developers & real-estate',
        body: 'Pre-sale experiences that let buyers walk through a home long before the first brick is laid.',
      },
      {
        heading: 'Architects & design studios',
        body: 'Design-review tools that keep everyone looking at the same, up-to-date model.',
      },
      {
        heading: 'Engineering & construction firms',
        body: 'Progress visualisation and stakeholder presentations grounded in real site data.',
      },
      {
        heading: 'Public sector & institutions',
        body: 'Transparent, easy-to-understand consultations for planning and infrastructure projects.',
      },
    ],
    // Add real client names here, e.g. clients: ['Acme Developments', 'Nordic Studio'] - they appear as tags.
    clients: [],
    facts: [
      { value: 'Long-term', label: 'Partnerships, not one-offs' },
      { value: 'Global', label: 'Remote-friendly delivery' },
    ],
    cta: { label: 'Become a partner', goto: 'contact' },
    accent: '#fcd34d',
    position: [104, 52],
    sink: 1.3,
    rotationDeg: -90,
	viewDistance: 50,
  },
  {
    id: 'contact',
    model: 'Contact',
    footprint: 60,
    label: 'Contact',
    kicker: 'Get in touch',
    title: "Let's build something worth exploring",
    summary: 'Tell us about your project - we usually reply within one business day.',
    sections: [],
    contact: {
      email: 'info@sightrealestate.net',
      phone: '+964 77-172-33332',
      address: 'Iraq, Basra, Casino Lebanon st.',
      hours: 'Sun - Thu, 09:00 - 17:00',
      links: [
        // { label: 'LinkedIn', url: 'https://www.linkedin.com/company/your-company' },
        // { label: 'Instagram', url: 'https://www.instagram.com/your-company' },
      ],
    },
    facts: [],
    cta: null,
    accent: '#f9a8d4',
    position: [-58, 104],
    rotationDeg: 180,
	viewDistance: 50,
  },
];

// ---- island layout -------------------------------------------------------
export const ISLAND = {
  size: 760,            // terrain mesh edge length (m)
  plazaRadius: 30,      // central plaza
  padHeight: 3.0,       // height of the level ground the buildings stand on (m above sea)
  padRadius: 52,        // flat radius around each building before the ground blends back
  spawn: [0, 20],       // where the walker appears the first time
};
