# Published image caption

The publishing step uses the white caption-band design from the supplied
`overlayer.py`, rendered with the server's existing Sharp dependency.

The band sits above the map or globe and includes the profile name, target UTC
time, included satellite names in black, and individual observation UTC times.
Other configured satellites with a real feed location appear in red as
`(not included)`. Empty coverage placeholders are excluded from the caption.
This list does not imply that an omitted satellite was required for the job.

The band increases the published image height; the geographic image retains its
original dimensions below it. Captions apply automatically to new successful
manual and scheduled compositions. Output validation and atomic publication
still happen after caption rendering, preserving the previous output on failure.

The standalone Python GUI and its image filename guesses are not required.
Satellite names and observation times come from the manager's acquired input set.
