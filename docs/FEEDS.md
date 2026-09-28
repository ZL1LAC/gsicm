# Feed verification

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

## Remaining regional blockers

Europe/Africa and the Indian Ocean remain disabled in the built-in coverage profile. EUMETSAT's current Data Store requires a user account and licensing for Meteosat datasets, so it does not meet the account-free preset requirement. NOAA's Meteosat Indian Ocean page provides rendered viewer imagery, but the published images contain annotations and do not expose a timestamped, clean full-disc download template. These sources need a verified public raster or an approved decoder before they can be added.

## Enabling a source

### Elektro-L verified integration (29 September 2026)

The manager downloads the timestamped ZIP, extracts only MSU-GS thermal channel 9, validates CRC and 2784 x 2784 geometry, and preserves its filename for Sanchez's Electro parser. Loose JPEGs are 1080-pixel previews. There is no requirement to combine all nine wavelengths.

FTP folders and filenames use Moscow UTC+3: /ELECTRO_L_3/2026/September/10/0730/ is 04:30 UTC. Discovery aligns to half-hour slots, converts the date before constructing month/day folders, and tolerates missing directories. This follows [Sanchez's Electro parser](https://github.com/nullpainter/sanchez/blob/master/Sanchez.Processing/Services/Filesystem/Parsers/ElectroFilenameParser.cs).

Bundled IR settings: N2 longitude -14.5, brightness 1.2; N3 longitude 76, brightness 1.3; both invert true and crop 0.012703 on each side. These are configured definitions, not orbital metadata in the JPEG. No extra scientific reprojection is required for this supported input.

Both passed live FTP acquisition and real Sanchez map rendering using scripts/test-elektro-live.ts. Outputs and logs are in data/elektro-live-verification. N2 has recent data. At verification, the N3 September directory contained days 01-10 only. N3 remains excluded from today's main stitch; use Sources > Test archive time for its historical data.

Allow up to 300 MB and 300 seconds for archives. The extractor uses Python's standard library in the installed decoder environment, reads only the exact channel-9 member, checks CRC and size, and never extracts archive paths.

1. Obtain an account-free rendered full-disc IR product with known observation timestamps and satellite geometry.
2. Configure an HTTP image URL template, anonymous FTP/explicit FTPS directory, or public S3 bucket/prefix. Use a narrow filename selection expression.
3. Set the timestamp capture expression and UTC format, dimensions, sub-satellite longitude, intensity direction, and crop fractions (top, right, bottom, left).
4. Save and test. Open the downloaded preview. Verify that the entire disc, orientation, crop, and intensity are appropriate and there are no baked-in labels or coastlines.
5. Check the clean-image confirmation, enable, save, and test again. Changing acquisition or geometry configuration resets validation.
6. Assign sources with distinct satellite identities to a profile. Every assigned source is required. Regional profiles do not become globally complete merely because every configured input is present.

Geostationary imagery does not provide polar coverage. A full-sized world canvas includes static underlay outside observed regions; it is not evidence of fresh cloud observations everywhere.

[Sanchez satellite identification](https://github.com/nullpainter/sanchez/wiki/Satellite-identification) explains the definitions generated by the manager. The supplied executable and resources are preserved.
