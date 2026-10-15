# Photorealistic 3D Lava Lamp

**A classic lava lamp, built entirely from code and rendered live in WebGL.**
Glass vessel, molten wax, brushed-aluminium pedestal, studio and lighting rig —
every pixel is generated at runtime. No meshes, no textures, no HDRIs, no
photographs.

![A photorealistic lava lamp: a tall glass vessel of clear liquid holding
suspended orange wax masses, lit from a warm heater at the base, standing on a
brushed aluminium pedestal with a domed cap, against a warm taupe studio
sweep.](renders/lava-lamp.png)

<sub>2000 × 2700 · rendered by `npm run dev` from `src/main.js`</sub>

Three.js draws it with real refraction, subsurface-scattering shading, image
based lighting and a four-light photographic rig. The wax is an **implicit
surface** — a smooth union of displaced ellipsoids polygonised with marching
cubes — so the masses fuse and deform the way molten wax actually does, rather
than sitting there as a row of spheres.

## What's in the frame

| | |
| --- | --- |
| **Glass** | A hollow revolved shell with 3.2 mm wall thickness, real transmission, refraction and Fresnel edge highlights |
| **Wax** | Implicit-surface masses with chord-length subsurface thickness, a glowing silhouette, and internal marbling |
| **Liquid** | A separate refracting volume with a concave meniscus at the fill line |
| **Metal** | Anisotropic brushed aluminium with a procedural turned grain |
| **Studio** | A softbox rig baked to a PMREM environment map, plus a seamless cyclorama sweep with baked falloff and contact occlusion |


## Running it

```bash
npm install
npm run dev        # http://127.0.0.1:5190
```

Production build:

```bash
npm run build
npm run preview    # http://127.0.0.1:5191
```

Rendering the final still (needs the dev or preview server running):

```bash
node tools/render-final.mjs renders/lava-lamp.png 2000 2700
```

`tools/shoot.mjs <out.png> <w> <h> <query>` is the same thing at preview
resolution and reports the WebGL renderer it got, which is handy when checking
whether a machine fell back to a software rasteriser.

`tools/check-blank.mjs` is a regression test for the page going blank: it loads
the app, resizes the viewport, reloads, and reads the mean luminance straight
out of the WebGL context at each step, so an empty canvas is unambiguous rather
than a judgement call about a screenshot.

## How it is built

### The turned parts

`src/lib/geometry.js` holds every part of the lamp as a 2D *(radius, height)*
profile that is splined through a dozen control points and revolved with
`LatheGeometry`. Nothing is a stock primitive, so the silhouette is fully
art-directable and there are no seams where primitives would meet.

The profiles are authored against a real appliance: the finished lamp stands
**446 mm** tall, the glass vessel is **321 mm** by **85 mm** across its widest
point, and the pedestal is **107 mm** in diameter — all within a few percent of
a 45 cm Mathmos Astro.

The glass is a genuinely hollow shell. Its cross-section is walked bottom face →
outer wall → rim → inner wall → inner floor, with the inner wall produced by
offsetting the outer profile along its own 2D normal, so the 3.2 mm wall
thickness stays constant around the whole taper.

### The wax

The wax is an **implicit surface**, not a set of spheres. `src/lib/wax.js`
smooth-unions a couple of dozen rotated ellipsoids, displaces the result with
two octaves of gradient noise, and polygonises the field with a marching cubes
implementation in `src/lib/marching.js`. That gives genuinely fused, irregular
masses with rounded silhouettes and partial connections, at whatever resolution
you ask for (`?waxres=`).

The polygoniser is a trimmed version of three's own: it works directly in world
space over a cropped sub-grid, skips the normal cache, and grows its vertex
buffers on demand. The cropping is what keeps a 300-node resolution fast — only
the region around the wax is evaluated, roughly 2 % of a full cubic grid.

### Wax shading

`src/lib/materials.js` injects a subsurface layer into a `MeshPhysicalMaterial`.
Two things are worth calling out:

- **Chord-length thickness.** For each blob containing the shading point, the
  distance a light ray travels through it is `2 / |N / r|`. Normalised against a
  reference chord this is 0 on a thin wisp and 1 in the belly of a large mass,
  and it drives the colour ramp from hot gold rim through amber to deep ember
  core. It is evaluated per fragment from the same blob set that defined the
  surface, so it costs nothing at bake time and never bands.
- **Fresnel rim.** Translucent wax has a long optical path at grazing angles, so
  every silhouette glows. That is a separate term from the thickness, and it is
  what stops the masses reading as gummy sweets.

An emissive point source at the bulb adds the internal glow, falling off with
distance and height so the top of the vessel stays cool.

### The studio

`src/lib/environment.js` builds a small emissive softbox rig, bakes it into a
PMREM environment map, and also generates the physical cyclorama the lamp stands
on — a flat floor running into a 1.15 m cove and a wall, with the falloff and a
contact-occlusion pool baked into vertex colours.

The softboxes are deliberately small. A large emitter gives rough metal a flat,
shapeless white field; a tight one gives a highlight that actually describes the
curve of the pedestal.

### Lighting

A four-light photographic rig: a warm key, a cool fill, a cool rim strip behind
for separation from the warm backdrop, and a directional light that carries the
shadow. Inside the lamp there are two warm point lights and a self-lit heating
element, which together produce the glow in the lower chamber and the pool of
warm light on the sweep.

Tone mapping is **Khronos PBR Neutral**. AgX desaturates the highlights towards
cream and ACES shifts the oranges towards yellow; Neutral is the only one of the
three that keeps the wax reading as molten orange.

## Notes from the build

A few things that were not obvious and are worth not re-discovering:

- The wax field stores `-sdf`, following the Bourke/three convention where
  `field < iso` means *outside*. The "far from any blob" sentinel therefore has
  to be a large **negative** value. Seeding it positive makes the polygoniser
  treat the whole background as interior and generates a phantom shell around
  every blob — it is invisible as a shape but it greys out the entire vessel.
- Per-vertex attributes interpolated across ~1 mm triangles make their own
  iso-contours legible as banding. Computing the thickness per fragment removes
  the whole class of artefact.
- A thin glass shell wants `FrontSide` with depth writes on. With `DoubleSide`
  and depth writes off, the inner and outer surfaces blend in index order, which
  both fogs the vessel and leaves hard staircase seams in the neck.
- The obvious `fract( sin( ... ) )` shader hash collapses into visible stripes
  once the input gets large. The wax shader uses a multiply/frac hash instead.

## Query parameters

All optional; the defaults are the art-directed look.

| parameter | default | effect |
| --- | --- | --- |
| `waxres` | `300` | marching cubes resolution across the wax bounds |
| `waxnoise` | `1` | surface displacement multiplier |
| `exposure` | `0.95` | tone mapping exposure |
| `tm` | `neutral` | `neutral`, `agx` or `aces` |
| `bulb` | `1.7` | internal glow strength |
| `fov` | `26` | vertical field of view, degrees |
| `dpr` | device | pixel ratio override |
| `camx` `camy` `camz` | – | explicit camera position (with `tgty`) |
| `tgtx` `tgty` `tgtz` | – | explicit look-at target |

## Layout

```
index.html
src/
  main.js                 scene assembly, lighting rig, camera framing
  lib/
    geometry.js           lathe profiles for every turned part
    wax.js                implicit wax definition and field sampling
    marching.js           world-space marching cubes polygoniser
    materials.js          glass, liquid, brushed metal, subsurface wax shader
    environment.js        softbox rig, PMREM bake, cyclorama sweep
    noise.js              Perlin noise (JS) and value noise (GLSL)
tools/
  render-final.mjs        full-resolution still capture
  shoot.mjs               preview capture
  check-blank.mjs         regression test: page survives resize and reload
  checkProfile.mjs        profile smoothness / wall thickness check
renders/lava-lamp.png     the finished render
```
