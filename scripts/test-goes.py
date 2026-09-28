"""Decode and validate one GOES ABI C13 full disc against Sanchez's 2 km grid."""
import argparse
import hashlib
import json
from pathlib import Path

import netCDF4
import numpy as np
from PIL import Image
from satpy import Scene


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    with netCDF4.Dataset(args.source) as nc:
        platform = nc.platform_ID
        if platform not in ("G18", "G19") or int(nc["band_id"][:].item()) != 13:
            raise ValueError("This test expects GOES-18/19 ABI channel 13.")
        projection = nc["goes_imager_projection"]
        longitude = float(projection.longitude_of_projection_origin)
        height = float(projection.perspective_point_height)
        sweep = projection.sweep_angle_axis
        x, y = np.asarray(nc["x"][:], dtype=np.float64), np.asarray(nc["y"][:], dtype=np.float64)
        expected = -0.151844 + np.arange(5424) * 0.000056
        if x.shape != (5424,) or y.shape != (5424,):
            raise ValueError("Expected a 5424 x 5424 full disc.")
        x_error = float(np.max(np.abs(x - expected)))
        y_error = float(np.max(np.abs(y + expected)))
        if sweep != "x" or abs(height - 35786023) > 1 or max(x_error, y_error) > 1e-7:
            raise ValueError("Native grid differs from Sanchez; explicit reprojection is required.")
        dqf = nc["DQF"][:]
        good_quality = np.asarray(np.ma.filled(dqf, 255)) == 0
        quality_values, quality_counts = np.unique(np.ma.filled(dqf, 255), return_counts=True)
        coverage_start, coverage_end = nc.time_coverage_start, nc.time_coverage_end
    scene = Scene(reader="abi_l1b", filenames=[str(args.source)])
    scene.load(["C13"], calibration="brightness_temperature")
    channel = scene["C13"]
    values = channel.compute().values
    if values.shape != good_quality.shape:
        raise ValueError("Quality mask and calibrated image dimensions differ.")
    valid = good_quality & np.isfinite(values)
    if valid.sum() == 0:
        raise ValueError("No valid pixels.")
    pixels = np.zeros(values.shape, dtype=np.uint8)
    pixels[valid] = np.rint(np.clip((330 - values[valid]) / 150, 0, 1) * 255).astype(np.uint8)
    satellite = "GOES" + platform[1:]
    start = channel.attrs["start_time"]
    filename = f"{satellite}_FD_CH13_{start:%Y%m%dT%H%M%SZ}.png"
    inputs = args.output / "sanchez-input"
    inputs.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels).save(inputs / filename)
    definitions = [{"DisplayName": "GOES-" + platform[1:], "FilenamePrefix": f"^{satellite}_FD_CH13_",
                    "FilenameParser": "Goesproc", "Longitude": longitude, "Height": height,
                    "Brightness": 1.0, "Invert": False, "Crop": [0, 0, 0, 0]}]
    (args.output / "satellites.json").write_text(json.dumps(definitions, indent=2), encoding="utf-8")
    metadata = {"source": args.source.name, "sha256": hashlib.sha256(args.source.read_bytes()).hexdigest(),
                "satellite": platform, "channel": "C13", "wavelength_um": 10.3,
                "observation_start_utc": coverage_start, "observation_end_utc": coverage_end,
                "sanchez_input": str(inputs / filename), "shape": list(values.shape),
                "grid": {"longitude": longitude, "height_m": height, "sweep": sweep,
                         "max_x_error_pixels": x_error / 0.000056, "max_y_error_pixels": y_error / 0.000056,
                         "reprojection_required": False, "crop": [0, 0, 0, 0]},
                "quality_counts": {str(int(v)): int(n) for v, n in zip(quality_values, quality_counts)},
                "valid_fraction": float(valid.mean()),
                "temperature_percentiles_kelvin": np.percentile(values[valid], [0, 1, 50, 99, 100]).tolist(),
                "display": "180-330 K; cold white, warm black; DQF != 0 and invalid pixels black"}
    text = json.dumps(metadata, indent=2)
    (args.output / "decoded-metadata.json").write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
