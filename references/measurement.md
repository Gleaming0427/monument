# Measuring Monument changes

Do not claim that a geometry or skill change is faster or uses fewer tokens from one subjective run. Compare the same reference monument, prompt, model and quality gate before and after the change.

The release references are the Parthenon and Coutances Cathedral. Their generated geometry is frozen in `scripts/fixtures/golden-models.json`; `node scripts/golden.test.mjs` checks every piece, shape registry, bound, plan fit and calibrated-photo RMS. Intentional geometry changes require visual review before updating that baseline.

Record a run by wrapping its command:

```sh
node scripts/measure.mjs \
  --label parthenon-before \
  --model parthenon \
  --input-tokens 120000 \
  --cached-input-tokens 0 \
  --output-tokens 30000 \
  --reasoning-tokens 0 \
  -- node scripts/validate.mjs --strict community/parthenon/monument.json
```

The wrapper records wall-clock time, CPU time, machine, Git revision, exit status and the supplied token categories in `.artifacts/metrics.jsonl`. Token fields are optional and remain `null` when the host does not expose them; never estimate them. Keep raw run artifacts out of Git and publish the JSONL as a CI artifact when useful.

For a meaningful comparison:

1. Run at least five times per implementation, alternating old and new versions when possible.
2. Keep the model, reasoning effort, prompt, reference photos and network conditions fixed.
3. Compare medians and report input, cached-input, output and reasoning tokens separately.
4. Run `node scripts/build-site.mjs`, `node scripts/golden.test.mjs` and `node scripts/responsive.test.mjs` before accepting the result.
5. Reject a speed or token improvement that changes a golden geometry snapshot without an explicit visual and evidence review.

`responsive.test.mjs` opens the real production viewer in Chrome at 390×844, 1024×768 and 1440×900. It captures each result under `.artifacts/responsive/` and verifies that the camera reserves the header, story, moment, statistics and timeline panels instead of drawing the monument underneath them.
