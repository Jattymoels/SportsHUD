# Techniques, data sources and parked ideas

Design thinking behind the spec, plus ideas that didn't make Checkpoint 1. Items marked **unverified** are from general knowledge and need checking before use.

## Techniques for the hard behaviours

### A stable ghost at close range (B3)

The problem: phone GPS is typically off by several metres. If the ghost and the runner are both placed by raw coordinates, a ghost five metres ahead jumps around.

The approach:

- **Reduce the problem to one dimension.** Snap the runner's position to the known route and work in distance along the route. Error across the path disappears, and the error that remains is along the path.
- **Place the ghost by gap, not by coordinates.** The ghost's position is "the runner's distance along the route, plus the gap". It never depends on the ghost's own raw GPS noise at that moment.
- **Draw the ghost from the route's direction.** The bearing to the ghost is the bearing of the route ahead, read from the route file. Only the wearer's head heading comes from a live sensor.
- **Smooth the gap.** The gap between two runners changes slowly, so a short smoothing window is safe.

What can still go wrong: routes that double back or cross themselves confuse snapping. Snap forward from the last known position, not to the nearest point on the whole route.

### Heading-anchored markers (B4, B9)

The glasses have no spatial tracking, but they do have a compass. With position and heading, a marker can be drawn in the right direction for a target at a known location.

- **Works best for distant targets.** At 150 m, a 5 m position error moves the bearing by about 2°. At 10 m, the same error moves it by about 27°. Use it for greens, hazards, the next kilometre marker or the finish, not for nearby objects.
- **Needs calibration.** Prior art uses a short flow: look at the horizon, face a known direction, then centre and edge a distant point to measure the viewing cone. Save the result.
- **Needs smoothing.** Combine compass heading with gyroscope rate to steady the marker during head bob.
- **Needs an off-screen cue.** The display covers about 20°, so the target is usually outside it. Show an edge arrow with the angle to turn.
- **Magnetic interference is a risk.** Metal and electronics distort compass readings. Measure it; a golf buggy or bike frame may matter.

True surface-locked graphics would need the camera, which means the native toolkit. That is parked for a later checkpoint.

### Glanceable and silent (B10)

- One primary number per screen, large, with at most two secondary values.
- Thin bright strokes on black, since black is transparent.
- Auto-hide when the head tilts down to address a golf ball, using the tilt reading. Restore when the head comes back up.
- No sound and no speech by default.

## Data sources

| Need | Source | Notes |
| --- | --- | --- |
| Recorded tracks | GPX files exported by the user from Strava or Garmin | The user's own data; no API terms involved |
| Water points | OpenStreetMap, `amenity=drinking_water` | **Unverified** tag; coverage varies by area and is what B6 measures |
| Toilets | OpenStreetMap, `amenity=toilets` | **Unverified** tag |
| Golf course features | OpenStreetMap, `golf=green`, `golf=bunker`, `golf=fairway`, `golf=tee`, `golf=hole` | **Unverified** tags. Check coverage of the candidate test courses, Grange and West Beach in Adelaide, before choosing |
| Querying OpenStreetMap | The Overpass API | **Unverified**. Fetch once per route or course and cache locally |
| Climb | Elevation values in the GPX file | Phone GPS elevation is noisy; smooth it |
| Wind | A free forecast service such as Open-Meteo | **Unverified**. Forecast for the location, not wind measured on the course |
| Live heart rate | Not available to a web app | Garmin's cloud API appears to deliver data only after sync (**unverified**). Needs a watch data field or Bluetooth through a native app |

OpenStreetMap data requires attribution. A commercial golf product would need licensed course data.

## Golf ideas

In Checkpoint 1:

- **Landing zone by club.** The user enters a carry distance per club. Selecting a club draws the landing area on a top-down hole view, shifted by wind.
- **Look to range.** Look toward a mapped bunker or green and see its name and distance.
- **Silent by design.** Glance-only, hiding at address.

Parked:

- **Ghost round.** Play hole by hole against your previous round on the same course. This ties golf to the running ghost as one product idea: race your past self.
- **Learned club distances.** Measure each shot from where the player stops to where they next stop, and build per-club distances over time.
- **Miss pattern, not a dot.** Show the player's typical spread for the club.
- **Plays-like distance.** Adjust for elevation, wind and temperature.
- **Competition mode.** Distances only, for rounds where advice isn't allowed.
- **Pace-of-play timer** and group scoring by gesture.

## Running and pace-sport ideas

In Checkpoint 1:

- **Any pace sport.** A ghost is a recorded track, so running, cycling, rowing, skiing, hiking and paddling share one engine.
- **Route preview.** Distance, climb, water, toilets and pause points before starting.
- **Distance markers and turns** as heading-anchored cues.

Parked:

- **Target-pace ghost.** A ghost that runs an even pace or a planned split, with no recording needed.
- **Racing friends.** Needs own accounts and backend; Strava's terms rule out using its data for this.
- **Game mechanics.** Coins for holding pace, sprint zones, leaderboards.
- **Auto pause points.** Detect regular stops such as traffic lights from past runs.
- **Live heart rate and zones.** Needs the native path.

## Later checkpoints

- **Camera-based alignment** through the native toolkit, for graphics that lock to the ground.
- **Other glasses.** ENGO and Android XR devices, using the same engine.
- **Voice control** through Meta's WebMCP, for starting a run or picking a club hands-free.
