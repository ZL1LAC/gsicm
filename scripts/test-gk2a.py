"""Decode one AMI IR105 observation for a real Sanchez compatibility test.

Uses Satpy's AMI reader, in-file IR calibration, and native geostationary grid.
The display stretch is fixed at 180–330 K with cold clouds bright.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import netCDF4
from PIL import Image
from satpy import Scene
from pyproj import CRS, Transformer
from scipy.ndimage import map_coordinates


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with netCDF4.Dataset(args.source) as nc:
        if nc.satellite_name != "GK-2A" or nc.observation_mode != "FD":
            raise ValueError("Expected GK-2A full-disc data")
    if "_ir105_fd020ge_" not in args.source.name:
        raise ValueError("Expected AMI IR105 2 km product")
    scene = Scene(reader="ami_l1b", filenames=[str(args.source)],
                  reader_kwargs={"calib_mode": "FILE"})
    scene.load(["IR105"], calibration="brightness_temperature")
    channel = scene["IR105"]
    values = channel.compute().values
    if values.shape != (5500, 5500) or abs(float(channel.attrs["area"].crs.to_dict()["lon_0"]) - 128.2) > 0.01:
        raise ValueError("Unexpected AMI full-disc geometry")
    good = np.isfinite(values)
    if good.mean() < 0.7:
        raise ValueError("Insufficient valid full-disc pixels")
    pixels = np.zeros(values.shape, dtype=np.uint8)
    pixels[good] = np.rint(np.clip((330 - values[good]) / 150, 0, 1) * 255).astype(np.uint8)
    start = channel.attrs["start_time"]
    name = f"GK2A_FD_IR_{start:%Y%m%dT%H%M%SZ}.png"
    Image.fromarray(pixels).save(args.output / name)
    area = channel.attrs["area"]
    # Sanchez uses the GOES-R sweep-X scan grid. AMI uses sweep-Y; cropping
    # alone does not correct that geometric difference. Reproject explicitly.
    target_size = 5424
    target_height = 35786023.0
    target_crs = CRS.from_proj4(
        "+proj=geos +sweep=x +lon_0=128.2 +h=35786023 "
        "+a=6378137 +b=6356752.31414 +units=m"
    )
    transform = Transformer.from_crs(target_crs, area.crs, always_xy=True)
    scan = -0.151844 + np.arange(target_size) * 0.000056
    xmin, ymin, xmax, ymax = area.area_extent
    dx, dy = (xmax - xmin) / values.shape[1], (ymax - ymin) / values.shape[0]
    canonical = np.zeros((target_size, target_size), dtype=np.uint8)
    for row in range(0, target_size, 128):
        stop = min(row + 128, target_size)
        xx, yy = np.meshgrid(scan * target_height, -scan[row:stop] * target_height)
        sx, sy = transform.transform(xx, yy)
        visible = np.isfinite(sx) & np.isfinite(sy)
        cols = np.where(visible, (sx - xmin) / dx - 0.5, -1)
        rows = np.where(visible, (ymax - sy) / dy - 0.5, -1)
        sampled = map_coordinates(values, [rows, cols], order=1, mode="constant", cval=np.nan, prefilter=False)
        valid = visible & np.isfinite(sampled)
        out = canonical[row:stop]
        out[valid] = np.rint(np.clip((330 - sampled[valid]) / 150, 0, 1) * 255).astype(np.uint8)
    input_dir = args.output / "sanchez-input"
    input_dir.mkdir(exist_ok=True)
    Image.fromarray(canonical).save(input_dir / name)
    definitions = [{"DisplayName": "GK2A-AMI-IR105", "FilenamePrefix": "^GK2A_FD_IR_",
                    "FilenameParser": "Goesproc", "Longitude": 128.2,
                    "Brightness": 1.0, "Invert": False, "Crop": [0, 0, 0, 0]}]
    (args.output / "satellites.json").write_text(json.dumps(definitions, indent=2), encoding="utf-8")
    ys, xs = np.where(good)
    with netCDF4.Dataset(args.source) as nc:
        keys = ["satellite_name", "channel_name", "observation_mode", "sub_longitude",
                "number_of_columns", "number_of_lines", "cfac", "lfac", "coff", "loff",
                "earth_equatorial_radius", "earth_polar_radius", "nominal_satellite_height",
                "channel_spatial_resolution", "DN_to_Radiance_Gain", "DN_to_Radiance_Offset"]
        native = {key: nc.getncattr(key) for key in keys if key in nc.ncattrs()}
    metadata = {"source": args.source.name, "sha256": hashlib.sha256(args.source.read_bytes()).hexdigest(),
                "output": name, "observation_start_utc": start.isoformat() + "Z",
                "observation_end_utc": channel.attrs["end_time"].isoformat() + "Z",
                "shape": list(values.shape), "valid_fraction": float(good.mean()),
                "valid_bounds_xy": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
                "temperature_percentiles_kelvin": np.percentile(values[good], [0, 1, 50, 99, 100]).tolist(),
                "display": "180–330 K, cold white, warm black; invalid/space black",
                "area_extent_m": list(area.area_extent), "projection": area.crs.to_dict(), "native": native,
                "sanchez_input": str(input_dir / name), "sanchez_shape": [target_size, target_size],
                "sanchez_grid": {"longitude": 128.2, "sweep": "x", "scan_first_center_radians": -0.151844,
                                 "scan_step_radians": 0.000056, "height_m": target_height,
                                 "crop": [0, 0, 0, 0], "interpolation": "bilinear"}}
    text = json.dumps(metadata, indent=2, default=lambda x: x.item() if hasattr(x, "item") else str(x))
    (args.output / "decoded-metadata.json").write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
