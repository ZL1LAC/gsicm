# Feed verification

15 November 2026: remove Electro-L No.2 from the weather-source presets and existing profiles following the reported handover of imaging and DCP services to No.3 on 26 October. No.3 now uses longitude 14.5°W instead of 76°E. No.2 may still transmit GGAK space-weather telemetry; this change does not assert complete spacecraft shutdown. Historical imagery and acquisition support are retained.

N3 sources configured at 14.5°W reject observations before 27 October 2026 UTC, including cached raw and RGB images. The exact UTC handover time is unknown, so 26 October is excluded too. Earlier N3 observations require a separate source configured with verified historical geometry; they cannot be rendered using the current longitude.

Live recheck 11 November 2026: N3 has resumed current ZIP publication. The manager downloaded `/ELECTRO_L_3/2026/November/11/0530/261111_0530.zip`, extracted and validated its 2784 × 2784 channel 9 observation at 02:30 UTC, and enabled N3 for the Global map optional inputs. N2 remains enabled, but its latest published folder is `/ELECTRO_L_2/2026/October/26/0900/` (06:00 UTC); no November directory exists. Discovery now includes quarter-hour slots seen in the N3 archive. The September verification below is historical.

Updated 29 September 2026. GOES-18/19, GK2A, Himawari-9 and Elektro-L N2 have passed live acquisition and Sanchez processing. Elektro-L N3 passed historical processing, but its public archive currently has no recent observations. Legacy regional entries remain placeholders.

Update: clean rasters have now been generated from public raw-data samples and tested with Sanchez for [GK2A](GK2A-TEST.md), [GOES-18, GOES-19, and Himawari-9](GOES-HIMAWARI-TESTS.md). The manager now downloads and decodes these four public AWS products. The rejected rendered-image candidates below remain unsuitable.

## Public rendered candidates inspected

- **Americas:** [NOAA STAR GOES-19 Band 13](https://cdn.star.nesdis.noaa.gov/GOES19/ABI/FD/13/1808x1808.jpg) returned HTTP 200, JPEG, 1808 × 1808. Visual inspection showed embedded national/state boundaries, colour enhancement, a NOAA logo, and a timestamp banner. Rejected as clean greyscale input. [GOES viewer](https://www.star.nesdis.noaa.gov/GOES/fulldisk.php?sat=G19).
- **Asia-Pacific:** [SSEC Himawari-9 channel 13](https://www.ssec.wisc.edu/data/geo/images/himawari09/latest-himawari09_13_fd.gif) returned HTTP 200, single GIF, 1100 × 1100. Coastlines and a text banner are embedded. Rejected. The inspected banner also showed an observation older than the retrieval date; HTTP success does not establish freshness.
- **Europe/Africa:** [SSEC Meteosat prime channel 9](https://www.ssec.wisc.edu/data/geo/images/met-prime/latest_met-prime_09_fd.gif) returned HTTP 200, single GIF, 1240 × 1240. Coastlines, boundaries, and a text banner are embedded. Rejected.
- **Indian Ocean:** [SSEC Meteosat IODC channel 9](https://www.ssec.wisc.edu/data/geo/images/met-iodc/latest_met-iodc_09_fd.gif) returned HTTP 200, single GIF, 1240 × 1240. Coastlines, boundaries, and a text banner are embedded. Rejected.

These `latest` URLs also lack an observation timestamp in the filename. They are research references, not templates suitable for the timestamp parser. The manager intentionally does not substitute HTTP Last-Modified or download time.

## AWS products

[NOAA's GOES AWS registry](https://registry.opendata.aws/noaa-goes/) documents anonymous access to GOES-18/19 buckets. The manager decodes the selected scientific products into clean rasters before invoking Sanchez.

## Meteosat-9 IODC via EUMETView (16 November 2026)

Live testing found an account-free clean rendered alternative to the annotated NOAA/SSEC images: [EUMETView IR10.8 IODC](https://view.eumetsat.int/productviewer/productDetails/msg_iodc:ir108?v=default). [EUMETSAT describes Meteosat-9 at 45.5°E and a 15-minute cadence](https://www.eumetsat.int/msg-services).

The public [WMS capabilities](https://view.eumetsat.int/geoserver/wms?service=WMS&request=GetCapabilities&version=1.3.0) advertised layer `msg_iodc:ir108`, a default observation of `2026-11-16T05:45:00Z`, and a 15-minute time interval. An unauthenticated GetMap for `2026-11-16T05:30:00Z` returned HTTP 200 and a 1000 × 1000 PNG. Visual inspection found greyscale cloud imagery without labels, borders, coastlines, or logos. A second request at 3712 × 3712 also returned HTTP 200 and a PNG (9,162,029 bytes).

Reproducible request parameters for `https://view.eumetsat.int/geoserver/wms`:

```text
service=WMS
request=GetMap
version=1.3.0
layers=msg_iodc:ir108
styles=
crs=CRS:84
bbox=-35.5,-77,118.5,77
width=1000
height=1000
format=image/png
transparent=true
time=2026-11-16T05:30:00Z
```

This is a geographically projected image, not a native geostationary full disc. The `eumetview-iodc` product now acquires it and reprojects it to the 5424 × 5424 Sanchez sweep-X grid at 45.5°E; configuring it as a generic full-disc raster would give incorrect geometry. Install the source using the existing preset installer. It uses the same Python decoder environment as the AWS products. The advertised geographic bounds above are service metadata and must not be used to infer the satellite longitude. Capabilities advertise `nearestValue=1`, so acquisition uses only the explicitly advertised latest default observation and rejects it outside the requested time tolerance. Historical interval slots are not inferred. The test establishes public image access, not calibrated brightness temperatures, a service availability guarantee, or calibrated equivalence with the raw AWS temperature stretch. A WCS 2.0.1 DescribeCoverage attempt at `/geoserver/ows` returned HTTP 404.

## Remaining regional blockers

The original rendered-image candidates below remain unsuitable. The EUMETView candidate above now provides a publicly accessible clean image, with acquisition and reprojection support implemented. EUMETSAT's Data Store requires a user account and licensing for Meteosat datasets, so it does not meet the account-free preset requirement. NOAA's Meteosat Indian Ocean page provides rendered viewer imagery, but the published images contain annotations and do not expose a timestamped, clean full-disc download template. These sources need a verified public raster or an approved decoder before they can be added.

## Enabling a source

### Elektro-L verified integration (29 September 2026)

The manager downloads the timestamped ZIP, extracts only MSU-GS thermal channel 9, validates CRC and 2784 x 2784 geometry, and preserves its filename for Sanchez's Electro parser. Loose JPEGs are 1080-pixel previews. There is no requirement to combine all nine wavelengths.

FTP folders and filenames use Moscow UTC+3: /ELECTRO_L_3/2026/September/10/0730/ is 04:30 UTC. Discovery aligns to quarter-hour slots, converts the date before constructing month/day folders, and tolerates missing directories. This follows [Sanchez's Electro parser](https://github.com/nullpainter/sanchez/blob/master/Sanchez.Processing/Services/Filesystem/Parsers/ElectroFilenameParser.cs).

Bundled IR settings: N2 longitude -14.5, brightness 1.2; N3 longitude 76, brightness 1.3; both invert true and crop 0.012703 on each side. These are configured definitions, not orbital metadata in the JPEG. No extra scientific reprojection is required for this supported input.

Both passed live FTP acquisition and real Sanchez map rendering using scripts/test-elektro-live.ts. Outputs and logs are in data/elektro-live-verification. N2 has recent data. At verification, the N3 September directory contained days 01-10 only. N3 remains excluded from today's main stitch; use Sources > Test archive time for its historical data.

Elektro-L N4 publishes 11136 x 11136 full-disc RGB VIS/IR JPEG composites rather than the N2/N3 channel ZIP archives. The manager treats it as `elektro-rgb`, downloads `*_original_RGB_VIS_IR.jpg`, stages an Electro-parser filename for Sanchez, and uses longitude 165.8, brightness 1, invert false, and the same crop. Live FTP acquisition and Sanchez map rendering passed using `npm run test:elektro4`; outputs are in `data/elektro4-live-verification`.

Allow up to 300 MB and 300 seconds for archives. The extractor uses Python's standard library in the installed decoder environment, reads only the exact channel-9 member, checks CRC and size, and never extracts archive paths.

1. Obtain an account-free rendered full-disc IR product with known observation timestamps and satellite geometry.
2. Configure an HTTP image URL template, anonymous FTP/explicit FTPS directory, or public S3 bucket/prefix. Use a narrow filename selection expression.
3. Set the timestamp capture expression and UTC format, dimensions, sub-satellite longitude, intensity direction, and crop fractions (top, right, bottom, left).
4. Save and test. Open the downloaded preview. Verify that the entire disc, orientation, crop, and intensity are appropriate and there are no baked-in labels or coastlines.
5. Check the clean-image confirmation, enable, save, and test again. Changing acquisition or geometry configuration resets validation.
6. Assign sources with distinct satellite identities to a profile. Every assigned source is required. Regional profiles do not become globally complete merely because every configured input is present.

Geostationary imagery does not provide polar coverage. A full-sized world canvas includes static underlay outside observed regions; it is not evidence of fresh cloud observations everywhere.

[Sanchez satellite identification](https://github.com/nullpainter/sanchez/wiki/Satellite-identification) explains the definitions generated by the manager. The supplied executable and resources are preserved.

IODC regression checks run as part of `npm test` when the decoder environment is installed, or directly with `.venv-gk2a/bin/python tests/eumetview_test.py`. They cover stale/missing metadata, changed geographic bounds, grid location, orientation, and the satellite limb. The WMS image is a rendered greyscale visualization, not recovered scientific temperatures. Its published geographic bounds stop at 77° latitude, so polar coverage remains incomplete.

Live integration verification on 16 November 2026: the acquisition module downloaded the advertised 05:45 UTC IODC observation, converted it successfully, and Sanchez rendered it with the existing five satellite inputs. Visual inspection of a six-source render with the 05:30 UTC sample confirmed that the Indian Ocean/Antarctic wedge was filled. The running Global map profile now requires `eumetview-iodc`; the verified six-source composite was published and the service restarted successfully. The live environment allows a 300-second download timeout; full-resolution WMS downloads can take several minutes.
