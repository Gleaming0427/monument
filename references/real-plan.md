# Placing a building on its real plan

A real building is placed from measured footprints, never by eye.

1. **Geocode** the address. In France, the Base adresse nationale (`https://api-adresse.data.gouv.fr/search/?q=…`); elsewhere, Nominatim, within its usage policy.
2. **Fetch the requested structure's footprint**. Keep the bounding box tight; only fetch the surrounding block when the user asked for context:
   - in France, the IGN Géoplateforme WFS: `BDTOPO_V3:batiment` gives outlines, `hauteur` and `nombre_d_etages`; `CADASTRALPARCELS.PARCELLAIRE_EXPRESS:batiment` gives the current land registry; the parcel comes from `https://apicarto.ign.fr/api/cadastre/parcelle`;
   - elsewhere, OpenStreetMap: `https://api.openstreetmap.org/api/0.6/map?bbox=…` over 150 m at most, or Overpass. Streets and fences are there too.
   Keep the raw extracts next to the monument as evidence.
3. **Convert to local metres** around the centre of the footprint: x = (lon − lon0) × 111 320 × cos(lat0), z = −(lat − lat0) × 110 540. x points east, z points south.
4. **Draw the target footprint** as an SVG and check the identity before modelling: name, address, area, height. Compare sources where several exist; they must agree. Ask what an outline really is: an OSM outline traced from aerial imagery is often the roof overhang, not the foot of the walls.
4b. **Save the outline** as `<id>.evidence/outline.json`: `{"source": "OpenStreetMap way 123", "url": "https://…", "polygons": [[[x, z], …]]}` in the same local metres as the model, and keep the raw extract next to it (`<id>.evidence/outline-source.xml` or `.json`).
5. **Fit each historic block to the real footprint**: one oriented rectangle per block (long axis = local z, `rot = atan2(ux, uz)`). Run `node scripts/plan.mjs monuments/<id>.json`: it builds the finished model, compares its footprint with the outline sector by sector, prints the gap and draws `<id>.evidence/plan.svg`. Correct until the gap is about 1–2 m; evidence validation refuses more than 3 m. Overlaps are allowed only inside volumes.
6. **Take heights** from the BD TOPO, from the OSM `height` and `building:levels` tags, or from official figures. Numbers of bays and storeys come from descriptions (heritage inventory, notices, encyclopaedias) and photos.
7. **Context is opt-in.** The default scene contains the requested structure and its own grounds only. Add `context.buildings`, `context.streets` and `labels` when the user asks for the surroundings or when an adjacent structure is necessary to explain a construction phase. Never add generic houses. Labels are hidden by default in the viewer; `?context` reveals them with the context layer.
8. In `evidence.geometry` and `uncertainties`, separate what is measured (footprint, height) from what is interpreted (split between periods, depth of an extension, look of the facades).

If no footprint exists (a destroyed building, an earlier state), say so and fit the model to a published plan or to the remains, labelled as an estimate.
