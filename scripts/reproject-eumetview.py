"""Plan a timestamped EUMETView request or reproject its clean geographic raster."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
import xml.etree.ElementTree as ET

LAYER = 'msg_iodc:ir108'
BBOX = (-35.5, -77.0, 118.5, 77.0)
LONGITUDE = 45.5
SIZE = 5424
HEIGHT = 35786023.0


def plan(capabilities, target, tolerance, endpoint):
    ns = {'w': 'http://www.opengis.net/wms'}
    root = ET.fromstring(capabilities)
    layer = next((v for v in root.findall('.//w:Layer', ns)
                  if v.findtext('w:Name', '', ns) == LAYER), None)
    if layer is None:
        raise ValueError('Meteosat IODC IR10.8 layer is unavailable')
    dimension = next((v for v in layer.findall('w:Dimension', ns)
                      if v.get('name') == 'time'), None)
    # Use the explicitly advertised latest observation, not an inferred interval
    # slot: WMS may silently choose a neighbour for an unavailable timestamp.
    stamp = dimension.get('default', '') if dimension is not None else ''
    observed = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
    requested = datetime.fromisoformat(target.replace('Z', '+00:00'))
    if observed.tzinfo is None or requested.tzinfo is None:
        raise ValueError('Observation and target must have UTC offsets')
    if abs((observed - requested).total_seconds()) > tolerance * 60:
        raise ValueError('Latest advertised IODC observation is outside the required time window')
    if (observed - datetime.now(timezone.utc)).total_seconds() > 60:
        raise ValueError('IODC observation is in the future')
    box = layer.find("w:BoundingBox[@CRS='CRS:84']", ns)
    if box is None or tuple(float(box.get(k)) for k in ['minx','miny','maxx','maxy']) != BBOX:
        raise ValueError('IODC geographic bounds changed; geometry needs revalidation')
    stamp = observed.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
    parts = urlsplit(endpoint)
    params = dict(service='WMS', request='GetMap', version='1.3.0', layers=LAYER,
                  styles='', crs='CRS:84', bbox=','.join(map(str, BBOX)),
                  width=3712, height=3712, format='image/png', transparent='true', time=stamp)
    query = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True)
             if key.lower() not in params]
    query.extend(params.items())
    return dict(observationTime=stamp, key=f'IODC_IR108_{observed:%Y%m%dT%H%M%SZ}.png',
                url=urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), '')))


def reproject(source, destination):
    import numpy as np
    from PIL import Image
    from pyproj import CRS, Transformer
    from scipy.ndimage import map_coordinates

    with Image.open(source) as im:
        if im.format != 'PNG' or im.size != (3712, 3712):
            raise ValueError('Expected a 3712 x 3712 WMS PNG')
        rgba = np.asarray(im.convert('RGBA'))
    # The WMS renderer can differ by one level between RGB channels.
    spread = rgba[:,:,:3].max(axis=2).astype(int) - rgba[:,:,:3].min(axis=2)
    if np.any(spread[rgba[:,:,3] > 0] > 1):
        raise ValueError('Expected greyscale IR imagery')
    values = rgba[:,:,0].astype(np.float32)
    values[rgba[:,:,3] == 0] = np.nan
    if np.isfinite(values).mean() < 0.5 or np.nanstd(values) < 5:
        raise ValueError('IODC image has insufficient valid cloud imagery')
    target = CRS.from_proj4(f'+proj=geos +sweep=x +lon_0={LONGITUDE} +h={HEIGHT} +a=6378137 +b=6356752.31414 +units=m')
    transform = Transformer.from_crs(target, 'EPSG:4326', always_xy=True)
    scan = -0.151844 + np.arange(SIZE) * 0.000056
    result = np.zeros((SIZE, SIZE), dtype=np.uint8)
    west, south, east, north = BBOX
    for row in range(0, SIZE, 128):
        stop = min(row + 128, SIZE)
        xx, yy = np.meshgrid(scan * HEIGHT, -scan[row:stop] * HEIGHT)
        lon, lat = transform.transform(xx, yy)
        visible = np.isfinite(lon) & np.isfinite(lat)
        cols = np.where(visible, (lon-west)/(east-west)*3712 - 0.5, -1)
        rows = np.where(visible, (north-lat)/(north-south)*3712 - 0.5, -1)
        sampled = map_coordinates(values, [rows, cols], order=1, mode='constant', cval=np.nan, prefilter=False)
        good = visible & np.isfinite(sampled)
        result[row:stop][good] = np.rint(sampled[good]).astype(np.uint8)
    Image.fromarray(result).save(destination)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--capabilities', type=Path)
    p.add_argument('--target')
    p.add_argument('--tolerance', type=float)
    p.add_argument('--endpoint')
    p.add_argument('--source', type=Path)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    if a.capabilities:
        a.output.write_text(json.dumps(plan(a.capabilities.read_bytes(), a.target, a.tolerance, a.endpoint)))
    else:
        reproject(a.source, a.output)


if __name__ == '__main__':
    main()
