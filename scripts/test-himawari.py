"""Validate a complete Himawari-9 B13 scan and normalize it for Sanchez."""
import argparse
import hashlib
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import CRS, Transformer
from satpy import Scene
from scipy.ndimage import map_coordinates


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source_dir", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    files = sorted(args.source_dir.glob("HS_H09_*_B13_FLDK_R20_S*10.DAT.bz2"))
    matches = [re.fullmatch(r"HS_H09_(\d{8}_\d{4})_B13_FLDK_R20_S(\d{2})10.DAT.bz2", f.name) for f in files]
    if len(files) != 10 or not all(matches) or {int(m[2]) for m in matches} != set(range(1, 11)) or len({m[1] for m in matches}) != 1:
        raise ValueError("Exactly ten distinct segments from one B13 full-disc scan are required.")
    scene = Scene(reader="ahi_hsd", filenames=[str(f) for f in files])
    scene.load(["B13"], calibration="brightness_temperature")
    channel = scene["B13"]
    values = channel.compute().values
    if values.shape != (5500, 5500):
        raise ValueError(f"Expected full disc, received {values.shape}")
    area = channel.attrs["area"]
    longitude = float(area.crs.to_dict()["lon_0"])
    if abs(longitude - 140.7) > 0.01:
        raise ValueError("Unexpected Himawari projection longitude.")
    valid = np.isfinite(values)
    if valid.mean() < 0.7:
        raise ValueError("Insufficient valid pixels for a complete full disc.")
    size, height = 5424, 35786023.0
    target = CRS.from_proj4(f"+proj=geos +sweep=x +lon_0={longitude} +h={height} +a=6378137 +b=6356752.31414 +units=m")
    transformer = Transformer.from_crs(target, area.crs, always_xy=True)
    scan = -0.151844 + np.arange(size) * 0.000056
    xmin, ymin, xmax, ymax = area.area_extent
    dx, dy = (xmax-xmin)/5500, (ymax-ymin)/5500
    image = np.zeros((size, size), dtype=np.uint8)
    for row in range(0, size, 128):
        stop = min(row+128, size)
        xx, yy = np.meshgrid(scan*height, -scan[row:stop]*height)
        sx, sy = transformer.transform(xx, yy)
        visible = np.isfinite(sx) & np.isfinite(sy)
        cols = np.where(visible, (sx-xmin)/dx - 0.5, -1)
        rows = np.where(visible, (ymax-sy)/dy - 0.5, -1)
        sampled = map_coordinates(values, [rows, cols], order=1, mode="constant", cval=np.nan, prefilter=False)
        good = visible & np.isfinite(sampled)
        image[row:stop][good] = np.rint(np.clip((330-sampled[good])/150, 0, 1)*255).astype(np.uint8)
    times = channel.attrs.get("time_parameters", {})
    start = times.get("observation_start_time", channel.attrs["start_time"])
    end = times.get("observation_end_time", channel.attrs["end_time"])
    name = f"Himawari9_FD_IR_{start:%Y%m%dT%H%M%SZ}.png"
    inputs = args.output / "sanchez-input"
    inputs.mkdir(parents=True, exist_ok=True)
    Image.fromarray(image).save(inputs / name)
    definition = [{"DisplayName":"Himawari-9-AHI-B13", "FilenamePrefix":"^Himawari9_FD_IR_",
                   "FilenameParser":"Goesproc", "Longitude":longitude, "Brightness":1,
                   "Invert":False, "Crop":[0,0,0,0]}]
    (args.output/"satellites.json").write_text(json.dumps(definition, indent=2), encoding="utf-8")
    metadata = {"sources":[{"name":f.name,"sha256":hashlib.sha256(f.read_bytes()).hexdigest()} for f in files],
                "channel":"B13", "wavelength_um":10.4, "shape":list(values.shape), "segments":len(files),
                "observation_start_utc":start.isoformat()+"Z", "observation_end_utc":end.isoformat()+"Z",
                "time_parameters":times, "projection":area.crs.to_dict(), "area_extent_m":area.area_extent,
                "valid_fraction":float(valid.mean()), "temperature_percentiles_kelvin":np.percentile(values[valid],[0,1,50,99,100]).tolist(),
                "sanchez_input":str(inputs/name), "sanchez_shape":[size,size],
                "sanchez_grid":{"sweep":"x","height_m":height,"longitude":longitude,"crop":[0,0,0,0],"interpolation":"bilinear"},
                "display":"180-330 K; cold white, warm black; invalid pixels and space black"}
    text=json.dumps(metadata, indent=2, default=lambda x:x.isoformat() if hasattr(x,"isoformat") else str(x))
    (args.output/"decoded-metadata.json").write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
