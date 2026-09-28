"""Extract only the exact requested thermal channel; never extract archive paths."""
import sys
import zipfile
from pathlib import Path

archive, destination, name = sys.argv[1:]
with zipfile.ZipFile(archive) as z:
    matches = [i for i in z.infolist() if i.filename == name]
    if len(matches) != 1 or matches[0].file_size > 100 * 1024 * 1024:
        raise ValueError("Expected one bounded full-resolution channel 9 JPEG")
    data = z.read(matches[0])  # Includes CRC validation.
    Path(destination).write_bytes(data)
