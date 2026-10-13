# pyright: reportMissingImports=false
# FreeCAD/Part/Draft/Mesh are provided by the FreeCAD runtime; this script
# is executed inside FreeCAD (see MCP call), not by the system Python.
import contextlib
import os

import Draft
import FreeCAD as App
import Mesh
import Part

OUT_DIR = "/home/roman/Work/wazegame/freecad"
try:  # best-effort; saveAs is the real error path
    os.makedirs(OUT_DIR, exist_ok=True)
except OSError as exc:
    print("makedirs skipped:", exc)

doc = App.newDocument("GameNightsCounter")

def add_box(name, L, W, H, pos):
    o = doc.addObject("Part::Box", name)
    o.Length, o.Width, o.Height = L, W, H
    o.Placement.Base = App.Vector(*pos)
    return o

def add_shape(name, shape):
    o = doc.addObject("Part::Feature", name)
    o.Shape = shape
    return o

# ---------------- Fonts ----------------
FONT = None
for cand in [
    "/usr/share/fonts/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Bold.ttf",
]:
    if os.path.exists(cand):
        FONT = cand
        break

def string_shape(s, size):
    ss = Draft.make_shapestring(String=s, FontFile=FONT, Size=size, Tracking=0)
    sh = ss.Shape.copy()
    doc.removeObject(ss.Name)
    return sh

# ---------------- Frame: base, shelf, backboard ----------------
add_box("Base", 170, 60, 10, (0, 3, 0))
add_box("BaseLip", 170, 4, 6, (0, 0, 6))
add_box("Shelf", 170, 58, 8, (0, 2, 96))
add_box("Backboard", 170, 5, 44, (0, 55, 56))

def flat_text(name, s, size, x, z, depth=1.6, y0=54.99):
    sh = string_shape(s, size)
    bb = sh.BoundBox
    cx = (bb.XMin + bb.XMax) / 2.0
    cy = (bb.YMin + bb.YMax) / 2.0
    sh.translate(App.Vector(-cx, -cy, 0))
    solid = sh.extrude(App.Vector(0, 0, depth))
    solid.rotate(App.Vector(0, 0, 0), App.Vector(1, 0, 0), 90)  # extrude toward -Y
    solid.translate(App.Vector(x, y0, z))
    return add_shape(name, solid)

flat_text("Title1", "NIGHTS GAMED", 12.0, 85, 88)
flat_text("Title2", "THIS YEAR", 12.0, 85, 70)

# ---------------- Odometer wheels (axle along X) ----------------
WHEEL_R = 26.0
AXLE_Z = 48.0
CY = 30.0            # wheel center depth (front of wheel at y = CY-R = 4)
WHEEL_W = 26.0
CENTERS_X = [68, 96, 124]
FRONT = "042"

def cylinder_along_x(r, h):
    c = Part.makeCylinder(r, h)
    c.rotate(App.Vector(0, 0, 0), App.Vector(0, 1, 0), 90)  # axis +Z -> +X
    return c

def digit_solid(ch, size):
    sh = string_shape(ch, size)
    bb = sh.BoundBox
    cxo = (bb.XMin + bb.XMax) / 2.0
    cyo = (bb.YMin + bb.YMax) / 2.0
    sh.translate(App.Vector(-cxo, -cyo, 0))
    return sh.extrude(App.Vector(0, 0, 2.2))

TARGET = list("0123456789")
for i, cx in enumerate(CENTERS_X):
    wheel = cylinder_along_x(WHEEL_R, WHEEL_W)
    wheel.translate(App.Vector(cx - WHEEL_W / 2, CY, AXLE_Z))
    solids = [wheel]
    base_idx = TARGET.index(FRONT[i])
    for k, ch in enumerate(TARGET):
        deg = (base_idx - k) * 36.0
        d = digit_solid(ch, 30.0)
        # orient: glyph plane vertical, top of digit toward +Z, extrude toward -Y (front)
        d.rotate(App.Vector(0, 0, 0), App.Vector(1, 0, 0), 90)
        # move to the front of the wheel (angle 0), slightly recessed
        d.translate(App.Vector(cx, CY - (WHEEL_R - 0.6), AXLE_Z))
        # revolve around the wheel X-axis to its angular slot
        d.rotate(App.Vector(cx, CY, AXLE_Z), App.Vector(1, 0, 0), deg)
        solids.append(d)
    fused = solids[0]
    for s in solids[1:]:
        with contextlib.suppress(Exception):
            fused = fused.fuse(s)
    add_shape(f"Wheel{i}", fused)

# axle
axle = cylinder_along_x(3.0, 104)
axle.translate(App.Vector(96 - 52, CY, AXLE_Z))
add_shape("Axle", axle)

# housing sides
add_box("HousingL", 6, 56, 60, (CENTERS_X[0] - WHEEL_W / 2 - 6, 2, AXLE_Z - 30))
add_box("HousingR", 6, 56, 60, (CENTERS_X[-1] + WHEEL_W / 2,     2, AXLE_Z - 30))

# ---------------- Mini game cartridges ----------------
def cartridge(x, y, z, h=30.0, w=7.0, t=5.0, tilt=0.0):
    body = Part.makeBox(w, t, h)
    label = Part.makeBox(w - 2.0, 0.8, h * 0.45)
    label.translate(App.Vector(1.0, -0.81, h * 0.45))
    sh = body.fuse(label)
    if tilt:
        # lean like the last book in the photo
        sh.rotate(App.Vector(0, 0, 0), App.Vector(0, 1, 0), 0)  # noop for clarity
        sh.rotate(App.Vector(0, 0, z), App.Vector(0, -1, 0), tilt)
    sh.translate(App.Vector(x, y, z))
    return add_shape(f"Cart_{int(x * 10)}", sh)

# row on the top shelf (right side)
xs = 96.0
for j, hh in enumerate([26, 30, 28, 32, 27, 30]):
    cartridge(xs + j * 9.0, 14.0, 104, h=hh)
cartridge(xs + 6 * 9.0 + 2, 14.0, 104, h=30.0, tilt=-16)

# small row at the bottom, left of the counter
for j, hh in enumerate([20, 22, 21, 23, 20]):
    cartridge(8 + j * 8.4, 14.0, 10, h=hh, w=6.6)

doc.recompute(None, True, True)

fcstd = os.path.join(OUT_DIR, "GameNightsCounter.FCStd")
doc.saveAs(fcstd)

objs = [o for o in doc.Objects if hasattr(o, "Shape")]
Mesh.export(objs, os.path.join(OUT_DIR, "GameNightsCounter.stl"))
print("OBJECTS:", len(objs))
print("SAVED:", fcstd)
