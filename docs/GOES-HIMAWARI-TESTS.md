# GOES and Himawari real-data tests

On 28 September 2026, one 03:00 UTC scan from each of GOES-19, GOES-18, and Himawari-9 was downloaded anonymously from public NOAA AWS buckets, decoded, and rendered by the bundled Sanchez 1.0.26. The individual full-disc images and a four-satellite composite with the previously tested GK2A observation were opened for visual inspection. This establishes sample compatibility, not operational availability or quantitatively certified geolocation.

## GOES-East and GOES-West

Public buckets: `noaa-goes19`, `noaa-goes18`. Product prefix: `ABI-L1b-RadF/2026/271/03/`. Channel: C13 (10.3 µm), full disc at 2 km. [NOAA AWS registry](https://registry.opendata.aws/noaa-goes/).

- GOES-19: `OR_ABI-L1b-RadF-M6C13_G19_s20262710300201_e20262710309520_c20262710309583.nc`, 26,006,464 bytes. Observation 03:00:20.1–03:09:52.0 UTC. File projection longitude **−75.0°**, used instead of the bundled −75.2° definition.
- GOES-18: `OR_ABI-L1b-RadF-M6C13_G18_s20262710300223_e20262710309542_c20262710309599.nc`, 25,881,202 bytes. Observation 03:00:22.3–03:09:54.2 UTC. File projection longitude **−137.0°**.

`scripts/test-goes.py` uses Satpy's ABI reader for calibrated brightness temperature and separately applies the NetCDF DQF mask, accepting only quality 0 pixels. Both native 5424 × 5424 sweep-X grids matched Sanchez to within 0.00043 pixels of its expected scan-coordinate values. No resampling or border crop was required. The fixed display stretch is 180–330 K, cold white and warm black; space and invalid pixels are black.

Raw files, source manifests, hashes, metadata, decoded PNGs, and custom satellite definitions are retained under `data/goes19-test/` and `data/goes18-test/`. Sanchez produced `GOES19-false-colour.jpg` and `GOES18-false-colour.jpg`, both 5695 × 5695 including atmosphere padding. Visual inspection found the land/ocean features correctly oriented against the underlay.

## Himawari-9

Public bucket: `noaa-himawari9`. Prefix: `AHI-L1b-FLDK/2026/09/28/0300/`. Channel: B13 (10.4 µm), 2 km. [NOAA/JMA AWS registry](https://registry.opendata.aws/noaa-himawari/).

All ten `HS_H09_20260928_0300_B13_FLDK_R20_S0110.DAT.bz2` through `S1010.DAT.bz2` segments were downloaded, totaling 23,823,383 bytes. The test rejects missing, duplicate, or mixed-slot segment sets before decoding. Satpy's `ahi_hsd` reader assembled a 5500 × 5500 image and calibrated it to brightness temperature, with invalid and off-disc data masked. Actual observation time is **03:00:21.842072–03:09:41.239613 UTC**, distinct from the nominal 03:00 slot.

`scripts/test-himawari.py` reprojects the native sweep-Y grid at 140.7°E onto Sanchez's 5424 × 5424 sweep-X grid using bilinear interpolation, then applies the same 180–330 K display stretch. The generated definition uses zero crop and no empirical longitude adjustment. The native AMI and AHI grid extents differ, so the decoder uses each product's metadata rather than assuming the GK2A extent.

Artifacts are in `data/himawari9-test/`. Sanchez's `Himawari9-false-colour.jpg` is 5695 × 5695 and was visually inspected, including Australia, Japan, and New Zealand.

## Combined test

`scripts/render-combined-test.ps1` stages exactly one decoded image per satellite, combines their custom definitions, and renders with **four required satellites**, a target of **03:00:30 UTC**, and **two-minute tolerance**. Sanchez's logs confirm that GK2A, GOES-18, GOES-19, and Himawari-9 were all selected and reprojected.

- `data/combined-test/four-satellite-map.jpg`: 5424 × 2712.
- `data/combined-test/four-satellite-pacific.jpg`: 2848 × 2848, virtual satellite centred at 180°.
- `data/combined-test/observations.json`: exact observation intervals and input filenames.

Both images were decoded and visually inspected. The Pacific cloud field blends across source coverage. **Europe/Africa and parts of the Indian Ocean still lack a dedicated observation source.** Underlay-only areas and polar regions are not fresh cloud observations. The map is not a complete global weather product.

## Repeat

Use the Python environment and pinned dependencies from `scripts/requirements-gk2a.txt`:

```powershell
$east = (Get-ChildItem data/goes19-test/*.nc).FullName
$west = (Get-ChildItem data/goes18-test/*.nc).FullName
.\.venv-gk2a\Scripts\python.exe scripts/test-goes.py $east --output data/goes19-test/decoded
.\.venv-gk2a\Scripts\python.exe scripts/test-goes.py $west --output data/goes18-test/decoded
.\.venv-gk2a\Scripts\python.exe scripts/test-himawari.py data/himawari9-test --output data/himawari9-test/decoded
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/render-combined-test.ps1
```

This work adds repeatable sample decoders and validation artifacts. The dashboard's production acquisition path is still raster-only; these raw feeds are not enabled for unattended processing yet. Data-derived images are modified NOAA/JMA/KMA products and do not imply agency endorsement.
