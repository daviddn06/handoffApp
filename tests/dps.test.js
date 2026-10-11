import test from "node:test";
import assert from "node:assert/strict";
import { DPS_UPC_PATROL_ZONE as points } from "../src/lib/dps.ts";

// Independent sample locations on either side of the streets in USC's route.
function contains([lat, lng]) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [aLat, aLng] = points[i];
    const [bLat, bLng] = points[j];
    if (
      aLat > lat !== bLat > lat &&
      lng < ((bLng - aLng) * (lat - aLat)) / (bLat - aLat) + aLng
    ) inside = !inside;
  }
  return inside;
}

test("UPC patrol coverage follows the diagonal and stepped street boundaries", () => {
  const locations = [
    ["USC campus", [34.0224, -118.2851], true],
    ["south of Washington and west of Grand", [34.031, -118.2704], true],
    ["north of the diagonal Washington boundary", [34.038, -118.274], false],
    ["east of Grand above Jefferson", [34.0257, -118.27], false],
    ["between Grand and Hill above 37th", [34.018, -118.277], true],
    ["east of Hill above 37th", [34.018, -118.274], false],
    ["north of MLK inside Exposition Park", [34.0114, -118.29], true],
    ["south of MLK", [34.0104, -118.288], false],
    ["west of Normandie", [34.03, -118.3005], false],
    ["east of Normandie", [34.03, -118.2998], true],
    ["south of 39th and east of Figueroa", [34.0125, -118.281], false],
  ];
  for (const [name, point, expected] of locations)
    assert.equal(contains(point), expected, name);
});

test("UPC trace preserves the 39th Street bend and latitude-longitude contract", () => {
  assert.equal(points.length, 17, "16 turns plus the Flower Street bend");
  assert(points.every(([lat, lng]) => lat > 34 && lat < 34.05 && lng > -118.31 && lng < -118.26));
  assert.notDeepEqual(points[0], points.at(-1), "the renderer supplies the closing point");
  const [grand, flower, figueroa] = points.slice(12, 15);
  assert(grand[1] > flower[1] && flower[1] > figueroa[1], "39th continues west");
  assert(flower[0] > grand[0] && figueroa[0] > flower[0], "39th turns toward Figueroa");
  const firstSlope = (flower[0] - grand[0]) / (flower[1] - grand[1]);
  const secondSlope = (figueroa[0] - flower[0]) / (figueroa[1] - flower[1]);
  assert(Math.abs(firstSlope - secondSlope) > 0.1, "Flower retains the bend, rather than a straight shortcut");
});

test("UPC patrol polygon has no crossing boundary segments", () => {
  const side = (a, b, c) => (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const a = points[i], b = points[(i + 1) % points.length];
      const c = points[j], d = points[(j + 1) % points.length];
      const crosses = side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
      assert.equal(crosses, false, `segments ${i} and ${j}`);
    }
  }
});
