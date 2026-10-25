# Spark

[Spark](https://sparkjs.dev) 2.4.0, a 3D Gaussian Splatting renderer for three.js, by World Labs (MIT, see `LICENSE`).
This is `dist/spark.module.min.js` of the npm package `@sparkjsdev/spark@2.4.0`, unchanged (its WebAssembly and
workers are inside the file), under the name the kit imports. The package's published integrity is
`sha512-aUjgBfhwDRcF3nUwiAD6Nh7IwvxEmW9liz2qrAXIm2BlPYBmn81QbXIpGFLBSr/o0TKGvEXbNIsKujgPGV/7QQ==`.

It needs three.js r180 or later (the kit vendors r186) and WebGL2. The viewer loads it only for a monument that
carries a `scan`, so a monument without one never downloads it. To update: `npm pack @sparkjsdev/spark@<version>`,
copy `dist/spark.module.min.js` over `spark.module.js`, and rerun `node scripts/scan.test.mjs` and a capture of a monument with a scan.
