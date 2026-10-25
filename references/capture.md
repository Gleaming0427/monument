# Capture: from photographs to centimetres

The model is built from sources and photographs and is good to decimetres where a photograph has been fitted, to metres where only a figure is documented. A centimetre is a different kind of claim: it needs a **capture** of the building (photogrammetry, laser, gaussian splats) and **control** (points whose position is known independently). This page says what the literature supports, how to capture and align one, and what the skill may then claim. Everything below was read in October 2026; each figure names its source, and a figure that only one source gave is marked.

## What a centimetre costs

| Class | What stands behind it | Typical error | Where it comes from in the skill |
| --- | --- | --- | --- |
| surveyed | a scan with control points, aligned and measured (`scan.fit`) | 1 to 5 cm | `scripts/align-scan.mjs` |
| photo-fitted | a photograph whose viewpoint is fitted on recognised points (`calibration.rms`) | 1 to 2 % of the photo's height: decimetres at 30 m | `scripts/calibrate.mjs` |
| documented | a figure in a source | metres | `evidence.measurements`, `check.mjs` |
| interpreted | a reasoned reconstruction | unstated | `provenance: "interpreted"` and its `note` |

- **Ground sampling distance (GSD) bounds the result.** One UAV study gives, for an acquisition properly planned and calibrated, a relative accuracy within 1 to 3 times the GSD, and an absolute accuracy of 1 to 2 times the GSD horizontally and 1 to 3 times vertically (a rule of thumb from that study alone). A 1 cm GSD is therefore 1 to 3 cm at best. GSD = pixel pitch × distance ÷ focal length: a 6 µm pixel at 30 m behind an 85 mm lens is 2.1 mm (arithmetic, not a source).
- **Control decides whether the best case is reached.** In a facade study of UAV models, the accuracy fluctuated between 7 and 11 cm when the control points sat on the roofs; a close-range survey with a geodetic network reached a 1.6 mm control residual at a 2.1 mm GSD; the Nicosia facade survey used 10 to 15 control and check points per facade, measured by reflectorless total station (5 mm). Another paper frames heritage survey specifications by drawing scale (1:20 to 1:200) rather than by a fixed GSD.
- **Airborne LiDAR is for volumes, not cornices.** From the data.gouv.fr dataset pages and the IGN LiDAR HD presentation material that a search returned (the official IGN specification could not be opened from here): a density of about 10 points per m² (a point every 30 cm or so) and an absolute altimetric accuracy of 10 cm. Planimetric accuracy reads 50 cm in the IGN material and a 0.1 m class on one regional data sheet: the two have not been reconciled. Use it for footprints, heights and roofs.

## Capture methods, as of 2026

| Method | Good for | Not for | Source |
| --- | --- | --- | --- |
| Photogrammetry (structure from motion, then multi-view stereo: COLMAP, OpenMVS, Metashape) | metric geometry, the reference | thin or glazed parts | COLMAP: Schönberger and Frahm, CVPR 2016 |
| 3D gaussian splatting (Postshot, LichtFeld Studio) | how it looks: real-time, photographic | metric measurement | Li, Martino, Chiabrando and Li, ISPRS Archives XLIX-B2-2026 |
| Surface-aware splatting (2DGS, MILo) | a mesh that follows the splats | claims without a laser check | MILo, arXiv 2506.24096; tested against laser scans and Metashape in ISPRS Archives XLIX-B2-2026, 801 (I did not read its numbers) |
| Feed-forward reconstruction (VGGT, Depth Anything 3) | camera poses and a first geometry from a few photographs, in seconds | measurement: it has no control | VGGT, CVPR 2025; Depth Anything 3, ICLR 2026 |
| Monocular metric depth (Depth Pro) | a hint of relief on one photograph | measurement | ICLR 2025 |

- The one peer-reviewed comparison found (Politecnico di Torino, two heritage datasets) reports that 3DGS gives better visual results while its geometric accuracy is generally slightly lower than that of photogrammetry, more so on small or low-resolution datasets, and that Postshot and LichtFeld Studio were more stable than the original GraphDeco implementation. A vendor article argues that a splat's scale is not guaranteed. The honest split: **photogrammetry or a laser for numbers, splats for the picture**.
- Depth Anything 3 is reported by its authors to beat VGGT by about 35.7 % in camera-pose accuracy and 23.6 % in geometric accuracy on their own benchmark (abstract; not re-run, and the VGGT paper's own award status was not confirmed by a primary source).
- **Failure modes the literature names.** Repeated and symmetric structures are a known failure of structure from motion (the Doppelgangers benchmark has 13 landmarks chosen for it): a Gothic front with twin towers is exactly that, so check the registered cameras on a map. Photographs gathered by keyword are contaminated: tags were found accurate about half the time in one study. Glass and polished surfaces break photogrammetry and give splats surface artefacts (Billi et al. 2025, on a glass object).
- **Turning a capture into parametric geometry is still mostly manual.** A 2024 review of heritage scan-to-BIM and a 2023 workflow on a Pisa church both say the modelling of historic elements stays manual; automatic recognition covers vaults and openings (random forests, RANSAC), and no source found does it for mouldings or cornices. That is why the skill keeps the parametric model for history and measures it against the scan, instead of promising to generate it.

## What to shoot (to plan a centimetre)

1. **Ground control first.** The surveys above used 10 to 15 control and check points a facade, measured by total station; spread them over the whole facade, its height included, since the roof-only layout is the one that gave 7 to 11 cm. A sharp architectural corner or a printed target serves. Without a total station, at least two long distances measured by tape or laser fix the scale (not the shape).
2. **Overlap, convergence and light.** I found no source in this session that gives figures for them (Historic England's *Photogrammetric Applications for Cultural Heritage*, J. Bedford, 2017, is the guidance written for this and I have not read it): read it before planning. Keep one focal length, and no digital zoom.
3. **Plan the GSD from the smallest detail** you want to see: with a relative accuracy of 1 to 3 GSD, a detail of 2 cm wants a GSD of about 4 mm or less (arithmetic from the rule above).
4. **What not to include.** People, cars and scaffolding are filtered by the alignment (points with no model in reach never count), but cost time.

If the only photographs are Wikimedia Commons ones, expect decimetres: unknown lenses, uneven coverage, no control. They are enough to bootstrap camera poses (VGGT or COLMAP) and to fit the model; they are not a survey. Credit every photograph and keep its licence: CC BY-SA asks for attribution and ShareAlike on adaptations (read each file's licence; this page is not legal advice).

## Aligning a scan

```
node scripts/align-scan.mjs monuments/<id>.json <scan.ply|.splat|.obj|.xyz> \
  --pairs '[[sx, sy, sz, mx, my, mz], …]' [--rigid] [--write <file next to the monument>]
```

- Three or more pairs, not on a line: a place in the scan (its units) and the same place on the model (metres, the monument's own frame). A few decimetres of error in the pairs is fine.
- The fit is a similarity (Horn) from the pairs, then a trimmed **point-to-plane ICP** (the method CloudCompare and Open3D use) against what stands at the end of the film. Points with no model within 2 m (trees, neighbours, scaffolding) never count. A `.spz` has to be converted to PLY first.
- **Scale.** Without `--rigid` the scale is fitted, and printed. A scan that is not metric needs it; a scan scaled by control or a measured length should use `--rigid`, because a fitted scale can hide the model's own error (a scale off by 0.24 % is about 10 cm at 40 m: with it left in, the median residual rose from 1.3 cm to 2.1 cm and the p90 from 4 to 8 cm). On synthetic scans of Coutances (2 cm of noise per axis, pairs wrong by up to 30 cm, foreign points mixed in) the fitted scale came out within 0.01 % and the median residual at 1.1 to 1.3 cm; `scripts/scan.test.mjs` requires under 0.1 % and under 2 cm. A near-symmetric shape fixes the fit less well: the same test on the Leaning Tower gave a median of 2.7 cm (90 % within 13 cm, the foreign points included), where a first version using point-to-point ICP left 8.6 cm. That tests the method, not a real scan.
- **Read the residuals as the model's error only where the scan is good.** The report is the model's distance to the scan, element by element: an element whose p90 is within a few centimetres agrees with the capture to that figure; a large one is either a model error to correct or a scan defect. It is not the model's distance to the building.
- `--write` records `scan` in the monument: the file, the 4 × 4 matrix the viewer applies, and the fit (scale, points, median, p90, per-element residuals, date).

## Showing it

A monument with a `scan` gets a **Captured** button (or `?scan`) that swaps the built model for the splats, through the same camera, backdrop and output pass. [Spark](https://sparkjs.dev) 2.4.0 (MIT, three.js r180 or later, WebGL2; reads `.ply`, `.spz`, `.splat`, `.ksplat`, `.sog`) is vendored in `kit/vendor/spark` and imported only for a monument that has a scan. Put the scan under `<id>.evidence/scan/`, and keep it small enough for the web (a few million splats at most; `.spz` is the compact format).

## What the skill may claim

- "Centimetre" only for elements with a `scan.fit` residual of a few centimetres **and** a scan with control. Say which elements, and the figure.
- Everything else keeps its class: photo-fitted (decimetres), documented (metres), interpreted. The timeline stays what the model says; a scan shows the building today and proves nothing about its past.
- A scan of a building after a fire, a war or a restoration is the building of that day: say so beside the picture.

## Sources read for this page

- Spark: [github.com/sparkjsdev/spark](https://github.com/sparkjsdev/spark) (MIT; its example loads three 0.180) and npm `@sparkjsdev/spark` 2.4.0 (MIT, peer dependency three ≥ 0.180.0).
- VGGT: [CVPR 2025 paper](https://openaccess.thecvf.com/content/CVPR2025/html/Wang_VGGT_Visual_Geometry_Grounded_Transformer_CVPR_2025_paper.html) and the [Oxford record](https://ora.ox.ac.uk/objects/uuid:a38ecc32-6a07-4b16-a2cc-dae6c01713b7).
- Depth Anything 3: [ICLR 2026](https://proceedings.iclr.cc/paper_files/paper/2026/hash/e4cd50120b6d7e8daff1749d6bbaa889-Abstract-Conference.html) and arXiv 2511.10647.
- Depth Pro: [ICLR 2025](https://proceedings.iclr.cc/paper_files/paper/2025/hash/bc8b2058fd96978a4146f18298cb2d39-Abstract-Conference.html) and [Apple](https://machinelearning.apple.com/research/depth-pro).
- Photogrammetry against splatting: [Li et al., ISPRS Archives XLIX-B2-2026, 451](https://isprs-archives.copernicus.org/articles/XLIX-B2-2026/451/2026/) (found by two searches; the page itself could not be opened from here, so the findings above are those of its abstract).
- MILo: [arXiv 2506.24096](https://arxiv.org/abs/2506.24096) and [ISPRS Archives XLIX-B2-2026, 801](https://isprs-archives.copernicus.org/articles/XLIX-B2-2026/801/2026/).
- LiDAR HD: [data.gouv.fr](https://www.data.gouv.fr/datasets/lidar-hd-ign-2022) and an IGN presentation on the [OpenIG site](https://www.openig.org/sites/default/files/CRIG_2023/Support_presentation_journee_CRIG_Occitanie_LidarHD_16112023.pdf).
- Accuracy against GSD and control: [ISPRS Annals X-M-1-2023, 27](https://isprs-annals.copernicus.org/articles/X-M-1-2023/27/2023/isprs-annals-X-M-1-2023-27-2023.pdf), the [facade study with roof control points](https://earsiv.hitit.edu.tr/items/cf842766-4100-46bb-8f47-59c9b22a5692) and the [Nicosia facade survey](https://www.cipaheritagedocumentation.org/wp-content/uploads/2018/12/Patias-e.a.-Mapping-of-buildings-facades‘at-the-historical-centre-of-Nicosia-and-creating-a-preservation-information-system.pdf).
- Structure from motion on landmarks: [COLMAP](https://openaccess.thecvf.com/content_cvpr_2016/papers/Schonberger_Structure-From-Motion_Revisited_CVPR_2016_paper.pdf), [Doppelgangers](https://arxiv.org/pdf/2309.02420).
- Scan-to-BIM: [Gil et al., J. Comput. Cult. Herit. 2024](https://strathprints.strath.ac.uk/88886/7/Gil-etal-JCCH-2024-Machine-and-deep-learning-implementations-for-heritage-building.pdf) and [Ceccarelli et al. 2023](https://doaj.org/article/a044dfc057194de8915156f50b0d7fdb).
- three.js: [releases](https://github.com/mrdoob/three.js/releases): r186 of 24 September, the version the kit vendors, removes `PCFSoftShadowMap`; `WebGPURenderer` and TSL are in active development there, and the kit stays on the WebGL renderer.
- One search for a public 3D model or laser scan of Coutances Cathedral (October 2026) found none; the DRAC Normandie, the city and the Centre des monuments nationaux were the suggested places to ask.
