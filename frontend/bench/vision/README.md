# Vision benchmark (owner: W1)

Reproducible, offline-after-download benchmark for the in-browser vision pipeline. Nothing in
`.cache/` is committed (gitignored): COCO annotations, downloaded images, candidate models, results.

```bash
cd frontend/bench/vision
# 1. COCO val2017 annotations (252 MB zip, keep only two JSONs)
mkdir -p .cache/coco && curl -o .cache/coco/ann.zip http://images.cocodataset.org/annotations/annotations_trainval2017.zip
unzip -j .cache/coco/ann.zip annotations/instances_val2017.json annotations/person_keypoints_val2017.json -d .cache/coco && rm .cache/coco/ann.zip
node build-manifest.mjs        # → manifest.json (committed; deterministic)
node fetch-images.mjs          # → .cache/images/*.jpg (≈ 72 MB)
```

`manifest.json` lists every image with its COCO id, Flickr URL, license id (table in `licenses`) and
the ground truth derived from COCO annotations. See `RESULTS.md` for the test-set limits.
