#!/usr/bin/env node
/**
 * Builds the committed test-set manifest (manifest.json) from COCO val2017 annotations.
 * Images are NOT committed: fetch-images.mjs downloads them into .cache/images/ (gitignored).
 *
 * Inputs (download once, see README.md):
 *   .cache/coco/instances_val2017.json, .cache/coco/person_keypoints_val2017.json
 *
 * Selection is deterministic (sorted by image id, then a fixed stride), so the manifest is reproducible.
 * Subsets (ground truth from COCO annotations):
 *   phone_pos    largest person ≥ 10 % of image AND ≥ 1 non-crowd "cell phone" box ≥ 0.15 % of image
 *   phone_neg    largest person ≥ 10 %, NO "cell phone" annotation at all (incl. crowd); half of them
 *                contain a "remote"/"laptop"/"keyboard"/"book" (hard negatives)
 *   pets         cat or dog box ≥ 5 %, NO person annotation (presence must be ABSENT/UNCERTAIN, never PRESENT)
 *   person_upper largest person ≥ 15 %, both shoulders keypoint-labelled VISIBLE (v=2) (presence should be PRESENT)
 *   face_hidden  largest person ≥ 15 %, shoulders labelled (v≥1), nose and both eyes NOT labelled (v=0):
 *                back of head / head turned or bowed away — proxy for "head-down writing" (should be PRESENT)
 *   empty        no person / cat / dog / other animal; contains chair, couch, bed, dining table, tv, laptop or
 *                book (indoor, nobody there; presence should be ABSENT)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const COCO = join(HERE, '.cache', 'coco');
const inst = JSON.parse(readFileSync(join(COCO, 'instances_val2017.json'), 'utf8'));
const kp = JSON.parse(readFileSync(join(COCO, 'person_keypoints_val2017.json'), 'utf8'));

const CAT = Object.fromEntries(inst.categories.map((c) => [c.name, c.id]));
const NAME = Object.fromEntries(inst.categories.map((c) => [c.id, c.name]));
const ANIMALS = new Set(['bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'teddy bear'].map((n) => CAT[n]));
const INDOOR = new Set(['chair', 'couch', 'bed', 'dining table', 'tv', 'laptop', 'book'].map((n) => CAT[n]));
const HARD_NEG = new Set(['remote', 'laptop', 'keyboard', 'book', 'mouse'].map((n) => CAT[n]));
const LICENSES = Object.fromEntries(inst.licenses.map((l) => [l.id, { name: l.name, url: l.url }]));

const ann = new Map();
for (const a of inst.annotations) {
  if (!ann.has(a.image_id)) ann.set(a.image_id, []);
  ann.get(a.image_id).push(a);
}
const kpByImg = new Map();
for (const a of kp.annotations) {
  if (!kpByImg.has(a.image_id)) kpByImg.set(a.image_id, []);
  kpByImg.get(a.image_id).push(a);
}

const images = [...inst.images].sort((a, b) => a.id - b.id);
const subsets = { phone_pos: [], phone_neg: [], phone_neg_hard: [], pets: [], person_upper: [], face_hidden: [], empty: [] };

for (const im of images) {
  const A = im.width * im.height;
  const an = ann.get(im.id) ?? [];
  const persons = an.filter((a) => a.category_id === CAT.person);
  const phones = an.filter((a) => a.category_id === CAT['cell phone']);
  const maxPerson = persons.length ? Math.max(...persons.map((p) => p.area)) / A : 0;
  const goodPhones = phones.filter((p) => !p.iscrowd && p.area / A >= 0.0015);
  const animals = an.filter((a) => ANIMALS.has(a.category_id));
  const catDog = an.filter((a) => (a.category_id === CAT.cat || a.category_id === CAT.dog) && a.area / A >= 0.05);

  if (maxPerson >= 0.1 && goodPhones.length) subsets.phone_pos.push(im);
  else if (maxPerson >= 0.1 && phones.length === 0) {
    if (an.some((a) => HARD_NEG.has(a.category_id))) subsets.phone_neg_hard.push(im);
    else subsets.phone_neg.push(im);
  }
  if (persons.length === 0 && catDog.length) subsets.pets.push(im);
  if (persons.length === 0 && animals.length === 0 && an.some((a) => INDOOR.has(a.category_id))) subsets.empty.push(im);

  if (maxPerson >= 0.15) {
    const big = (kpByImg.get(im.id) ?? []).reduce((b, a) => (!b || a.area > b.area ? a : b), null);
    if (big && big.area / A >= 0.15) {
      const v = (i) => big.keypoints[i * 3 + 2]; // COCO: 0 nose,1 l-eye,2 r-eye,5 l-shoulder,6 r-shoulder
      if (v(5) === 2 && v(6) === 2 && (v(0) === 2 || v(1) === 2 || v(2) === 2)) subsets.person_upper.push(im);
      else if (v(5) >= 1 && v(6) >= 1 && v(0) === 0 && v(1) === 0 && v(2) === 0) subsets.face_hidden.push(im);
    }
  }
}

/** Deterministic spread sample of n items. */
const pick = (arr, n) => (arr.length <= n ? arr : Array.from({ length: n }, (_, i) => arr[Math.floor((i * arr.length) / n)]));

const counts = Object.fromEntries(Object.entries(subsets).map(([k, v]) => [k, v.length]));
const chosen = {
  phone_pos: pick(subsets.phone_pos, 200),
  phone_neg: [...pick(subsets.phone_neg, 75), ...pick(subsets.phone_neg_hard, 75)],
  pets: pick(subsets.pets, 100),
  person_upper: pick(subsets.person_upper, 100),
  face_hidden: pick(subsets.face_hidden, 60),
  empty: pick(subsets.empty, 60),
};

const entries = [];
for (const [subset, list] of Object.entries(chosen)) {
  for (const im of list) {
    const an = ann.get(im.id) ?? [];
    const A = im.width * im.height;
    const area = (id) => Math.max(0, ...an.filter((a) => a.category_id === id).map((a) => a.area)) / A;
    entries.push({
      subset,
      id: im.id,
      file: im.file_name,
      width: im.width,
      height: im.height,
      cocoUrl: im.coco_url,
      flickrUrl: im.flickr_url,
      license: im.license,
      gt: {
        person: an.some((a) => a.category_id === CAT.person),
        phone: an.some((a) => a.category_id === CAT['cell phone']),
        pet: an.some((a) => a.category_id === CAT.cat || a.category_id === CAT.dog),
        maxPersonArea: +area(CAT.person).toFixed(4),
        maxPhoneArea: +area(CAT['cell phone']).toFixed(5),
        hardNegative: subset === 'phone_neg' && an.some((a) => HARD_NEG.has(a.category_id)),
        categories: [...new Set(an.map((a) => NAME[a.category_id]))].sort(),
      },
    });
  }
}

const manifest = {
  source: 'COCO 2017 val (https://cocodataset.org), annotations CC BY 4.0 (COCO Consortium); images are Flickr photos under the per-image licenses below',
  generatedBy: 'frontend/bench/vision/build-manifest.mjs',
  licenses: LICENSES,
  candidateCounts: counts,
  note: 'Images are downloaded into .cache/images/ by fetch-images.mjs and never committed. Ground truth = COCO annotations (may miss small/occluded objects).',
  entries,
};
// One entry per line: compact but diff-friendly.
const { entries: list, ...head } = manifest;
const headJson = JSON.stringify(head, null, 1).replace(/\n}$/, '');
writeFileSync(join(HERE, 'manifest.json'), `${headJson},\n "entries": [\n${list.map((e) => '  ' + JSON.stringify(e)).join(',\n')}\n ]\n}\n`);
console.log('candidates', counts);
console.log('selected', Object.fromEntries(Object.entries(chosen).map(([k, v]) => [k, v.length])), 'total', entries.length);
