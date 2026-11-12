# Platform notes: Meta Ray-Ban Display

Checked 2026-11-11. Re-check Meta's docs before relying on any capability; they say capabilities ship regularly.

## The hardware

| Property | Value | Design consequence |
| --- | --- | --- |
| Display | One 600×600 full-colour screen in the right lens only | Design for one eye; no stereo depth |
| Field of view | About 20° (one source gives 14° × 14°, 20° diagonal) | Most real-world targets are off-screen most of the time; edge cues are required |
| Display type | Additive waveguide | Black emits nothing and is transparent. Draw thin bright strokes on black. Large bright areas wash out the world and cost battery |
| Brightness | Up to 5,000 nits | Readable in sunlight |
| Weight | 69 g | Heavier than sport glasses; not built for running |
| Battery | Up to 6 hours mixed use | A long run or a full round is near the limit; keep the display and sensors off when idle |
| Positional tracking | None | No world-anchored graphics from the platform; see "Anchoring" in `feature-ideas.md` |
| Input | Meta Neural Band (wrist gestures) and a touchpad on the frame | Arrives in a web app as arrow keys and Enter |
| Availability | US, Canada, UK, France, Italy, Germany. Not sold in Australia | Checkpoint 1 uses a phone as stand-in; a pair must be imported for Checkpoint 2 |

Meta's sport model, the Oakley Meta Vanguard, has no display. No sport model with a display has been announced.

## Two ways to build

| Path | What it is | Use it for |
| --- | --- | --- |
| Web Apps | Standard HTML, CSS and JavaScript running on the glasses in a Chromium WebView. No native app, no SDK | Checkpoint 1. Everything in the spec |
| Device Access Toolkit (DAT) 1.0 | Native iOS (Swift) and Android (Kotlin) SDK that extends a phone app onto the glasses | Later: camera, microphone, live heart rate from a watch |

There is also a third route, Meta AI Connectors, which exposes a service to the Meta AI assistant. It is not relevant to Checkpoint 1.

## Web app capabilities

| Capability | API | Notes |
| --- | --- | --- |
| Input | `keydown` for `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Enter` | Chromium spatial navigation moves focus between focusable elements by default. A custom key listener that doesn't `preventDefault()` runs alongside it |
| Text input | Dictation, handwriting, on-screen keyboard | Rolled out from 30 September 2026 |
| Location | `navigator.geolocation.getCurrentPosition` and `watchPosition` | Position comes from the paired phone, not the glasses |
| Heading and tilt | `deviceorientation`, `deviceorientationabsolute` | `alpha` is compass heading, 0 to 360, 0 = north. Meta says it comes from a dedicated compass sensor and is usable for real navigation |
| Motion | `devicemotion` | Accelerometer and gyroscope |
| Wrist motion | See Meta's "Wrist orientation" doc page | Not yet examined |
| Storage | `localStorage`, `sessionStorage` | One third-party guide gives a 5 MB limit; unverified |
| Offline | App files can be stored on the device so the app loads without a network request | See Meta's "Storage and offline support" page |
| Speech output | See Meta's "Text to speech" doc page | Not yet examined |
| Voice control | WebMCP lets you declare which app actions Meta AI may trigger | Developer preview |

Remove sensor listeners when they aren't needed. Meta's docs call out idle listeners as a battery drain.

### What web apps can't do

- **Camera and microphone.** A third-party guide from July 2026 says web apps get neither; the native toolkit does. Re-check, since capabilities change.
- **Bluetooth.** No Web Bluetooth access was found in the docs, so no direct connection to a heart-rate strap or watch.
- **Spatial anchors.** There is no documented API to pin graphics to a real-world surface or road.
- **Background running.** Not confirmed for a web app. The app runs on the glasses, so the phone need not be open; position still comes from the phone through the Meta AI app. Meta's own walking directions ask for that app's location permission to be "Always", which is what lets a locked phone keep supplying position. Whether a web app's `watchPosition` keeps arriving for an hour with the phone locked is the first thing to test on a real pair.

## Tooling

| Tool | Where | Use |
| --- | --- | --- |
| Web app starter kit and AI coding skills | https://github.com/facebookincubator/meta-wearables-webapp | Works with Claude Code. Skills cover build, UI, device sensors, test, performance and publish |
| UI Toolkit for Meta Ray-Ban Display | https://github.com/facebook/meta-ray-ban-display-ui-toolkit-web | React components with focus navigation and display-safe styling |
| Meta's browser simulator | https://wearables.developer.meta.com/docs/develop/dat/display-simulation | Test without hardware |
| Community simulator | https://displayglasses.dev/ | Preview any URL in a simulated HUD; third party |
| Chrome DevTools sensors | DevTools → ⋮ → More tools → Sensors | Override location and orientation at the desk |
| Display recording | "Record display" in the Meta AI app | Capture what the wearer sees, for demos and test evidence |

The starter kit's publish skill deploys to Vercel. This project uses GitHub Pages instead, which other developers have used successfully for display web apps.

## Getting an app onto glasses

1. Host the app at a public HTTPS URL.
2. On the paired phone, turn on Developer Mode in the Meta AI app.
3. In the Meta AI app, go to App connections, then Web apps, and add the URL.
4. Alternatively share a deeplink or QR code, which opens that screen with the URL filled in.

Testers follow the same steps and also need Developer Mode on.

## Publishing

- Meta has an Explore surface on the glasses and in the Meta AI app that lists a curated selection of web apps.
- Submissions are not open yet. Meta says to create a Wearables Developer Center account to be ready.
- Meta says full toolkit access, including the Developer Center, is limited to countries where its AI glasses are supported. Whether Australia qualifies is an open question in the spec.
- A community catalog, GlassApps (https://glassapps.io/), lists apps in the meantime.

## The native path, for later

- DAT 1.0 gives a phone app camera, microphone, audio, motion and display access on the glasses.
- The Mock Device Kit simulates glasses for testing but does not support display glasses.
- Builds are shared through release channels in the Wearables Developer Center. Meta's May 2026 announcement gave a limit of 100 testers.
- A third-party SDK wrapper states that DAT apps cannot yet ship through the App Store or Play Store. Unverified against Meta's own terms.

## Reference projects worth reading

| Project | Why it matters here |
| --- | --- |
| [RWARnDEV/mysterio-sky-probe](https://github.com/RWARnDEV/mysterio-sky-probe) | Measures glasses orientation, gyro rate, sensor-fusion lag and heading accuracy for world-locked overlays. Closest prior art to build 3, the anchoring probe |
| [Viraj-Dhuri/meta-display-compass](https://github.com/Viraj-Dhuri/meta-display-compass) | GPS plus compass to decide what is in front of the wearer. Has a calibration flow for level, heading and the viewing cone, saved to local storage. Relevant to look-to-range (B9) |
| [VexD1/Navigation](https://github.com/VexD1/Navigation) | Heading-up map navigation with OpenStreetMap and a demo route mode. States plainly that a web app cannot lock a line to the real road |
| [Archiehere/skyfinder](https://github.com/Archiehere/skyfinder) | Orientation behind a provider with a manual fallback, plus settings for heading offset and inversion because axis conventions can't be confirmed without hardware. Good pattern for building before the glasses arrive |
| [thisconnor/mrbd](https://github.com/thisconnor/mrbd) | Several small display apps in one repo, deployed to GitHub Pages, with a shared HUD theme and input model. Close to this repo's intended layout |
| Stijn Spanhove's ghost run ([coverage](https://www.tomshardware.com/peripherals/wearable-tech/resourceful-runner-can-race-my-own-ghost-using-homemade-meta-ray-ban-display-app-also-adds-bonus-coins-mini-leaderboard-and-more)) | The existing ghost-racing demo: a GPX from Strava with game mechanics on top. He reports the processing runs smoothly on the glasses |

## Sources

- Meta, Wearables developer FAQ: https://developers.meta.com/wearables/faq/
- Meta, Web Apps overview: https://wearables.developer.meta.com/docs/develop/webapps
- Meta, Web Apps build documentation: https://wearables.developer.meta.com/docs/develop/webapps/build/
- Meta, Input and navigation: https://wearables.developer.meta.com/docs/develop/webapps/build/input-and-navigation/
- Meta, Build for display glasses (May 2026): https://developers.meta.com/blog/build-for-display-glasses/
- Meta, Connect recap for developers: https://developers.meta.com/blog/meta-connect-recap-ai-glasses/
- UploadVR, developer apps for the display: https://www.uploadvr.com/meta-ray-ban-display-amazing-hud-apps/
- GlassKit, build guide (third party): https://glasskit.app/docs/build-a-meta-ray-ban-display-app
- VR & AR Wiki, device specifications: https://vrarwiki.com/wiki/Meta_Ray-Ban_Display
- Meta Australia product page: https://www.meta.com/au/ai-glasses/meta-ray-ban-display/
