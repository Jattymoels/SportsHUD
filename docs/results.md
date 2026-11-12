# Checkpoint 1: results so far

As of 2026-11-12. One line per behaviour in the [spec](spec.md): what was measured, whether it passes, and what it still needs. "Desk" means replayed or made-up data in a browser. Nothing has been tested outdoors yet, on a phone or on glasses.

## Where each behaviour stands

| ID | Behaviour | Target | Measured so far | Status | Needs next |
| --- | --- | --- | --- | --- | --- |
| B1 | Live gap to a recorded track | Within 3 s of the gap computed afterwards; updates every second | Made-up run, ride and walk: 100% of readings within 3 s. Five real recordings of one commute, 8 pairings: 7 at 100%, 1 at 99.9% (worst 3.7 s, at a hairpin one run took differently) | Passes at the desk | A phone outdoors |
| B2 | One engine for any pace sport | A run, a ride and a walk all pass B1 | All three pass on the same code and settings | Passes at the desk, on made-up recordings only | A real ride or walk |
| B3 | Stable ghost at close range | No jump over 2 m between updates at steady pace | Not measured. The ghost is placed by its gap along the route, and what is drawn is eased towards each reading | Built, untested | A screen recording of a run against your own track |
| B4 | Heading-anchored markers | Median error under 5° standing and walking, under 10° running | Not measured on a device. In simulation, with a compass 9° out and jittering, the heading that learns the compass's error from the direction of travel is typically 2.5° out, against 9° for the compass alone. The probe shows both as you move. A second way, for a phone or glasses whose camera tracks its own movement: the tracked path is lined up with GPS to find north with no compass. In simulation with GPS 3 m out, north is typically found to 5° after 30 m of walking, 3° after 60 m and 1.4° after 150 m, and stays within about 1° while running with the tracking slowly drifting | Built, untested | A walk and a jog with the anchoring probe: once by compass, once with "Use the camera's own tracking" on an Android phone |
| B5 | Off-screen cue | Tester turns the right way in 10 of 10 trials | Not measured. The cue exists in the through-the-glasses view (ghost outside the display) and on the golf look screen | Built, untested | Ten trials with a person |
| B6 | Route preview with water, toilets, climb and distance | At least 80% of known water points and toilets shown, on three local routes | Distance and climb come from past runs: on a made-up route the climb is 24.4 m against a true 25.0 m. Water and toilets come from OpenStreetMap when asked for; the lookup has only been run against a stand-in for the map service. In the 1.5 km² of map around the Grange there is no water point or toilet mapped at all | Built, untested | Three routes checked against the ground |
| B7 | Golf: front, centre and back of green | Within 5 m on 9 of 10 readings | Within 0.5 m of hand calculation on a made-up hole. The Grange's East Course is loaded and the page logs rangefinder checks against the target | Ready to test | A walk round the Grange with a rangefinder |
| B8 | Landing zone by club, shifted by wind | Zone centre within 2 m of the club's carry before wind; wind moves it the correct way | Zone centre exactly on the carry; every wind direction moves it the correct way. The size of the wind's effect is a rule of thumb, not measured | Passes at the desk | A sanity check on the course |
| B9 | Look to range | Correct feature in 8 of 10 when features are 15° or more apart | The right feature with the compass up to 6° out, on the made-up hole. The page logs right and wrong on the course | Ready to test | Ten looks on the course with the phone's compass |
| B10 | Glanceable and silent | Key number read within 2 s; display hides within 1 s of looking down | Hides 0.3 s after the gaze drops past 40° down, at the desk with a slider. The 2-second read has not been tried | Half passes at the desk | The read test with people; the hide with a real tilt sensor |

Two behaviours were added on 2026-11-11 for the pace ghost, and one on 2026-11-12 for sending a ghost to a friend. Their targets are proposals too.

| ID | Behaviour | Target | Measured so far | Status | Needs next |
| --- | --- | --- | --- | --- | --- |
| B11 | Live gap to a ghost holding a set pace | Within 3 s of the gap computed afterwards; distance within 1% of the watch's | Worst 1.4 s on two real runs. Five real runs measure 12.04 to 12.08 km against the 12 km Strava shows: 0.35% to 0.65% over, if Strava's figure is exactly 12.0 | Passes at the desk | A phone outdoors |
| B12 | Live segments | Recording takes over within 5 s of joining and hands back within 7 s of leaving; no jump in the gap | Made-up run: 5 s and 6 s, largest jump 0.25 s. A real run that takes other streets for about 1.5 km: 5 changes of ghost, largest jump 0.14 s. Seven real pairings: 0.70 s or less | Passes at the desk | A phone outdoors |
| B13 | A ghost sent as a link | Gap within 1 s of the gap against the original, 19 readings in 20; an hour's run under 2,000 characters | Three real pairings of the 12 km commute: links of 1,407 to 1,607 characters, gap typically 0.11 s different, 19 in 20 within 0.34 to 0.41 s. Made-up run: 0.12 s and 0.35 s. Sending, opening and racing checked in a browser at the desk | Passes at the desk | Send one between two real phones, through a messaging app |

## What this means for the design so far

- **Racing a recording only works as live segments.** One of three real runs of the same commute took other streets for a kilometre and a half. A plain recorded ghost swung to 14 minutes behind and jumped back 226 s. With a pace ghost standing in off the route, the largest change in any second was 2.1 s. The phone app now always races a saved run this way.
- **Past runs are a usable route guide without a map.** Three runs of one route gave its climb and 15 turns that at least two runs agree on. Two runs were not enough to call a wait likely; five runs of a commute, three out and two home, pick out four likely waits each way from ten or more places a run has stopped at once.
- **Free map data is uneven, as expected.** OpenStreetMap has lines of play for the Grange's East Course but not its West, and no water or toilets at all in the surrounding square. B6's 80% target may not be reachable on map data alone.
- **Friends do not need a server.** An hour's run is about 1,500 characters once only the moments where pace or direction changed are kept, and a ghost rebuilt from that races within a fraction of a second of the original. That is a link, which the runner sends to whoever they choose.
- **Today's display cannot do the thing the product is aiming at.** A ghost and markers placed in the world need glasses that know where the road is. The through-the-glasses preview shows the aim; the heads-up square is what a Ray-Ban Display could show now.

## Not yet known

- Whether any of it holds up outdoors: GPS on a phone in a pocket or hand, the compass while running, a screen in daylight.
- Whether the distance measured without a route stays within 1% of a watch on a phone's GPS. On five recordings from a watch it does.
- Whether the wind rule of thumb is close enough to be useful.
- The elevation gain Strava shows for the commute, to check the route guide's 61 m.
