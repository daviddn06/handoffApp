# USC University Park patrol boundary

Checked September 14, 2026 against USC's [DPS patrol directions](https://dps.usc.edu/patrol/) and the boundary coordinates published by the [USC Housing interactive map](https://housing.usc.edu/index.php/interactive-map/).

`src/lib/dps.ts` uses the Housing page's `layers.dps` coordinates. Their order is rotated to begin at Vermont and Exposition, and the repeated closing coordinate is omitted because `Map.tsx` closes the GeoJSON ring. Latitude precedes longitude in the source array. MapLibre receives longitude first.

The route follows Exposition, Normandie, Adams, Vermont, 22nd, Hoover, Washington, Grand, Jefferson, Hill, 37th, Grand, 39th, Figueroa, Martin Luther King Junior, and Vermont. The extra point at 39th and Flower retains the street's bend. Washington and Grand are diagonal, not horizontal and vertical lines.

The prior trace approximated the intersections using repeated latitude and longitude values. It shifted the east side substantially, left out part of the northeast and southern extent, and extended west beyond Normandie. Its claim of five-meter accuracy was unsupported and has been removed.

The corrected coordinates were independently compared with OpenStreetMap street intersections. The 16 turn locations fall within 24 meters of the corresponding intersections, allowing for divided roads. The Flower point lies on the 39th Street bend. These are published map coordinates, not a surveyed parcel boundary. Do not infer that listings inside the zone are inspected or guaranteed safe.

Only the UPC overlay is configured. Other campuses retain their existing maps. No patrol filtering or listing eligibility rule was added.

Regression checks cover the diagonal east/northeast edges, the southern extent near MLK, the western limit at Normandie, the 39th/Hill step, coordinate ordering, and polygon self-intersection. Source snapshots and rendered map evidence are in the Handoff zone's `deliverables/dps-boundary-2026-09-14` directory.
