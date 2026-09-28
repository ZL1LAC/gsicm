# Real GK2A IR105 compatibility test

Tested with the bundled Sanchez 1.0.26 on 28 September 2026. Both commands exited successfully and their output images were opened for visual inspection. Asia and Australia appear correctly oriented and aligned with the static underlay. This is a single-observation compatibility test, not an operational feed or quantitative geolocation certification.

## Input

- Public object: https://noaa-gk2a-pds.s3.amazonaws.com/AMI/L1B/FD/202609/28/03/gk2a_ami_le1b_ir105_fd020ge_202609280300.nc
- Download: 35,213,954 bytes, native 5500 × 5500 full disc, IR105 at 2 km.
- SHA-256: `e6e42d542256bc214eecc0eed1899b8271c4f0d59c341842147d6bf52a96caeb`
- Observation start from NetCDF metadata: **2026-09-28 03:00:32.368767 UTC**; end **03:09:36.017891 UTC**. Filename has the nominal 03:00 slot; the decoded filename uses the actual start time, truncated to whole seconds for Sanchez.

## Decoding and geometry

`scripts/test-gk2a.py` uses Satpy's `ami_l1b` reader with in-file calibration to brightness temperature. The reader masks bad/conditional pixels. The display stretch is 180–330 K, cold white and warm black, with invalid pixels and space black. This is a display image, not a replacement for calibrated scientific data.

AMI's native geostationary grid is sweep-Y. Sanchez uses GOES-R sweep-X geometry. The script reprojects with pyproj and bilinear interpolation onto Sanchez's 5424 × 5424 grid at 2 km: first pixel-centre scan angle −0.151844 rad, step 0.000056 rad, longitude 128.2°, height 35,786,023 m, GRS80 ellipsoid. No additional crop is applied. Using the bundled crop for a native AMI image after this reprojection would be incorrect.

The generated custom definition uses `Goesproc` timestamp parsing and the `GK2A_FD_IR_` prefix. Bundled definitions are unchanged.

References: [Satpy AMI reader](https://github.com/pytroll/satpy/blob/main/satpy/readers/ami_l1b.py), [Sanchez grid constants](https://github.com/nullpainter/sanchez/blob/master/Sanchez.Processing/Models/Constants.cs).

## Artifacts

Files are retained in `data/gk2a-test/`:

- Original `.nc` object.
- `decoded/GK2A_FD_IR_20260928T030032Z.png`: native decoded greyscale image.
- `decoded/sanchez-input/GK2A_FD_IR_20260928T030032Z.png`: geometrically normalized input, 5424 × 5424.
- `decoded/decoded-metadata.json` and `decoded/satellites.json`: metadata and custom definition.
- `GK2A-false-colour.jpg`: actual Sanchez full-disc output, 5695 × 5695 including atmosphere padding.
- `GK2A-map.jpg`: actual Sanchez reprojection, 5424 × 2712. Only the GK2A footprint has observed clouds; other regions are static underlay. This is not a global weather composite.

## Repeat

From the project directory, using uv:

```powershell
uv venv --python 3.12 .venv-gk2a
uv pip install --python .venv-gk2a/Scripts/python.exe -r scripts/requirements-gk2a.txt
.\.venv-gk2a\Scripts\python.exe scripts/test-gk2a.py data/gk2a-test/gk2a_ami_le1b_ir105_fd020ge_202609280300.nc --output data/gk2a-test/decoded
.\bin\Sanchez.exe geostationary -s data/gk2a-test/decoded/sanchez-input/GK2A_FD_IR_20260928T030032Z.png -o data/gk2a-test/GK2A-false-colour.jpg -D data/gk2a-test/decoded/satellites.json -u bin/Resources/world.200412.3x21600x10800.jpg -r 2 -n -f
.\bin\Sanchez.exe reproject -s data/gk2a-test/decoded/sanchez-input/GK2A_FD_IR_20260928T030032Z.png -o data/gk2a-test/GK2A-map.jpg -D data/gk2a-test/decoded/satellites.json -u bin/Resources/world.200412.3x21600x10800.jpg -r 4 -T 2026-09-28T03:00:32 -m 1 --nocrop -n -f
```

The manager's acquisition path still expects rendered rasters. This test does not enable raw NetCDF ingestion or scheduled GK2A acquisition.
