"""Offline checks of timestamp selection and the Sanchez reprojection grid."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timezone, timedelta
from urllib.parse import parse_qs, urlsplit

spec = importlib.util.spec_from_file_location('eumetview', Path(__file__).resolve().parents[1] / 'scripts/reproject-eumetview.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def capabilities(stamp, bounds='-35.5,-77,118.5,77'):
    w,s,e,n = bounds.split(',')
    return f'''<WMS_Capabilities xmlns="http://www.opengis.net/wms"><Capability><Layer><Layer>
      <Name>msg_iodc:ir108</Name><BoundingBox CRS="CRS:84" minx="{w}" miny="{s}" maxx="{e}" maxy="{n}"/>
      <Dimension name="time" default="{stamp}" nearestValue="1">2020-01-01T00:00:00Z/{stamp}/PT15M</Dimension>
      </Layer></Layer></Capability></WMS_Capabilities>'''


class IodcTests(unittest.TestCase):
    def test_endpoint_query_parameters_survive_getmap(self):
        now = datetime.now(timezone.utc)
        stamp = (now-timedelta(minutes=15)).isoformat()
        endpoint = ('https://example.org/wms?map=iodc.map&token=a%2Bb%26c'
                    '&tag=one&tag=two&empty=&REQUEST=GetCapabilities&TIME=old&WIDTH=1')
        p = m.plan(capabilities(stamp), now.isoformat(), 30, endpoint)
        query = parse_qs(urlsplit(p['url']).query, keep_blank_values=True)
        self.assertEqual(query['map'], ['iodc.map'])
        self.assertEqual(query['token'], ['a+b&c'])
        self.assertEqual(query['tag'], ['one', 'two'])
        self.assertEqual(query['empty'], [''])
        self.assertEqual(query['request'], ['GetMap'])
        self.assertEqual(query['width'], ['3712'])
        self.assertNotIn('REQUEST', query)
        self.assertNotIn('TIME', query)
        self.assertNotIn('WIDTH', query)

    def test_advertised_time_and_stale_rejection(self):
        stamp = (datetime.now(timezone.utc)-timedelta(minutes=20)).replace(microsecond=0).isoformat().replace('+00:00','Z')
        target = datetime.now(timezone.utc).isoformat()
        p = m.plan(capabilities(stamp), target, 30, 'https://example.org/wms')
        self.assertEqual(p['observationTime'], stamp)
        self.assertIn('time=',p['url'])
        self.assertIn('crs=CRS%3A84',p['url'])
        with self.assertRaisesRegex(ValueError,'outside'):
            m.plan(capabilities(stamp), target, 5, 'https://example.org/wms')
        with self.assertRaisesRegex(ValueError,'bounds changed'):
            m.plan(capabilities(stamp,'-31,-77,122,77'),target,30,'https://example.org/wms')
        with self.assertRaisesRegex(ValueError,'unavailable'):
            m.plan(capabilities(stamp).replace('msg_iodc:ir108','other'),target,30,'https://example.org/wms')

    def test_reprojection_orientation_and_limb(self):
        import numpy as np
        from PIL import Image
        # Longitude gradient: east is brighter. Target centre is 45.5E;
        # the WMS bbox centre is 41.5E, so simply resizing would be wrong.
        a=np.zeros((3712,3712,4),dtype=np.uint8)
        v=np.rint(np.linspace(30,230,3712)).astype(np.uint8)
        a[:,:,:3]=v[None,:,None];a[:,:,3]=255
        with tempfile.TemporaryDirectory() as d:
            src=Path(d)/'input.png';out=Path(d)/'output.png'
            Image.fromarray(a).save(src);m.reproject(src,out)
            result=np.asarray(Image.open(out))
            self.assertEqual(result.shape,(5424,5424))
            self.assertEqual(int(result[0,0]),0)
            expected=round(30+(45.5+35.5)/154*200)
            self.assertAlmostEqual(int(result[2712,2712]),expected,delta=1)
            self.assertGreater(int(result[2712,3200]),int(result[2712,2200]))
            # Latitude gradient checks north-up independently.
            a[:,:,:3]=v[:,None,None]
            Image.fromarray(a).save(src);m.reproject(src,out)
            result=np.asarray(Image.open(out))
            self.assertLess(int(result[2200,2712]),int(result[3200,2712]))


if __name__ == '__main__':
    unittest.main()
