/**
 * PHOTO ASSET PIPELINE — turns the supplied source photographs into the
 * optimized, art-directed set the site actually ships.
 *
 * WHY A SCRIPT INSTEAD OF CHECKING-IN HAND-CROPPED FILES
 *
 * The source frames are fixed originals under `assets/raktsetu-source/`.
 * Every crop the UI needs is a DERIVATIVE of them, and derivatives have to stay in sync: if the hero crop
 * is re-tuned, the tablet crop, the mobile crop and the manifest all have to move
 * with it. Doing that by hand is how a site ends up with three versions of the
 * same crop that disagree about where the donor's hand is. So the focal points
 * live in ONE place (the PHOTOS table below), and every output — including the
 * responsive variants and the attribution manifest — is derived from them.
 *
 * WHAT IT EMITS, per photograph
 *
 *   1. An art-directed set of ASPECT RATIOS (square / portrait / wide). This is
 *      the part `next/image` alone cannot do: `sizes` changes the pixel width it
 *      downloads, but the browser still crops ONE source frame to fit every
 *      viewport. Emitting a real square, a real portrait and a real wide
 *      variant — and switching between them with `<picture>` + `media` — is what
 *      keeps the subject inside the frame on a 360px phone and on a 2560px
 *      ultrawide. A centre-cropped 16:9 of the hero would decapitate the heart.
 *   2. Several WIDTHS per aspect, so small viewports never download desktop
 *      pixels. Emitted as WebP (what the browser gets) with a JPEG fallback for
 *      the `source` that older engines can read.
 *   3. A tiny base64 LQIP per variant, written into the manifest, so the layout
 *      never shifts while the photograph decodes.
 *   4. A poster of the full frame, for pages that want an un-cropped bleed.
 *
 * IDEMPOTENT AND DETERMINISTIC
 *
 * Re-running reproduces output at fixed quality in a fixed order, and prunes
 * variants that are no longer generated, so a stale 1600px file can never linger
 * in `public/`.
 *
 * Usage:  npm run build:assets
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

const ROOT = join(import.meta.dirname, "..");
const SOURCE_DIR = join(ROOT, "assets", "raktsetu-source");
const OUT_DIR = join(ROOT, "public", "images", "raktsetu");

/**
 * THE SOURCE OF TRUTH FOR CROPPING.
 *
 * `focus` is the point the crop is built around, as a fraction of the frame —
 * chosen by looking at each photograph, not guessed:
 *
 *  - hero-donor: the hand holding the red heart. It sits a little left of centre
 *    and low in the frame, with the donor's forearm running off to the right.
 *    Cropping on the heart is what keeps the emotional subject in frame at every
 *    ratio.
 *  - blood-bag: the labelled B+ bag hangs on the LEFT, about a third of the way
 *    across and a third down. The clinical background (bed, staff, the "Donate
 *    Blood Save Lives" sign) sits to the right, so the focus is pulled LEFT and
 *    UP to keep the bag the hero of every crop.
 */
const PHOTOS = [
    {
        id: "hero-donor",
        file: "hero-donor-original.png",
        /** Alt text describes the photograph itself, for screen readers. */
        alt: "Digital illustration of a blood donation network — a donor's arm connected to a collection bag, surrounded by donors, recipients, and blood-type icons",
        focus: { x: 0.5, y: 0.5 },
        poster: { width: 1200 },
        variants: [
            // 1:1 — the organic/circular hero clip. A square keeps the hand and the
            // heart on one optical centre line instead of letting them drift apart.
            { name: "square", ratio: 1 },
            // 4:5 — the tall frame used on phones, where vertical room is cheap and
            // the donor's arm should still read.
            { name: "portrait", ratio: 4 / 5 },
            // 3:2 — the section-level editorial bleed, closest to the source framing.
            { name: "wide", ratio: 3 / 2 },
        ],
    },
    {
        // The glowing drop sits just right of centre, mid-frame.
        id: "hero-network",
        file: "hero-network-original.png",
        alt: "A glowing red blood drop streaking between a laptop, connected screens and a server at dusk",
        focus: { x: 0.58, y: 0.5 },
        poster: { width: 1200 },
        variants: [
            { name: "square", ratio: 1 },
            { name: "portrait", ratio: 4 / 5 },
        ],
    },
    {
        id: "blood-bag",
        file: "blood-bag-original.jpeg",
        alt: "A labelled B+ whole blood bag hanging in a hospital ward beside a patient bed",
        focus: { x: 0.29, y: 0.36 },
        poster: { width: 1200 },
        variants: [
            // 4:5 — the request-page side image: tall, bag-forward, keeping the bed and
            // staff as medical context without the bag leaving the frame.
            { name: "portrait", ratio: 4 / 5 },
            // 1:1 — narrow columns and small accents, where a 4:5 would push the bag
            // label off the top.
            { name: "square", ratio: 1 },
            // 16:9 — full-bleed bands that want atmosphere rather than a subject.
            { name: "wide", ratio: 16 / 9 },
        ],
    },
] as const;

/**
 * Width ladder per aspect.
 *
 * Sized to the largest box each aspect is actually rendered into at 2x, so no
 * viewport downloads pixels it discards. Steps above the source width are dropped
 * by the caller — upscaling past it would only invent detail.
 */
const WIDTHS: Record<string, readonly number[]> = {
    square: [480, 720, 1080, 1440],
    portrait: [480, 720, 960, 1200],
    wide: [720, 1080, 1536],
};

/** WebP does the real work; JPEG is the fallback for engines without it. */
const WEBP_QUALITY = 74;
const JPEG_QUALITY = 78;
/** LQIP is a 20px-wide blur, inlined as a data URL. */
const LQIP_WIDTH = 20;

interface Generated {
    /** Path under `public/`, e.g. `/images/raktsetu/hero-donor-square-720.webp`. */
    webp: string;
    jpeg: string;
    width: number;
    height: number;
    lqip: string;
}
/** Read the previous manifest so skipped photos keep their entries. */
function loadManifest(path: string): ManifestEntries {
    try {
        return JSON.parse(readFileSync(path, "utf8")) as ManifestEntries;
    } catch {
        return {};
    }
}

/**
 * Crop a source frame to `ratio`, positioned around `focus`.
 *
 * The maths is the important part. Given a focus point in frame fractions, the
 * largest rectangle of the target ratio that fits the source is positioned so the
 * focus lands dead centre, then clamped so it can never leave the frame. A plain
 * centre crop would be simpler and wrong: the heart sits below centre and the
 * blood bag left of centre, so centring would push the subject toward — and at
 * narrower aspects eventually past — the edge.
 */
function cropGeometry(
    src: { width: number; height: number },
    ratio: number,
    focus: { x: number; y: number }
) {
    const { width: sw, height: sh } = src;

    // Largest rectangle of this ratio that fits inside the source.
    let width = sw;
    let height = width / ratio;
    if (height > sh) {
        height = sh;
        width = height * ratio;
    }
    width = Math.floor(width);
    height = Math.floor(height);


    // Centre the crop on the focus point, then clamp it inside the frame.
    const left = Math.round(Math.min(Math.max(focus.x * sw - width / 2, 0), sw - width));
    const top = Math.round(Math.min(Math.max(focus.y * sh - height / 2, 0), sh - height));

    return { left, top, width, height };
}
/** One crop's entry in the generated manifest. */
interface ManifestVariant {
    aspect: string;
    ratio: number;
    intrinsic: { width: number; height: number };
    sources: Array<{ webp: string; jpeg: string; width: number; height: number; lqip: string }>;
}

/** One photograph's entry in the generated manifest. */
interface ManifestEntry {
    alt: string;
    source: { width: number; height: number; original: string };
    poster: { webp: string; jpeg: string; width: number; height: number };
    variants: ManifestVariant[];
}

type ManifestEntries = Record<string, ManifestEntry>;

async function build() {
    // Fail early — and clearly — when the supplied photographs are absent:
    // every output below is a DERIVATIVE of them, so there is nothing to crop.
    const missingSources = PHOTOS.filter((photo) => !existsSync(join(SOURCE_DIR, photo.file)));
    if (missingSources.length === PHOTOS.length) {
        console.error("Missing source photographs in assets/raktsetu-source/:");
        for (const photo of missingSources) {
            console.error(`  - assets/raktsetu-source/${photo.file}`);
        }
        console.error(
            "\nPlace the original 1536x1024 photographs there and re-run `npm run build:assets`.\n" +
            "Until then the site renders branded placeholders inside every image mask and the\n" +
            "manifest stays empty — see README, section “Photography assets”."
        );
        process.exit(1);
    }
    const skippedIds: Set<string> = new Set(missingSources.map((photo) => photo.id));
    for (const photo of missingSources) {
        console.warn(
            `  ! skipping "${photo.id}" — source "assets/raktsetu-source/${photo.file}" not found; ` +
                `its slots keep their placeholders. Add the file and re-run \`npm run build:assets\`.`
        );
    }
    // Preserve previously generated entries for skipped photos, so adding one
    // new source never wipes an already-built photo from the manifest or disk.
    const priorManifest = loadManifest(join(OUT_DIR, "manifest.json"));
    mkdirSync(OUT_DIR, { recursive: true });

    /** Everything written this run, so stale files can be pruned at the end. */
    // Preserve previously generated entries for skipped photos, so adding one
    // new source never wipes an already-built photo from the manifest or disk.
    const written = new Set<string>();
    const manifest: ManifestEntries = {};

    for (const photo of PHOTOS) {
        if (skippedIds.has(photo.id)) continue;
        const image = sharp(join(SOURCE_DIR, photo.file), { failOn: "none" }).rotate();
        const meta = await image.metadata();
        const src = { width: meta.width ?? 0, height: meta.height ?? 0 };
        if (!src.width || !src.height) {
            throw new Error(`${photo.file}: could not read image dimensions`);
        }
        console.log(
            `\n${photo.id} — source ${src.width}x${src.height}` +
            `  focus ${(photo.focus.x * 100).toFixed(0)}%/${(photo.focus.y * 100).toFixed(0)}%`
        );

        const variants: ManifestVariant[] = [];

        for (const variant of photo.variants) {
            const ratio = variant.ratio;
            const ladder = WIDTHS[variant.name] ?? WIDTHS.square;
            // Never upscale: drop rungs wider than the source, but always keep at least
            // one so a variant can never end up with an empty `sources` list.
            const steps = ladder.filter((w) => w <= src.width);
            const widths = steps.length ? steps : [Math.min(ladder[0], src.width)];

            const geom = cropGeometry(src, ratio, photo.focus);
            const sources: Generated[] = [];

            for (const targetWidth of widths) {
                // Height is derived from the emitted width so the aspect is EXACT. A
                // rounding drift here is what makes `object-cover` letterbox a hairline
                // of background on a 16:9 band.
                const resizedHeight = Math.max(1, Math.round(targetWidth / ratio));

                const base = image
                    .clone()
                    .extract(geom)
                    .resize({
                        width: targetWidth,
                        height: resizedHeight,
                        fit: "fill", // aspect is already exact — never crop or stretch here
                        kernel: "lanczos3",
                    });

                const webpName = `${photo.id}-${variant.name}-${targetWidth}.webp`;
                const jpegName = `${photo.id}-${variant.name}-${targetWidth}.jpg`;
                await base.clone().webp({ quality: WEBP_QUALITY, effort: 6 }).toFile(join(OUT_DIR, webpName));
                await base
                    .clone()
                    .jpeg({ quality: JPEG_QUALITY, progressive: true, mozjpeg: true })
                    .toFile(join(OUT_DIR, jpegName));
                written.add(webpName);
                written.add(jpegName);

                // LQIP: same crop, tiny, inlined so the hero has a real blur-up.
                const lqip = await base
                    .clone()
                    .resize({ width: LQIP_WIDTH })
                    .blur(1.2)
                    .webp({ quality: 40 })
                    .toBuffer();

                sources.push({
                    webp: `/images/raktsetu/${webpName}`,
                    jpeg: `/images/raktsetu/${jpegName}`,
                    width: targetWidth,
                    height: resizedHeight,
                    lqip: `data:image/webp;base64,${lqip.toString("base64")}`,
                });
            }

            const largest = sources[sources.length - 1];
            variants.push({
                aspect: variant.name,
                ratio,
                intrinsic: { width: largest.width, height: largest.height },
                sources,
            });
            console.log(
                `  ${variant.name.padEnd(8)} ${geom.width}x${geom.height} @ ${geom.left},${geom.top}` +
                `  ->  ${widths.join(", ")}`
            );
        }

        // Un-cropped editorial poster of the whole frame, in both formats.
        const posterWidth = Math.min(photo.poster.width, src.width);
        const posterBase = `${photo.id}-poster-${posterWidth}`;
        const posterJpeg = `${posterBase}.jpg`;
        const posterWebp = `${posterBase}.webp`;
        const poster = image
            .clone()
            .resize({ width: posterWidth, fit: "inside" });
        // Encoded once per format from the same resize, so the JPEG fallback and the
        // WebP are pixel-identical apart from compression.
        const posterJpegBuf = await poster
            .clone()
            .jpeg({ quality: JPEG_QUALITY, progressive: true, mozjpeg: true })
            .toBuffer();
        await poster
            .clone()
            .webp({ quality: WEBP_QUALITY, effort: 6 })
            .toFile(join(OUT_DIR, posterWebp));
        writeFileSync(join(OUT_DIR, posterJpeg), posterJpegBuf);
        written.add(posterJpeg);
        written.add(posterWebp);
        const posterMeta = await sharp(posterJpegBuf).metadata();
        console.log(`  poster   ${posterWidth}x${posterMeta.height}  ->  ${posterBase}.{webp,jpg}`);

        manifest[photo.id] = {
            alt: photo.alt,
            source: {
                width: src.width,
                height: src.height,
                original: `assets/raktsetu-source/${photo.file}`,
            },
            poster: {
                webp: `/images/raktsetu/${posterWebp}`,
                jpeg: `/images/raktsetu/${posterJpeg}`,
                width: posterWidth,
                height: posterMeta.height ?? 0,
            },
            variants,
        };
    }

    // Merge back skipped photos' prior entries (and shield their files from
    // pruning), so adding one new source never wipes an already-built photo.
    for (const [id, entry] of Object.entries(priorManifest)) {
        if (skippedIds.has(id) && !manifest[id]) manifest[id] = entry;
    }
    for (const entry of Object.values(manifest)) {
        if (!entry) continue;
        for (const url of [entry.poster.webp, entry.poster.jpeg]) {
            const base = url.split("/").pop();
            if (base) written.add(base);
        }
        for (const variant of entry.variants) {
            for (const source of variant.sources) {
                for (const url of [source.webp, source.jpeg]) {
                    const base = url.split("/").pop();
                    if (base) written.add(base);
                }
            }
        }
    }

    // Prune anything this run did not produce, so retired crops cannot linger.
    let pruned = 0;
    for (const name of readdirSync(OUT_DIR)) {
        if (name.endsWith(".json") || name.endsWith(".md") || written.has(name)) continue;
        rmSync(join(OUT_DIR, name));
        pruned += 1;
    }

    writeFileSync(join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    // A readable companion to the machine-readable manifest, for auditing.
    writeFileSync(join(OUT_DIR, "ATTRIBUTION.md"), attributionDoc(manifest));

    console.log(`\nwrote ${written.size} files, pruned ${pruned} stale`);
    console.log(`manifest: public/images/raktsetu/manifest.json\n`);
}

function attributionDoc(manifest: ManifestEntries): string {
    const rows = Object.entries(manifest)
        .map(([id, m]) =>
            [
                `### \`${id}\``,
                "",
                `- **Original:** \`${m.source.original}\` (${m.source.width}x${m.source.height} JPEG)`,
                `- **Alt text:** ${m.alt}`,
                `- **Variants:** ${m.variants
                    .map((v) => `${v.aspect} (${v.sources.map((s) => s.width).join("/")}px)`)
                    .join("; ")}`,
                `- **Poster:** \`${m.poster.jpeg}\` (${m.poster.width}x${m.poster.height})`,
                "",
            ].join("\n")
        )
        .join("\n");

    return [
        "# RaktSetu image attribution & provenance",
        "",
        "These are the two photographs supplied for RaktSetu. They are stored locally and",
        "served by Next.js - nothing is hot-linked, and no placeholder or substitute",
        "photography is used anywhere in the product.",
        "",
        "- **IMAGE 1 - donor holding heart** -> `hero-donor` - homepage hero.",
        "- **IMAGE 2 - blood bag in ward** -> `blood-bag` - request page and medical sections.",
        "",
        "Every derivative below is generated. Do not hand-edit them: change the focal",
        "points in `scripts/build-photo-assets.ts` and re-run `npm run build:assets`, and",
        "every crop, LQIP and this file stay in sync. Un-cropped originals live in",
        "`assets/raktsetu-source/`.",
        "",
        rows,
        "## Licence",
        "",
        "Supplied by the project owner. Record the licence or photographer credit here if",
        "the source images carry one.",
        "",
    ].join("\n");
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});

