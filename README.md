# SportsHUD

A ghost-racing and golf heads-up display for Meta Ray-Ban Display glasses: a static web app, no backend. "SportsHUD" is a placeholder name.

- [docs/spec.md](docs/spec.md) says what is being built and how each behaviour is tested.
- [docs/results.md](docs/results.md) says where each behaviour stands: what has been measured, and what it still needs.
- [docs/research/](docs/research/README.md) holds the background notes.

## What is here

A first version of every build in the spec, at the desk: the track engine, the ghost race screen, the anchoring probe, the route guide and the golf display. [docs/results.md](docs/results.md) says how far each has been tested.

| Folder | What it holds |
| --- | --- |
| `engine/` | The track engine: reads GPX, snaps positions to a route, measures distance along it or without it, and computes the time and distance gap to a ghost. The ghost is a recording of the same route, a set pace on any route, or a set pace with recordings taking over wherever the route shares theirs. A plain JavaScript library with no display code and nothing sport-specific. Tests are in `engine/tests/`. |
| `apps/ghost/` | Ghost run, the first prototype of the race screen: a 600×600 display driven by the arrow keys and Enter, that races a pace or a past run using live GPS. Made to be tried on a phone, standing in for the glasses. |
| `apps/probe/` | The anchoring probe: the route, its markers and the ghost placed over a phone's camera picture, using only GPS and the compass. The nearest thing to glasses that place things in the world, and a first measure of how far off the placing is. |
| `apps/preview/` | Through the glasses: a recorded run from the runner's eyes, with the ghost and distance markers placed in the world along the route. A preview of where the product is heading, with a switch to the heads-up square that today's display can show. Desk tool. |
| `apps/route/` | The route guide, as far as past runs alone can take it: the route's length, climb, turns and usual waiting places, as a pre-start screen and as cues on the way. No map data yet, so no water or toilets. |
| `apps/golf/` | The golf display: distances to the green, where the chosen club lands the ball in the wind, look to range, and hiding at address. On the Grange's East Course as OpenStreetMap has it mapped, or a made-up hole. Sliders at the desk; the phone's GPS, compass and tilt on the course. |
| `apps/replay/` | The desk replay harness: plays a recording at 1× to 60× and shows the live gap to any kind of ghost. |
| `fixtures/courses/` | Golf courses built from OpenStreetMap by `tools/osm-course.mjs`. |
| `fixtures/` | Pairs of GPX recordings, listed in `fixtures/index.json`. These are synthetic, written by `fixtures/generate.mjs`, and shaped like real ones: the run has auto-pause holes and both efforts waiting at the same crossing. One pair is two different runs that share 800 m of road, for live segments. |
| `tools/` | A small local web server and a command-line report for B1 and B12. |
| `docs/` | The spec and research notes. |

All five apps in the spec now exist in some form. None has been tried outdoors.

## Running it

You need [Node.js](https://nodejs.org/) 20 or later. There is nothing to install and no build step.

```bash
npm start
```

Then open http://localhost:8080/apps/replay/ in a browser.

```bash
npm test
```

runs the unit tests.

```bash
npm run b1
```

prints the B1 result for every pair of recordings in `fixtures/index.json`, and the live segments result (B12) for the pair that shares only part of a route.

## Ghost run, on a phone

Open `apps/ghost/` on the phone, outdoors, and allow location.

1. Choose a ghost: a pace (left and right change it), or one of your saved runs to race on its route.
2. Tap as you set off. The big number is seconds ahead of or behind the ghost; the ghost is on the road ahead when it leads, and marked behind you when you do.
3. Stop at a light and the clock stops with you. Set off and it starts again.
4. Tap for the menu to finish. The run is saved on the phone and becomes a ghost for next time.

Swipes are the arrow keys and a tap is Enter, which is all the glasses have. Keep the page open and the screen on: a phone that locks stops reporting where it is. A run in progress is written down every ten seconds, so if the page reloads or the phone drops it, the first row on the way back in is "Carry on the run in progress", for half an hour. The time away counts on the clock, and the distance across it is taken as a straight line. Runs are kept in the browser's storage on that device, the latest twelve, and nowhere else. "Add past runs as ghosts" takes several GPX files at once, so a set of exports from Strava or a watch can be loaded in one go. "Download my latest run" saves one as GPX.

Choosing the pace ghost brings your saved runs along. You run wherever you like against the pace; wherever your way joins the route of a saved run, in the same direction, that run's ghost takes over, a line across the road says so, and the gap carries on. When the routes part, the pace ghost takes back over. Where two saved runs cover the same ground, the more recent is used.

Racing a saved run does not need you to stay on its route. Wherever you are off it (another street for a few blocks, a start part-way along, a different finish) a ghost holding that run's average pace stands in, the screen says OFF ROUTE and names the stand-in, and the gap carries on when the saved run's ghost takes over again. While you are on its route, the next turn or likely wait within 200 m is named under the clock and marked on the road. Those come from the route guide, built from that run and any other saved runs of the same route.

`apps/ghost/?demo=run&speed=10` plays a sample run without GPS. `apps/ghost/?demo=shared&speed=10` plays one that shares only part of the ghost's route.

## The anchoring probe, on a phone

Open `apps/probe/` on the phone, outdoors, on a route you have run, and allow the camera and location. The picture never leaves the phone.

1. Choose the route: a run saved by Ghost run on that phone, or a GPX you add.
2. Stand on the route, facing along it, phone upright. The blue line should lie on the path ahead, with a gate at each 500 m.
3. If the line points off to one side, slide "Turn the picture". If things look too large or too small against the street, change how wide the camera sees.
4. Start the ghost, and walk or jog the route with the phone held in front of you.

Where you are along the route comes from GPS, snapped to the route as everywhere else. Which way you are facing comes from the phone's compass, and that is the one thing between this and a ghost that sits still on the road. A compass is noisy and can be out by a steady amount: magnetic north alone is 8° from true north in Adelaide. So the heading is kept by `engine/heading.js`: it follows the gyroscope from moment to moment, leans on the compass over seconds, and learns the compass's steady error from the direction you are travelling, which has none. On made-up sensors with a compass 9° out, typical error falls from 9° to about 2.5°; on a real device it has not been tried.

The probe measures the result: while you move along the route with the phone pointing ahead, it compares both the compass alone and the corrected heading with the route's direction and shows the typical difference of each, against the spec's B4 targets of 5° walking and 10° running. The correction can be switched off to compare, and "Match the compass" still takes out a steady lean by hand.

`apps/probe/?demo=run&speed=5` plays a sample run on a stand-in street, with no camera or compass needed.

## Using your own recordings

Export two activities on the same route as GPX from Strava or Garmin. They must be recorded activities, which carry a time on every point; a planned route has none and cannot be raced.

- **To look at them:** open the harness and choose the two files under "Ghost GPX" and "Your GPX". Nothing is uploaded; the files stay in your browser.
- **To get the numbers:**

  ```bash
  node tools/b1.mjs path/to/ghost.gpx path/to/yours.gpx
  ```

  Add `--elapsed` to keep the clocks running through pauses, as in a race. The harness has the same choice under "Clock". Add `--segments=5:15` to run them as live segments instead: yours against a ghost holding 5:15 per km, with the ghost recording taking over wherever the two share ground.

- **To keep them as test fixtures:** put the files in `fixtures/recorded/` and add an entry to `fixtures/index.json`:

  ```json
  { "id": "river-loop", "label": "River loop, October", "ghost": "recorded/river-1.gpx", "runner": "recorded/river-2.gpx" }
  ```

  They then appear in the harness and in `npm test` and `npm run b1`. The tests print the B1 result for recorded pairs without failing the build on a miss, because on real data a miss is a finding rather than a bug.

A GPX file shows exactly where you ran, including where a run starts and ends. This repository's contents are public once it is served by GitHub Pages, so think before committing recordings that start at your front door.

## How the gap is defined

- **The route** is the line the ghost recording drew. Each position is snapped to it, so everything is measured in metres along the route.
- **Distance gap:** your distance along the route minus the ghost's, at the same elapsed time.
- **Time gap:** the elapsed time at which the ghost reached the spot you are at now, minus your elapsed time.
- **Sign:** positive means you are ahead of the ghost, negative means behind.
- **Clocks:** each recording's clock starts at its first point. There are two ways to run them:
  - **Paused time doesn't count** (the default, for everyday runs). This is the time a watch displays. Where a recording was paused, at a crossing say, its clock stops. So if the ghost waited three minutes at a light and you waited one, neither wait changes the gap.
  - **The clock never stops** (for races). This is elapsed time: every second counts, including waits.

  A recording's pauses are the holes a paused watch leaves in it. In live use something has to say when you have paused: the engine's tracker has `pause()` and `resume()` for that, but nothing calls them yet. On the glasses that will be an auto-pause or a gesture, which comes with build 2.

Three things real recordings made necessary:

- **Where the ghost stood still.** This matters on the never-stopping clock, or when a watch was left running through a wait. At a traffic light the ghost was at one spot for a while, not an instant. Within 15 m of such a stop the time gap is measured against the whole stay: you are ahead until the ghost arrived there, behind once it had left, and level in between. Otherwise the reading would flip by the length of the stop with every metre of GPS wobble while you wait at the same light. The gap still jumps as you leave the spot, by however much shorter or longer your wait was.
- **Off the route.** If you are more than 15 m from the ghost's route and not travelling along it (cutting a corner, crossing somewhere else), there is nothing to measure progress against. Progress is held where it was and picked up again where you rejoin. Being far from the route but moving along it, on the other side of a wide road say, still counts as on it, up to 50 m. Beyond that it is another street, whichever way it runs. While progress is held the gap falls by a second every second, so a run that takes a different street for a few minutes is better raced as live segments, where the set pace covers the difference.
- **Holes in a recording.** A watch with auto-pause saves nothing while you stand still, so the file has a hole at each stop. A phone in live use reports about once a second regardless. So a replay fills each hole with positions on the straight line across it.

The **live** gap uses only the positions received so far, and is read once a second. Between GPS fixes your position is carried forward at your current speed. The gap **computed afterwards** uses the complete recording, so each estimate also benefits from the positions that came after it.

**B1 scoring.** Each one-second live reading is compared with the gap computed afterwards. The spec's target is "within 3 seconds". The check reports two figures:

- *At the same instant*: the literal reading of the target.
- *With 2 seconds of timing slack*: the reading may match the afterwards gap anywhere within 2 seconds of it. This is what `pass` uses.

The slack is there for the jumps described above. Live and afterwards both make each jump but can place it a second apart, and for that second they differ by the whole jump. Away from jumps the gap changes slowly and the slack makes almost no difference. The slack and the target are the two options of `compareGapSeries` in `engine/gap.js`.

## The pace ghost

A ghost can also simply hold a pace, on whatever route is being run. There is no recorded route to snap to, so your progress is distance covered, measured from GPS alone, and the ghost's is its speed times the time on your clock. The gap is then as right as that distance: 1% out on distance is 1% out on the gap, which is 36 seconds over an hour.

- **Measuring distance.** Adding up the gaps between GPS fixes over-counts, because every wobble of the signal looks like movement. Movement is only counted once it has gone 5 m from the last counted point, so standing still adds nothing. Sharp corners are cut by a metre or two each.
- **A past run on a different route** becomes a set pace: that run's average. Its hills and crossings no longer line up with anything, so its average is all that carries over. `paceOf` works it out, and the harness has a button for it.
- **In the harness,** set "Ghost" to "A set pace, on any route" and type the pace. Only your own recording is needed.

## Live segments

The two kinds of ghost combine. You run wherever you like against a ghost holding a set pace. Wherever your way joins a stretch that a recorded ghost ran, in the same direction, that recording takes over for as long as you stay on it, so the gap there moves by its own pacing, hills and crossings included. When you leave it, the set pace takes over again. `createSegmentTracker` in `engine/segments.js` does this.

- **The gap carries on through every change of ghost.** When a recording takes over, its clock is slid so that its ghost is exactly as far ahead or behind as the pace ghost was. Nothing jumps; from there the gap moves by the recording. The same when the set pace takes back over.
- **Joining** means being within 12 m of a recorded route and travelling its way for 4 seconds. Running it the other way, crossing it, or running a parallel street 30 m off does not join it.
- **Leaving** is being more than 10 m off it and not travelling along it, for more than one fix: a single stray GPS fix does not hand over. The set pace then takes over. For 8 seconds the recording is kept in hand, and stepping back onto it picks it up where you rejoin; after that it is let go, and joining it again is a fresh join.
- **A shortcut is not credited.** If you skip a loop the recorded ghost made, the gap carries on from where it was when you rejoin. Live segments is about the recording's pacing over shared ground, not about racing it door to door; for that, race the recording itself.
- **A pause** stops the clock as everywhere else, and standing off the route with the clock stopped does not count as leaving it.
- **More than one recording** can be given. Where two fit the same ground, the first in the list is used.

**B12 scoring.** `checkSegments` replays a run and lists every change of ghost. The gap must not jump at a change: the change in the gap over that second, beyond how it was changing in the seconds either side, has to be within 1 second. Whether a change came soon enough (the spec's target is within 5 seconds of joining and 7 of leaving) needs to know when the runner truly joined and left, which only a made-up recording can say. So that part is tested on the synthetic pair, and on real recordings the changes are listed for you to judge on the map.

**In the harness,** choose "Run sharing part of the route (synthetic)", or set "Ghost" to "Live segments" with two files of your own. The map shows the ghost's route under yours, and the chart is shaded where the recording was being raced.

**On the phone,** Ghost run uses this both ways round: the pace ghost carries every saved run along and hands over to whichever one you join, and a saved run raced on its own route has its average pace standing in wherever you leave it. None of it has been tried outdoors.

## The route guide

Past runs of a route say a good deal about it without any map. `buildGuide` in `engine/guide.js` takes one or more recordings of the same route and returns everything placed in metres along it:

- **Climb.** From the elevation a watch saves with each point. Readings from every run are averaged along the route and smoothed over 100 m. A rise or fall only counts once it reaches 2 m between turning points, because adding up every small step over-counts climb the same way adding up every GPS fix over-counts distance. A climb is called out where the ground rises at 2% or more and gains at least 8 m.
- **Turns.** Where the direction of the route changes by 45° or more, taken over 20 m either side so that a gentle bend and the wobble of a GPS line do not count. Each has a side, an angle, and whether it is sharp or doubles back.
- **Likely waits.** Where a run stood still for 5 seconds or more, or the watch paused itself. Waits on different runs within 40 m are the same place, and each place records how many of the runs waited there and for how long. On a city route these are mostly traffic lights. A run that goes round by another street is not waiting, though its progress along the route stands still meanwhile: a wait has to be standing on the ground, within 40 m. Two runs only show that a wait happened; it takes more to say how likely one is. A wait is called likely, and cued, where at least two runs waited and at least half of those that passed. Runs of your other routes count where they cover the same ground (`others`): a crossing is a crossing from either side, so the run home is evidence for the run to work. They can add to a wait but not take one away, because at a wide crossing each direction waits on its own side.
- **Distance markers** every 500 m, and the finish.

`nextCue` answers "what should the display say now?" for any point on the route: the next thing to act on and the one after, with a distance marker stepping in only when nothing else is close.

**Many runs.** `groupRuns` sorts a mixed pile of recordings into routes: runs along the same line in the same direction belong together, so a commute out and the same commute home are two routes. Within a route the run of middling length draws the line. With three or more runs, a turn counts only where at least half of them made it, which drops the crossings one run took a little differently.

`apps/route/` shows the result two ways: the pre-start screen the glasses would show (the route's shape, distance, climb, usual time, expected waiting) and the cue screen on the way. Below those are the height profile and the full list. Load any number of your own GPX files at once; they are sorted into routes for you to pick from. The same turns, waits and climbs appear as signs in `apps/preview/`.

**Water and toilets** are the one part that needs a map. "Look up water and toilets near this route" on the route page asks OpenStreetMap's public query service for them, sending it the box the route fits in, and only when pressed. `amenitiesAlong` keeps those within 100 m of the route and lists each one for every time the route passes it, with how far off it is and on which side; they then appear on the pre-start screen, in the list, and as cues in passing. This has been run against a stand-in for the map service, not the service itself, and never against the ground, so B6 is built but untested.

Ghost run shows the turns and likely waits as cues during a run. Not built yet: climbs on the phone, since runs recorded there carry no elevation.

## Golf

`engine/golf.js` works from a position and a mapped hole: the outline of the green, the pin if its place is known, the line of play, and the outline of each bunker and water hazard. That is the shape OpenStreetMap's golf tags come in.

- **Green distances** (`greenDistances`). Front, centre and back are along the line from where you stand through the middle of the green: front where that line reaches the green, back where it leaves. So they change as you move to the side, as a golfer expects.
- **Landing zone** (`landingZone`). The chosen club's carry along the aim, moved by the wind, with a zone around it 5% of the carry deep and 8% wide either side. `zoneTouches` says when that reaches into a hazard, and `clubFor` picks the club whose carry in this wind is nearest a distance.
- **Wind** (`carryInWind`) is a rule of thumb, not a measurement: a headwind costs about 1% of carry per mph, a tailwind gives about half that, and a crosswind moves the ball sideways by 0.4% of the carry per km/h. It moves the zone the right way, which is what B8 asks; the amounts are placeholders until there are real shots to learn from.
- **Hazards in play** (`hazardsInPlay`): how far to reach each one near the aim, and how far to carry it.
- **Look to range** (`lookTarget`): the mapped feature within 7.5° of where you face, and its distance. `lookAround` says which way to turn when nothing is.
- **Hide at address** (`createAddressHider`): looking down past 40° for a third of a second hides the display; it returns when the gaze comes back above 25° down. Two angles, so a head held near the line does not make it flicker.

`fixtures/golf.mjs` is a made-up par 4 laid out on a grid, so that every expected number in `engine/tests/golf.test.js` is a hand calculation.

### A real course

OpenStreetMap draws a course as separate things: an outline, a line of play for each hole with its number and par, and an outline for each green, tee, bunker and fairway, with a point for each pin. Nothing says which bunker belongs to which hole. `courseFromOsm` in `engine/course.js` puts each thing with the holes it lies beside (within 50 m of the line of play, or 45 m of the middle of the green) and names each hazard by where it lies: "Fairway bunker, left", "Greenside bunker, right". `holeAt` says which hole you are on from where you stand, without flipping to the next tee while you are still on a green.

`fixtures/courses/grange.json` is the Grange Golf Club, Adelaide, built this way:

```bash
node tools/osm-course.mjs map.json fixtures/courses/grange.json --name=Grange --title="The Grange, East Course"
```

where `map.json` is OpenStreetMap's map call for the area of the course. What the map holds there, as of 12 November 2026: a line of play, par and stroke index for the 18 holes of the East Course (par 72, 6,379 m), every one with its green, a pin, tees, fairway and bunkers; and for the West Course, greens and bunkers but no lines of play, so it cannot be used yet. In all, 37 greens, 66 tees, 41 fairways, 123 bunkers and 3 water hazards. None of it has been checked against the ground, and a mapped pin is where the mapper put it, not today's hole.

The course file is derived from OpenStreetMap, © OpenStreetMap contributors, and is available under the Open Database Licence (ODbL) like its source.

### The golf page

`apps/golf/` shows three glasses screens (the green, the club and its zone, look to range). Enter moves between them; on the club screen Left and Right change club and Up and Down move the aim; on the green screen Up and Down change hole. "Competition" leaves distances only.

- **At the desk,** sliders say where you are on the hole, which way you face, how far your head is tilted, and the wind.
- **On the course,** tick "Use this phone's position" and the hole is found from where you stand. Tick "Use this phone's compass and tilt" and hold the phone up like a viewfinder: facing sets look to range, and tipping it down hides the display as at address. Your position stays in the browser.
- **Anywhere else,** "Put the made-up hole where I am standing" lays that hole on the ground from your position, playing the way you face. A park or a quiet street will do to try the phone's position, compass and tilt before a visit to the course.
- **The bag** is the set of carry distances entered for it, editable on the page and kept on the device. When the green is out of reach the club offered is the longest whose landing zone stays out of trouble (the driver only from the tee); otherwise the one nearest the distance, or a part shot inside the shortest club.

- **The course test** logs what a rangefinder or a course marker says beside what the app says, and keeps the tally against the targets: within 5 m on 9 of 10 readings for green distances (B7), the right feature 8 times in 10 for look to range (B9). A laser reads to the flag, wherever the hole is cut that day, so "I am at today's pin" takes where you stand as the pin for the rest of the day. The log stays on the device and downloads as CSV.

- **The wind** is a slider, or "Get the wind at the course now", which asks Open-Meteo, a public forecast service, telling it where the course is to the nearest kilometre or so and never where you are. It is a forecast for the area at 10 m up, not a reading on the course. Run so far against a stand-in for the service only.

Not built yet: the West Course. B7 and B9 are ready to test on the East Course but untested.

## Deployment

`.github/workflows/pages.yml` runs the tests on every push. A push to the default branch that passes them is published to GitHub Pages.

One-time setup: in the repository's **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions**. The site then appears at `https://<owner>.github.io/SportsHUD/`.
