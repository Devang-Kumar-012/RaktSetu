/**
 * IMAGE ASSET INTEGRITY.
 *
 * A successful `next build` proves nothing about images: the manifest can name
 * files that were never generated and the site still compiles — shipping <img>
 * tags that 404 in the browser. This check closes that gap:
 *
 *   1. the manifest parses and every entry matches the schema in
 *      src/lib/photos.ts;
 *   2. every file it references (poster plus every width of every art-directed
 *      crop, in WebP and JPEG) actually exists under public/;
 *   3. every image slot in src/config/site-images.ts names a known photo id, a
 *      real mask, and a sane focal position;
 *   4. every crop a slot's mask needs at each breakpoint exists in the
 *      manifest for its photo (crop-mismatch detection).
 *
 * An EMPTY manifest is a legitimate state: it means the asset pipeline has not
 * been run because the supplied photographs are not present. Slots then render
 * nothing, no URL 404s, and the check passes with a clear note.
 * Run `npm run build:assets` after placing the originals in
 * assets/raktsetu-source/ to fill it in.
 *
 * Usage:  npm run check:images
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ART_DIRECTION_BY_MASK, SITE_IMAGES } from "../src/config/site-images";
import { PHOTO_IDS, parsePhotoManifest } from "../src/lib/photos";

const ROOT = join(import.meta.dirname, "..");
const PUBLIC_DIR = join(ROOT, "public");
const MANIFEST_PATH = join(PUBLIC_DIR, "images", "raktsetu", "manifest.json");

/** The aspects the pipeline is allowed to emit. */
const KNOWN_ASPECTS = new Set(["square", "portrait", "wide"]);

/** `object-position` values look like "46% 62%". */
const FOCAL_POSITION = /^\d{1,3}% \d{1,3}%$/;

let failures = 0;
let filesVerified = 0;

function fail(message: string): void {
  failures += 1;
  console.error(`  ✗ ${message}`);
}

function main(): void {
  console.log("IMAGE ASSET INTEGRITY\n");

  /* ---- 1. The manifest exists, parses, and matches the schema. ---------- */
  if (!existsSync(MANIFEST_PATH)) {
    fail(`manifest missing at public/images/raktsetu/manifest.json — run \`npm run build:assets\``);
    return finish(0);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`manifest is not valid JSON: ${detail}`);
    return finish(0);
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail("manifest root must be an object keyed by photo id");
    return finish(0);
  }

  const manifest = parsePhotoManifest(raw);
  for (const [id] of Object.entries(raw)) {
    const isKnown = PHOTO_IDS.some((known) => known === id);
    if (!isKnown) {
      fail(`unknown photo id "${id}" in manifest — known ids: ${PHOTO_IDS.join(", ")}`);
    } else if (!(id in manifest)) {
      fail(`photo "${id}" is in the manifest but does not match the schema`);
    }
  }

  /* ---- 2. Every referenced file exists under public/. ------------------- */
  for (const id of PHOTO_IDS) {
    const entry = manifest[id];
    if (!entry) continue;

    const urls: string[] = [entry.poster.webp, entry.poster.jpeg];
    for (const variant of entry.variants) {
      if (!KNOWN_ASPECTS.has(variant.aspect)) {
        fail(`${id}: unknown aspect "${variant.aspect}"`);
      }
      if (variant.sources.some((s) => !s.lqip.startsWith("data:image/"))) {
        fail(`${id}/${variant.aspect}: a source is missing its LQIP data URL`);
      }
      for (const source of variant.sources) {
        urls.push(source.webp, source.jpeg);
      }
    }

    for (const url of urls) {
      if (!url.startsWith("/images/")) {
        fail(`${id}: "${url}" is not a /images/… public URL`);
        continue;
      }
      filesVerified += 1;
      if (!existsSync(join(PUBLIC_DIR, url.slice(1)))) {
        fail(`${id}: referenced file does not exist: ${url}`);
      }
    }
  }

  /* ---- 3 & 4. Slot configuration is coherent with masks and manifest. --- */
  const awaitingPipeline = new Set<string>();
  for (const [name, slot] of Object.entries(SITE_IMAGES)) {
    if (!FOCAL_POSITION.test(slot.focalPosition)) {
      fail(`slot "${name}": focalPosition "${slot.focalPosition}" is not "N% N%"`);
    }
    if (!(slot.mask in ART_DIRECTION_BY_MASK)) {
      fail(`slot "${name}": unknown mask "${slot.mask}"`);
      continue;
    }
    if (!slot.photo) continue;

    const entry = manifest[slot.photo];
    if (!entry) {
      awaitingPipeline.add(slot.photo);
      continue;
    }
    for (const { aspect } of ART_DIRECTION_BY_MASK[slot.mask]) {
      if (!entry.variants.some((v) => v.aspect === aspect)) {
        fail(
          `slot "${name}": photo "${slot.photo}" has no "${aspect}" crop ` +
          `(needed by mask "${slot.mask}")`
        );
      }
    }
  }

  if (awaitingPipeline.size > 0) {
    console.log(
      `  … awaiting build:assets for ${[...awaitingPipeline].join(", ")} — ` +
      "their slots render nothing until the source photographs are supplied"
    );
  }

  finish(Object.keys(manifest).length);
}

function finish(generated: number): void {
  if (failures > 0) {
    console.error(`\n${failures} image-asset problem(s) found.`);
    process.exit(1);
  }
  console.log(
    `\nOK — ${generated}/${PHOTO_IDS.length} photos generated, ` +
    `${filesVerified} referenced files verified present.`
  );
}

main();
