# SportsHUD: Product Spec

As of 2026-11-11. "SportsHUD" is a placeholder name.

This spec defines a ghost-racing and golf heads-up display (HUD) for smart glasses. Its first checkpoint is proving the core behaviours in software, before any hardware spend or funding ask.

## Goal

Prove, in working software, the behaviours that current products don't deliver, then use that proof to seek funding.

The bet is that nobody has shipped a polished pace-sport or golf product on a mainstream display glass. Existing efforts are hobby web apps, audio-only integrations, or dedicated niche hardware. The hard parts are known constraints: graphics that sit in the right place in the world, a ghost that feels real at close range, and golf guidance that is silent and glanceable.

Checkpoint 1 succeeds if each behaviour in this spec either passes its target or fails with a clear, measured reason. Both outcomes are useful evidence for an investor conversation.

## Product scope

The product has three pillars that share one engine: your position against a known track or map, shown at a glance.

| Pillar | What it does | In Checkpoint 1 | Later |
| --- | --- | --- | --- |
| Ghost race | Race a recorded GPS track in any pace sport: running, cycling, rowing, skiing, hiking, paddling | Live gap to the ghost, ghost marker, sport-agnostic track replay | Racing friends, leaderboards, game mechanics |
| Route guide | Shows the route before you start and guides you along it | Preview with distance, climb, water, toilets and pause points; distance markers and turns | Route discovery, sharing, live heart rate |
| Golf HUD | Silent, glanceable course guidance | Green distances, landing zone by club, wind, look-to-range | Ghost round, learned club distances, miss pattern |

**Out of scope for Checkpoint 1:** user accounts and any backend, live heart rate, camera-based features, publishing through Meta, payments, and other glasses platforms.

## Checkpoint 1: behaviours to prove

Ten behaviours, each with a test and a pass target. The targets are proposals to adjust, not measured benchmarks.

"Desk" means the browser simulator with replayed data. "Phone" means the same web app in a phone browser outdoors, standing in for the glasses.

| ID | Behaviour | How we test it | Proposed pass target | Tested on |
| --- | --- | --- | --- | --- |
| B1 | Live time and distance gap to a recorded track | Replay two recordings of the same route; compare the live gap with the gap computed afterwards | Within 3 seconds of the computed gap; updates every second | Desk, then phone |
| B2 | One engine for any pace sport | Replay a run, a ride and a walk with no sport-specific code | All three pass B1 | Desk |
| B3 | Stable ghost at close range | Place the ghost by gap along the route, not raw GPS; run against an own track and record the screen | No jump over 2 m between updates at steady pace | Phone |
| B4 | Heading-anchored markers for distant targets | Compare the marker's direction with a surveyed bearing while standing, walking and running | Median error under 5° standing and walking, under 10° running | Phone, then glasses |
| B5 | Off-screen cue when the target is outside the 20° display | Simulator with orientation overrides | Tester turns the right way in 10 of 10 trials | Desk |
| B6 | Route preview with water, toilets, climb and distance | Three local routes checked against the ground | At least 80% of known water points and toilets shown | Desk, then phone |
| B7 | Golf distances to front, centre and back of green | Compare with a laser rangefinder or course markers on one mapped course | Within 5 m on 9 of 10 readings | Phone |
| B8 | Landing zone for the selected club, shifted by wind | Check against a hand calculation, then sanity-check on course | Zone centre within 2 m of the club's carry before wind; wind moves it the correct way | Desk, then phone |
| B9 | Look-to-range: look at a mapped feature, see its distance | Look at ten features on course | Correct feature in 8 of 10 when features are 15° or more apart | Phone, then glasses |
| B10 | Glanceable and silent | Simulator review of every screen; tilt test for auto-hide at address | Key number read within 2 seconds; display hides within 1 second of looking down | Desk, then glasses |

## Pace ghost

Added 2026-11-11. This is the main differentiator for now, though not the main product.

The ghost does not have to be a recording of the route being run:

| Ghost | Good for | How it runs |
| --- | --- | --- |
| A set pace | Consistent running | Holds the pace on whatever route is run |
| A past run on the same route | Pacing particular parts, such as hills or congestion | Replays the recording, as in B1 |
| A friend's run or a personal best on the same route | Racing | Replays the recording, as in B1 |
| A past run carried onto a different route | Its ups and downs no longer line up with anything there | Falls back to a set pace: that run's average |

**Live segments.** Where the route being run overlaps a stretch that a recorded ghost has run, in the same direction, that stretch switches to the recording's own pacing, and the set pace covers everything else. The gap carries on through each switch rather than jumping (agreed 2026-11-12). Built in the engine and the desk harness, and used by the phone app whenever a saved run is raced: off that run's route, a ghost at its average pace stands in. Which recording wins where two overlap is left for later: for now, the first in the list.

Two more behaviours follow. The targets are proposals, like the others.

| ID | Behaviour | How we test it | Proposed pass target | Tested on |
| --- | --- | --- | --- | --- |
| B11 | Live gap to a ghost holding a set pace, on any route | Replay a recording against a set pace; compare the live gap with the gap computed afterwards, and the distance measured with the watch's own figure | Within 3 seconds of the computed gap; distance within 1% of the watch's | Desk, then phone |
| B12 | Live segments: a recorded ghost takes over where routes overlap | Replay a run that shares part of its route with a recorded ghost | Switches within 5 seconds of joining and 7 seconds of leaving the shared stretch; no jump in the gap at either switch | Desk, then phone |

## Constraints

### Attacked through prototyping

| Constraint | Approach | Proven by |
| --- | --- | --- |
| GPS error makes close objects jumpy | Snap position to the known route and place the ghost by gap along it | B3 |
| Web apps have no spatial-anchor API, so graphics can't be pinned to surfaces | Heading-anchored markers from GPS plus the glasses' dedicated compass, with a calibration step | B4, B9 |
| Compass noise and head bob while moving | Smooth heading with gyroscope data and measure the error | B4 |
| The display covers only 20° of view | Edge cues for off-screen targets and one-number screens | B5, B10 |
| Free map data has uneven coverage | Measure it on local routes and one course before relying on it | B6, B7 |

### Designed around

| Constraint | What we do instead |
| --- | --- |
| Web apps get no camera or microphone; these need the native phone-app path | Defer camera-based alignment, the route to true anchoring, to a later checkpoint |
| No Bluetooth access was found for web apps, so no live heart rate | Defer heart rate to the native path |
| The display glasses are not sold in Australia and aren't built for sport | Use a phone as stand-in for Checkpoint 1; import a pair for Checkpoint 2 |
| Strava bars apps from showing a user's data to others | Friend racing uses our own recordings and backend, later |
| Club advice and wind are likely not allowed in competition golf (Rule 4.3, unverified) | A competition mode that shows distances only |
| Meta's partners could ship similar features, and Meta isn't taking submissions yet | Keep the engine portable across glasses platforms |

## Prototype builds

Five builds, in this order, cover all ten behaviours. Each is tested at the desk first, then outdoors on a phone.

1. **Track engine and replay harness.** Reads a GPS recording, snaps positions to the route, and computes distance along it and the gap between two recordings. Replays any recording at the desk. Proves B1 and B2. Everything else depends on it.
2. **Ghost race screen.** A 600×600 display showing the gap in seconds and metres, a ghost marker ahead or behind, and current pace. Proves B3 and B10.
3. **Anchoring probe.** A test screen that places a marker toward a chosen target and logs compass heading, position and marker error. Proves B4 and B5, and tells us early whether anchored graphics are good enough for builds 4 and 5.
4. **Route guide.** A pre-start preview and a next-marker cue, using OpenStreetMap for water points and toilets. Proves B6. *Started 2026-11-12 with the part that needs no map: distance, climb, turns, pause points and distance markers worked out from past runs of the route, shown as the pre-start screen and as cues. Water and toilets are not built, so B6 is untested.*
5. **Golf HUD.** One mapped course: green distances, a club picker that draws the landing zone, wind, look-to-range, and auto-hide at address. Proves B7 to B10. *Started 2026-11-12 on a made-up hole at the desk: the maths for all four and three first screens. At the desk, B8 passes (zone centre on the club's carry before wind; wind moves it the correct way) and the display hides 0.3 s after looking down against B10's 1 s. B7 and B9 need a mapped course, so they are untested, as is the 2-second read in B10. The Grange's 18 mapped holes were added the same day, with position, compass and tilt from the phone, so B7 and B9 can now be tested on the course.*

Each behaviour ends with a short written result: the measured number, pass or fail, and what it means for the design.

## Technical approach

Checkpoint 1 is a static web app with no backend, so the same code runs in the simulator, a phone browser and the glasses.

| Area | Choice | Notes |
| --- | --- | --- |
| App type | Web app in HTML, CSS and JavaScript at 600×600 | Black is transparent on the additive display, so screens are thin bright strokes on black |
| Input | Arrow keys and Enter | This is how the glasses deliver wristband and touchpad input to a web app |
| Position | Standard browser geolocation (`navigator.geolocation.watchPosition`) | On the glasses, location comes from the paired phone |
| Heading and tilt | Standard `deviceorientation` and `devicemotion` events | Compass, accelerometer and gyroscope are exposed |
| Storage | Browser local storage | Holds tracks, club distances and calibration; no accounts |
| Tracks | GPX files the user exports from their own Strava or Garmin account | Avoids API terms during prototyping |
| Map data | OpenStreetMap: water, toilets, greens, bunkers, fairways | Free with attribution; a commercial golf product would need licensed course data |
| Wind | A free forecast service | Forecast for the location, not measured on course |
| Code and hosting | A GitHub repository, served by GitHub Pages | Gives version control and the public URL the glasses need |
| Build tooling | Claude Code sessions against the repository | Meta publishes a starter kit and AI coding skills for web apps |
| Testing | Meta's browser simulator, Chrome sensor overrides, the replay harness, and unit tests on recorded tracks | Lets every behaviour be re-run after a change |

The engine (track maths, snapping, bearings, landing zones) is a plain library with no display code. That keeps it portable to other glasses and to a native phone app later.

Suggested repository layout: `engine/`, `apps/ghost/`, `apps/probe/`, `apps/route/`, `apps/golf/`, `fixtures/` for recorded tracks, and `docs/` holding this spec.

## Roadmap

1. **Checkpoint 1: Behaviour proof.** Ten behaviours measured at the desk and on a phone. Gate: each behaviour passes or fails with a reason.
2. **Checkpoint 2: On-glasses check.** The same app on an imported pair of display glasses. Gate: readable and accurate on the real display.
3. **Checkpoint 3: Tester pilot.** A small group uses it on real runs and rounds. Gate: testers keep using it.
4. **Checkpoint 4: Funding pack.** A demo, the measured results and a plan for investors.

Each gate is a decision to continue, change course or stop. Checkpoint 2 is the first step that costs real money, because it needs imported glasses. No dates are set yet.

## Decisions

| Decision | Answer |
| --- | --- |
| Working name | SportsHUD, a placeholder; also the GitHub repository name |
| First sport | Running |
| Field-test phone | Android |
| Golf test course | Grange. Chosen 2026-11-12. OpenStreetMap has 18 of its 36 holes mapped with lines of play, on the east side of the property |
| Rangefinder for B7 | Available |
| Direction | The ghost and the route's markers are to be placed in the world in front of the runner, like a time-trial ghost in a racing game showing a personal best, with distance markers coming up along the route. A heads-up panel of numbers is what competitors already show. Today's Ray-Ban Display cannot place things in the world, so this does not have to work on current hardware; `apps/preview/` shows what it would look like. Stated 2026-11-12 |
| Clock | Everyday runs: paused time does not count, as on a watch. Races: the clock never stops. The engine does both; everyday is the default. Agreed 2026-11-11 |
| Real recordings | Kept out of the repository, because they show where runs start and end. Re-uploaded when a re-test is needed. Agreed 2026-11-11 |
| B1 scoring | A live reading passes if it is within 3 seconds of the gap computed afterwards for any moment within 2 seconds of it. The 2 seconds cover the jump in the gap where the ghost stood still. Agreed 2026-11-11; details in the README |
| Code and build | GitHub repository, built in Claude Code sessions |

## Open questions

- [x] Two GPX recordings of the same running route, for B1. Supplied 2026-11-11; B1 passes on them at the desk.
- [x] The pace ghost: which pace? Answered 2026-11-11; see "Pace ghost" above. A set pace and live segments are both built at the desk.
- [ ] A recording of a run that shares only part of the commute route, to try live segments on real ground. So far it has been tried on a made-up run, and on the two commute runs with one cut down to its middle.
- [ ] What distance and elevation gain does the watch or Strava show for the two test runs? Needed to check the distance target in B11 and the route guide's climb figure.
- [ ] More recordings of the commute route. The route guide's "likely waits" need several runs to say how likely each is; two only show that a wait happened.
- [x] Grange or West Beach? Grange, chosen 2026-11-12. Mapped in OpenStreetMap for 18 of 36 holes: enough for B7 and B9.
- [x] Approximate carry distance for each club. Given 2026-11-12, ten clubs from driver (240 m) to a 52° wedge (100 m).
- [ ] Which of the Grange's two courses are the 18 mapped holes? They sit on the east side; the first nine run par 4, 4, 3, 4, 3, 4, 5, 4, 5.
- [ ] Are the proposed pass targets right, especially B3 and B4?
- [ ] What is the budget and route for importing display glasses for Checkpoint 2?
- [ ] Does Australia count as a supported country for Meta's Wearables Developer Center? Meta says full access is limited to supported countries.
- [ ] Is this solo or with partners, and does any employment contract affect ownership of the work?

## Sources

- Meta, Wearables developer FAQ: https://developers.meta.com/wearables/faq/
- Meta, Web Apps for Meta Ray-Ban Display: https://wearables.developer.meta.com/docs/develop/webapps
- Meta, Web Apps build documentation: https://wearables.developer.meta.com/docs/develop/webapps/build/
- Meta, Input and navigation: https://wearables.developer.meta.com/docs/develop/webapps/build/input-and-navigation/
- Meta Wearables Web App AI Toolkit: https://github.com/facebookincubator/meta-wearables-webapp
- Navigation for Meta Ray-Ban Display (no spatial-anchor API): https://github.com/VexD1/Navigation
- Mysterio Sky Probe (world-locked overlay built on heading): https://github.com/RWARnDEV/mysterio-sky-probe
- Meta Australia, Ray-Ban Display page: https://www.meta.com/au/ai-glasses/meta-ray-ban-display/
- Marathon Handbook, Strava API changes: https://marathonhandbook.com/strava-api-changes/
