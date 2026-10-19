# RaktSetu image attribution & provenance

These are the two photographs supplied for RaktSetu. They are stored locally and
served by Next.js - nothing is hot-linked, and no placeholder or substitute
photography is used anywhere in the product.

- **IMAGE 1 - donor holding heart** -> `hero-donor` - homepage hero.
- **IMAGE 2 - blood bag in ward** -> `blood-bag` - request page and medical sections.

Every derivative below is generated. Do not hand-edit them: change the focal
points in `scripts/build-photo-assets.ts` and re-run `npm run build:assets`, and
every crop, LQIP and this file stay in sync. Un-cropped originals live in
`assets/raktsetu-source/`.

### `hero-donor`

- **Original:** `assets/raktsetu-source/hero-donor-original.png` (1254x1254 JPEG)
- **Alt text:** Digital illustration of a blood donation network — a donor's arm connected to a collection bag, surrounded by donors, recipients, and blood-type icons
- **Variants:** square (480/720/1080px); portrait (480/720/960/1200px); wide (720/1080px)
- **Poster:** `/images/raktsetu/hero-donor-poster-1200.jpg` (1200x1200)

### `hero-emergency`

- **Original:** `assets/raktsetu-source/hero-emergency-original.png` (1110x900 JPEG)
- **Alt text:** Paramedics rush a patient on a stretcher into an emergency entrance, a blood bag hanging from the drip stand
- **Variants:** square (480/720/1080px); portrait (480/720/960px)
- **Poster:** `/images/raktsetu/hero-emergency-poster-1110.jpg` (1110x900)

## Licence

Supplied by the project owner. Record the licence or photographer credit here if
the source images carry one.
