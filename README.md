# SportsHUD

A ghost-racing and golf heads-up display for Meta Ray-Ban Display glasses: a static web app, no backend. "SportsHUD" is a placeholder name.

- [docs/spec.md](docs/spec.md) says what is being built and how each behaviour is tested.
- [docs/research/](docs/research/README.md) holds the background notes.

## What is here

Build 1 of the spec: the track engine and a desk replay harness.

| Folder | What it holds |
| --- | --- |
| `engine/` | The track engine: reads GPX, snaps positions to a route, measures distance along it or without it, and computes the time and distance gap to a ghost. The ghost is either a recording of the same route or a set pace on any route. A plain JavaScript library with no display code and nothing sport-specific. Tests are in `engine/tests/`. |
| `apps/ghost/` | Ghost run, the first prototype of the race screen: a 600×600 display driven by the arrow keys and Enter, that races a pace or a past run using live GPS. Made to be tried on a phone, standing in for the glasses. |
| `apps/replay/` | The desk replay harness: plays a recording at 1× to 60× and shows the live gap to either kind of ghost. |
| `fixtures/` | Pairs of GPX recordings, listed in `fixtures/index.json`. These are synthetic, written by `fixtures/generate.mjs`, and shaped like real ones: the run has auto-pause holes and both efforts waiting at the same crossing. |
| `tools/` | A small local web server and a command-line B1 report. |
| `docs/` | The spec and research notes. |

The other apps in the spec (`apps/probe/`, `apps/route/`, `apps/golf/`) come with builds 3 to 5.

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

prints the B1 result for every pair of recordings in `fixtures/index.json`.

## Ghost run, on a phone

Open `apps/ghost/` on the phone, outdoors, and allow location.

1. Choose a ghost: a pace (left and right change it), or one of your saved runs to race on its route.
2. Tap as you set off. The big number is seconds ahead of or behind the ghost; the ghost is on the road ahead when it leads, and marked behind you when you do.
3. Stop at a light and the clock stops with you. Set off and it starts again.
4. Tap for the menu to finish. The run is saved on the phone and becomes a ghost for next time.

Swipes are the arrow keys and a tap is Enter, which is all the glasses have. Keep the page open and the screen on: a phone that locks stops reporting where it is. Runs are kept in the browser's storage on that device, the latest eight, and nowhere else. "Download my latest run" saves one as GPX.

`apps/ghost/?demo=run&speed=10` plays a sample run without GPS.

## Using your own recordings

Export two activities on the same route as GPX from Strava or Garmin. They must be recorded activities, which carry a time on every point; a planned route has none and cannot be raced.

- **To look at them:** open the harness and choose the two files under "Ghost GPX" and "Your GPX". Nothing is uploaded; the files stay in your browser.
- **To get the numbers:**

  ```bash
  node tools/b1.mjs path/to/ghost.gpx path/to/yours.gpx
  ```

  Add `--elapsed` to keep the clocks running through pauses, as in a race. The harness has the same choice under "Clock".

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
- **Off the route.** If you are more than 15 m from the ghost's route and not travelling along it (cutting a corner, crossing somewhere else), there is nothing to measure progress against. Progress is held where it was and picked up again where you rejoin. Being far from the route but moving along it, on the other side of a wide road say, still counts as on it.
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

Not built yet: switching to a recorded ghost's own pacing on the stretches where your route overlaps one it ran. See "Pace ghost" in the spec.

## Deployment

`.github/workflows/pages.yml` runs the tests on every push. A push to the default branch that passes them is published to GitHub Pages.

One-time setup: in the repository's **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions**. The site then appears at `https://<owner>.github.io/SportsHUD/`.
