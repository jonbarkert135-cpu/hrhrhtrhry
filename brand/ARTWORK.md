# Raven brand artwork

The silver mark and hero are original generated adaptations of Raven's existing emblem,
created for this repository on 2026-10-29. PNG sizes serve the app icon and favicon;
the WebP hero is self-hosted and has no runtime renderer or external service.

`raven-workspace-preview.png` is a screenshot of the actual local application using fictional
example data. It is illustrative, not a live investigation or a claim about connected sources.

The rotating emblem is an original closed 3D relief derived from the Raven mark.
Regenerate its indexed position/normal buffer with `python scripts/artwork/raven-sculpture.py`
using Pillow, NumPy and SciPy as build tooling. The browser loads the bounded binary mesh
and a small WebGL renderer only when the visible hero permits motion; no 3D runtime dependency.
