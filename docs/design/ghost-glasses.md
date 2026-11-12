# Ghost glasses: the design

Written 2026-11-12. The goal, as set by the owner: glasses or headwear that put the ghost in the runner's view, on the road, as soft or full augmented reality. That is not negotiable. If nothing on sale does it, the product is the thing that does.

Every number here comes from replayed recordings or made-up sensors. Nothing has been worn. Prices and specifications of other people's hardware come from search results, mostly reviews and news, and need checking before money is spent. Sources are at the end.

## The idea this rests on

Placing any picture anywhere in the world is hard: it takes cameras, a phone-class chip, a wide display, and the weight and battery to carry them. That is why true augmented-reality glasses are heavy, wired or four figures.

A ghost is not any picture anywhere. It is always somewhere on a line that is known before the run starts, almost always ahead of the runner, and almost always more than eight metres away. Each of those removes a requirement:

| Because the ghost is | The glasses do not need | They do need |
| --- | --- | --- |
| ahead on the road, near where the runner already looks | a wide display | a small display in the right place: straight ahead |
| on a route known in advance, which the runner is following | cameras or a compass to find north | a gyroscope, and the route |
| more than 8 m away | a display for each eye, or depth | one display focused far away |
| a simple outline | a phone-class chip | to draw it on the glasses themselves, quickly |

That is a far smaller device than augmented-reality glasses, and nobody sells it. The four rows are taken in turn below.

### 1. Where the display sits matters more than how big it is

`node tools/view.mjs` takes a recording and reports how much of the route a display would show a ghost on. On three recordings of the owner's 12 km commute, the share of the route with the whole ghost on the display:

| Display (degrees across × down) | 8 m ahead | 20 m ahead | 40 m ahead | 80 m ahead |
| --- | --- | --- | --- | --- |
| 14 × 14 at the lower right, as on today's everyday display glasses | 0% | 0% | 0% | 0% |
| 14 × 14 straight ahead | 95 to 96% | 88 to 99% | 77 to 88% | 68 to 76% |
| 24 × 18 straight ahead (30° corner to corner) | 98 to 99% | 95 to 100% | 87 to 94% | 80 to 86% |
| 56 × 42 straight ahead (70° corner to corner) | 100% | 99 to 100% | 96 to 99% | 92 to 95% |

Each range runs from the worst case, the head pointing dead along the road at a corner, to the usual one, the head pointing 15 m up the route. The lower-right position is a guess at where today's displays sit, 12° right and 10° down; any place off the line of sight gives much the same answer.

What it says:

- A display the size of today's, moved to straight ahead, goes from never showing the ghost to nearly always.
- Going from 30° to 70° buys a few per cent. A 30° display is enough.
- When the ghost is off the display it is round a corner. That is what the edge cue (B5) is for.
- At 5 m the ghost stands 20° tall and fits no small display. Inside about 7 m it has to be drawn differently, as a marker at the shoulder rather than a figure.

### 2. Heading with no compass and no camera

Phones and glasses blend a gyroscope with gravity into a smooth, quick orientation. Its fault is that its idea of north starts arbitrary and wanders. A compass corrects that and is itself thrown by cars, rails, bridges and the electronics beside it.

A runner on a known route has a better reference: over a minute, the middle of where the head points is the way the route goes. `createTravelAnchor` in `engine/heading.js` takes the orientation as it comes, moment to moment, and learns only its slow difference from north, and how fast that difference is growing, from the direction of travel.

On made-up sensors, over ten minutes round streets with head bob and glances aside:

| | Typical error | 19 readings in 20 within |
| --- | --- | --- |
| Device wandering 1.5° a minute, lined up at the start | 1.2° | 2.7° |
| Never lined up at all | 1.1° | 2.8° |
| Device wandering 5° a minute | 1.3° | 3.6° |
| A compass-led heading on the same run, the compass thrown 30° twice for 25 s | | 24.5° |
| This method on that run (it has no compass to throw) | | 2.6° |

At 20 m, 1.2° is 0.4 m sideways and 2.7° is 0.9 m: the ghost stays on a path.

**The known weakness.** It takes where the head points, on average, to be where the runner is going. Run for three minutes looking 12° to one side, at someone beside you, and the heading follows the head: the test measures 13.5° of error by the third minute, back to 0.7° two minutes after looking ahead again. Two ways out, neither built:

- **The stride says where the body is going.** Each footfall brakes and pushes the body along its direction of travel, and a motion sensor on the head feels that. The direction of that push, in the head's own frame, is the angle between head and body, wherever the eyes are. This is an idea to test, not a result: it needs recordings from a real head, which the AR page can now make.
- **Cameras.** `engine/align.js` finds north by lining the device's tracked path up with GPS. That does not care where the runner looks. It needs a camera and a bigger chip, so it belongs to a later, heavier version.

### 3. The picture has to be drawn on the glasses

A head turning at 50° a second, which is an ordinary glance, moves 1° in 20 ms and 5° in 100 ms. A picture drawn that late is that far off the road. A radio link from a phone adds tens of milliseconds and is not steady. So the glasses must read their own gyroscope and draw the ghost themselves, many times a second. Only slow things cross the radio: the gap, and the shape of the route ahead.

This rules out every pair of glasses whose apps run on the phone and send pictures over.

### 4. One eye, focused far away

At 8 m the two eyes' views of the ghost differ by 0.45°, and at 20 m by 0.18°. One display, focused far away, puts the ghost where it should be. Whether a display in one eye is comfortable for an hour's running is not known and can only be found by wearing one.

## What is on sale to prototype on

None is the product. The question for each is whether it can show a first ghost on a road.

| | Display | Runs our code on the glasses | Weight | Price (US) | For the ghost |
| --- | --- | --- | --- | --- | --- |
| Meta Ray-Ban Display | Right lens, lower right; 14° × 14°; 5,000 nits | Yes, a web page | 69 g | $799 | No. The display is off the line of sight |
| Even Realities G2 | Both eyes, green; 1,200 nits | No, apps run on the phone | 36 g | $599 | No. Too slow a path to hold a ghost still |
| Rokid Glasses | Green microLED | Yes, its own kit, with the motion sensor | Light | about $599 | Possible. Lightest that runs code on the glasses; needs our drawing rewritten for its kit. Display size and position not confirmed |
| RayNeo X3 Pro | Both eyes, colour, 30° (taken to be corner to corner), 3,500 nits typical | Yes: it is an Android device | 76 g | $1,099 to $1,299 | **Best fit to prove it.** Straight ahead, bright, and the right size. About an hour of battery in use |
| Xreal Aura | Both eyes, 70° | Yes, augmented reality in its browser | Wired to a pocket unit | $1,099 to $1,279 | Full augmented reality with our web code. For walking and demos. Brightness outdoors not found |
| Brilliant Labs Halo | Colour, small; position not found | Not confirmed | about 40 g | $399 | Not as it is. Its hardware design files are published, which makes it a starting point for our own |
| HoloKit X | A visor that reflects an iPhone's screen, 60° | The phone does | A visor with a phone in it | $129 | A cheap first look, iPhone only. Not glasses |

For building our own: JBD, whose microLED displays are in most light glasses on sale, sells development kits of its display engines with a waveguide. Prices are on request.

## The path

Each stage answers one question, and says what would stop the project.

### Stage 0: the desk. Done

The engine, the AR page, and the numbers above.

### Stage 1: a phone on the head. This month, under US$150

**Question:** do the heading numbers hold on a real running head?

- Fix a phone to the head, firmly: a head strap with a phone clamp, or tight under a headband.
- Open `apps/ar/` and tap "Start a head test". It needs no route. Run for ten minutes round a few corners, then a minute looking to one side.
- Send the recording back.

This gives the first real data for the heading work and the stride idea, and with a visor a first look at a ghost on a road. It is ugly, and that does not matter.

**Stop if:** the heading cannot be held within about 5° on a real head by any of the three methods.

### Stage 2: a ghost in real glasses. Order now; about US$1,100 to $1,300

**Question:** is a ghost on the road, in glasses, in daylight, worth wearing?

- Buy one RayNeo X3 Pro. It is the only pair found with a bright display of the right size, straight ahead, that runs code of ours on the glasses.
- First try: open the AR page in its browser. If the browser there does not pass on the motion sensors or position, the page goes inside a small Android app, which is a few days' work.
- A route gets onto it as a link, which is why runs can now be packed into one.

At 76 g and an hour of battery it is not a product. It is where we learn what the product must be: how bright, how big, whether one eye would do, whether the ghost changes how a run feels.

**Stop if:** testers do not want the ghost once they have seen it. Everything after this is expensive.

### Stage 3: our own. After stage 2 says yes

**Question:** can it be 45 g, last a marathon, be read in sun, and work with no phone?

The device, from parts that exist:

| Part | What it does | Kind of part |
| --- | --- | --- |
| Display engine and waveguide | One green picture, straight ahead of one eye, about 20° to 30° | A microLED engine with waveguide, bought as a module |
| Motion sensor | Head orientation, hundreds of times a second | The same as in phones and watches |
| Small processor | Reads the motion sensor, keeps the heading, draws the ghost 60 times a second | Watch-class |
| Satellite receiver | Position, on the head, with no phone | Watch-class, two-band; 6 to 9 mW by makers' figures |
| Barometer | Climb | Watch-class |
| Bluetooth | Routes in, runs out; heart-rate straps | Standard |
| Battery | | In the arms |

A ghost is a few bright lines on black, which is the cheapest thing a microLED can show: only lit pixels draw power. My estimate, not a measurement, is well under 100 mW in all, or five hours and more from a battery that fits a frame.

This stage needs an electronics engineer and someone who has built with waveguides. It starts with a display engine development kit on a bench, driven by our code, before anything is worn. I can design the board, write the firmware and port the engine; I cannot solder.

## What is built

| Piece | Where | Checked how |
| --- | --- | --- |
| Where the ghost appears, and what a display would show | `engine/view.js`, `tools/view.mjs` | Unit tests; the owner's recordings |
| Heading with no compass | `createTravelAnchor` in `engine/heading.js` | Made-up sensors |
| Head pose from a device fitted any way round | `mountFrom`, `headPose` in `engine/orientation.js` | Unit tests |
| North from a camera's tracking and GPS | `engine/align.js` | Made-up walks and runs |
| The AR page: only what glasses add, for one eye or two, mirrored or not | `apps/ar/` | A headless browser with made-up head sensors that wander 6° a minute |
| A recorder for real head-sensor data | `apps/ar/` | The same |
| A run as a link, to get a route onto glasses with no files | `engine/share.js` | Unit tests; the owner's recordings |

## What is not known

- Whether any of it works on a head. Everything above is simulation.
- Whether the motion sensors in real glasses wander as slowly as assumed.
- Whether a browser on any of these glasses passes on motion readings and position.
- How bright the display must be on a sunlit road. One review calls 600 nits dim outdoors beside a 5,000-nit display; nothing found measures it for running.
- Whether a display in one eye is comfortable for an hour.
- Whether a figure in the view is safe at a road crossing. The ghost should fade when the runner stops; that is a rule to write, not yet written.
- What a display engine kit costs.

## Sources

- Meta Ray-Ban Display, position and size of the display: https://gizmodo.com/meta-ray-ban-display-smart-glasses-review-is-this-the-future-we-really-want-2000679520, https://uploadvr.com/meta-ray-ban-display-review and https://www.gadgetscout.co.uk/articles/meta-ray-ban-display-glasses-review-2026.html
- Even Realities G2, where apps run and its motion sensor: https://www.evenrealities.com/fr-HR/blogs/even-insider/the-unfinished-glasses and https://hub.evenrealities.com/docs/guides/device-apis
- Even G2 display: https://www.notebookcheck.net/Even-G2-Smart-Glasses-with-1-200-nits-micro-LED-display-now-available.1269318.0.html
- Rokid Glasses, code on the glasses and sensors: https://open.rokid.com/, https://github.com/buildwithfenna/rokid-docs and https://extentos.com/docs/ecosystem/platforms/rokid
- RayNeo X3 Pro: https://www.tomsguide.com/computing/smart-glasses/tcl-rayneo-x3-pro-smart-glasses-review, https://smartglassesgeek.com/glasses/rayneo-x3-pro/, https://thevirtualreviewer.com/vr-guides/rayneo-x3-pro/ and https://www.arcompare.com/ar-glasses/rayneo-x3-pro/
- Xreal Aura and augmented reality in its browser: https://developer.android.com/develop/xr/web, https://skarredghost.com/2026/08/27/xreal-aura-hands-on-impressions/ and https://us.shop.xreal.com/products/xreal-aura
- Brilliant Labs Halo: https://roadtovr.com/brilliant-labs-halo-smart-glasses-price-release-date/, https://framesandfeatures.com/brands/brilliant-labs/ and https://en.wikipedia.org/wiki/Brilliant_Labs
- HoloKit X: https://holokit.io/products/holokit-x and https://appleinsider.com/articles/23/02/08/holokit-x-review-still-developing-stereoscopic-ar
- JBD display engine development kits: https://www.jb-display.com/product_des/13.html and https://www.jb-display.com/product_des/11.html
- JBD's place in light glasses: https://www.microled-info.com/even-realities-launches-its-2nd-gen-microled-powered-ar-glasses
- Brightness outdoors, 600 nits against 5,000: https://www.gizmodo.jp/article/inmo-air-3-smartglasses-review/
- Satellite receivers for wearables: https://www.gpsworld.com/sony-to-release-high-precision-gnss-receiver-for-iot-wearables/ and https://everythingrf.com/news/details/13243-broadcom-introduces-low-power-l1-l5-gnss-receiver-for-mobile-and-wearable-applications
