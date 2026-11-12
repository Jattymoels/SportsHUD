# Hardware, kits and what stands between this and a product

Checked 2026-11-12. Prices, availability and capabilities come mostly from news coverage and third-party guides found by search, not from the makers' own pages, which could not be opened from the session that wrote this. Check each maker's site before spending money. Sources are at the end.

## The short version

- **No glasses do everything.** The ones light enough to run in show numbers fixed in your view and cannot place anything in the world. The ones that can place a ghost on the road are heavy, wired or both, cost four figures, and are not sold in Australia.
- **So the product needs two faces from one engine.** A heads-up face (the gap, a cue, a distance) for the glasses people can wear for sport now, and an anchored face (the ghost on the road) for the glasses that are coming. The engine already feeds both.
- **The cheapest way to see the anchored ghost for real is an Android phone**, through the browser's own augmented-reality mode. The next step up is a pair of Android XR glasses, which run the same web technology.
- **The first glasses worth buying are the Meta Ray-Ban Display**, imported: what is built runs on them unchanged, on the glasses, with the phone in a pocket. A sport heads-up display comes next, to find out whether a runner can actually wear this.

## What each kind of hardware can and cannot do

| | Sport heads-up display | Everyday display glasses | True augmented-reality glasses | A phone held up or worn |
| --- | --- | --- | --- | --- |
| Examples | ENGO 3 | Meta Ray-Ban Display, Even Realities G2, Rokid Glasses, Brilliant Labs Halo | Xreal Aura, Snap Specs | Any recent Android phone |
| Weight | Light: made for sport | 36 g to 69 g | Heavier; Aura is wired to a pocket unit | n/a |
| Knows where it is in the world | No | No | Yes: cameras track movement | Yes, through the camera |
| Can place a ghost on the road | No | No, only by compass, roughly | Yes | Yes |
| Display | Small, numbers and simple shapes | Small: about 20° of view | 50° to 70° of view | The screen |
| Can be run in | Yes, built for it | G2 is light and splash-proof; the Meta pair is not built for sport | No | Awkward |
| Price (US) | $400 to $450 | $300 to $800 | $1,100 to $2,200 | Owned already |
| Sold in Australia | Not confirmed; ships from US, UK and EU stores | Meta: no. G2: sold in New Zealand. Others: import | No | Yes |

### Two things worth being exact about on the Meta pair

Checked again on 2026-11-12, against Meta's developer documentation as search results summarise it, and reviews.

**Does the phone have to be open? No, but it has to be there.** A web app runs on the glasses themselves, with no companion app of ours. The glasses have no location sensor and no connection of their own: position and internet come from the paired phone over Bluetooth, through the Meta AI app. For Meta's own walking directions, Meta's help page asks for that app's location permission to be "Always" and "Precise", which is the setting that lets a locked phone in a pocket keep supplying position. Reviews describe using navigation without taking the phone out. So the phone is carried, not held or looked at. What nobody found confirms is that a third-party web app keeps getting positions, second by second, for an hour with the phone locked. It is likely, and it is the first thing to test on a real pair.

**Is it augmented reality? No. It is a heads-up display that can be made to behave a little like it.** One small screen in the right lens, about 20° of view. Nothing tracks where the glasses are in the world, and nothing lets an app pin a picture to the road. Meta draws the same line: its true augmented-reality glasses, Orion, are a prototype that is not for sale, and nothing announced at Connect 2026 changes that. What a web app does get is which way the glasses face and how they are tilted. With that and position, a ghost or a marker can be drawn in the right direction and at the right size for its distance, and slide across the display as the head turns. It is anchored by direction, not locked to the ground: it is as steady as the compass, and it is only visible inside that 20°. For a ghost 10 m or more up the road, direction is most of what matters. That is what build 3 and the heading work are for.

### Limits that shape the design

- **Field of view.** A heads-up display covers a small patch. Most things in the world are outside it most of the time, so off-screen cues and one-number screens are the design, not a fallback.
- **No tracking on anything wearable for sport.** Without cameras the glasses only know which way they face from a compass. A compass is noisy and can be out by a steady amount; in Adelaide magnetic north alone is about 8° from true north, more than the 5° target in B4.
- **Position comes from the phone.** None of these glasses has its own GPS. The phone must be carried and connected, though on the Meta pair it can stay locked in a pocket.
- **Battery.** Up to about six hours of mixed use on the Meta pair, four on Snap's. A long run or a round of golf is near the limit; draw little, and only when something changes.
- **Narrow link to the glasses.** The G2 and the ENGO are driven over Bluetooth with small messages. Text and simple shapes, a few times a second; not video.
- **Sun and sweat.** Brightness and sealing vary. The Meta pair is bright but not sealed for sport; the G2 is sealed against splashes; the ENGO is built for both.

## Kits worth getting, in order

| Order | Kit | Rough cost | What it would prove | How our code gets onto it |
| --- | --- | --- | --- | --- |
| 1 | An Android phone you already own, with a chest or hand mount | Nothing | Everything in the spec that says "phone", and the anchored ghost through the browser's augmented-reality mode | Already there: it is a web page |
| 2 | Meta Ray-Ban Display | US$799 plus import | The product as designed, worn: our pages run on it as they are, on the glasses, with the phone in a pocket. Colour, 600×600, wrist input. Whether the compass is good enough to hold a ghost on the road ahead | Add the URL in the Meta app; nothing to port |
| 3 | ENGO 3 | US$400 | Whether the gap, the cue and the ghost read at a glance while actually running, in sun and sweat (B3, B10) | A Bluetooth driver. ENGO publishes the command set and says it is open and free. From an Android phone the web page may be able to talk to the glasses directly; that needs trying |
| 4 | Even Realities G2 | US$599 | A real path to users: its app store has taken third-party apps since April 2026. Golf distances and the gap number suit its text display | Its own kit: a small app on the glasses side fed from the phone. A port of the screens, not of the engine |
| 5 | Xreal Aura | US$1,099 to $1,279 | The direction itself: a ghost and markers placed on the road, in glasses. An investor demo | Android XR runs web augmented reality, so the anchored view built for the phone should carry over. Wired to a pocket unit, so walking and golf, not running |
| - | Snap Specs | US$2,195 | The same, untethered | Snap's own tools: a rewrite of the display side. Not worth it before the others |

The order was revised on 2026-11-12. The first version put the Meta pair fourth, on the grounds that it is not sold in Australia, not built for sport, and its store is not open. All three are still true. But it is the only pair on which everything built so far runs without a line changed, and the only one where the biggest gap below (a phone that stops reporting when it locks) most likely does not arise. That outweighs the rest for a first purchase. An ENGO then shows whether a runner can wear this at all; a G2 shows whether anyone will install it.

## The limits in the repo's first notes, and what can be done about them

The notes from before any code was written list things a web app on display glasses cannot do. Some have since been got round; some can be.

| Limit as first written | Where it stands | What breaks through it |
| --- | --- | --- |
| GPS error makes a close ghost jumpy | Solved at the desk | Position is reduced to distance along the route, and the ghost is placed by its gap, never by raw GPS |
| Free map data is uneven | Half solved | The route guide is built from the runner's own past runs, with no map: climb, turns, likely waits. Only water and toilets still need a map |
| Racing friends needs accounts and a server | Broken at the desk | A run is small enough to pack into a link: an hour's 12 km run is about 1,500 characters, and the ghost rebuilt from it races within half a second of the original. Ghost run makes the link and opens one. No server, no account, and no third party's terms |
| Strava bars showing one person's data to another | Does not apply | Runs recorded here, or exported by their owner, belong to the runner. A link they choose to send is theirs to send |
| Compass noise and head bob make anchored markers swim | Attacked: built, simulated, untested on a device | The heading now follows the gyroscope from moment to moment, the compass over seconds, and learns the compass's steady error from the direction of travel. On made-up sensors with a compass 9° out, typical error falls from 9° to about 2.5° |
| A web app cannot pin graphics to the road | True on today's display glasses; not true everywhere. Attacked: built, simulated, untested on a device | A browser on an Android phone, and on Android XR glasses, can track its own movement through the camera. Lining that movement up with the GPS track gives the direction of the world without a compass at all. The anchoring probe now has this as a second mode. On made-up data with GPS 3 m out, north is typically found to 3° after 60 m of walking and 1.4° after 150 m |
| The display covers 20° of view | A fact of the hardware | Designed for: one number, an edge cue, a line under the clock |
| No heart rate for a web app | True on the glasses | On an Android phone the browser can talk to a chest strap directly. Worth doing only if heart rate earns its place on the screen |
| No camera or microphone for a web app on the Meta pair | True | Not needed for anything built so far |
| The glasses are not sold in Australia and not built for sport | True of the Meta pair | Other kits are available: see above |
| Club advice and wind may not be allowed in competition | Unverified still | A competition switch that leaves distances only is built |
| Meta's partners could ship the same, and Meta controls the shop window | A real risk | Keep the engine free of any one platform, which it is, and have a second way to reach people: the G2's store, a plain web address, a phone |

## What stands between this and something to sell

The prototypes prove behaviours. A product is the same behaviours when nobody is watching the screen. In rough order of how much each blocks:

1. **On a phone, it stops when the phone locks.** This is a limit of the stand-in, not of the product as designed. A web page in a phone's browser gets no position once the screen is off. Run on the Meta pair instead, the same page is on the glasses and the phone only supplies position from a pocket, through Meta's own app; that most likely keeps working locked, and needs confirming on a real pair. The gap stays real for glasses that are driven from a phone app of ours, such as the ENGO: there the phone side has to become a small native app.
2. **It has never been outdoors.** Every number in `docs/results.md` is from replayed or made-up data.
3. ~~It cannot be installed and needs a signal to load.~~ **Done at the desk.** It can be added to the home screen and, after one visit, every page works with no signal. Not yet tried on a phone.
4. ~~Runs live in one browser's storage.~~ **Eased.** They still live there, but one file now backs up every run and loads into another phone, and the browser is asked not to clear them. A product would keep them in an account.
5. **Getting past runs in is manual.** Exporting GPX files by hand is fine for one tester. Strava now needs a paid developer subscription and approval beyond ten people; Garmin's new personal access is for individuals, not for apps with many users. Recording in the app, and links between friends, avoid both. Links between friends are now built.
6. **Golf course data.** OpenStreetMap has half of one club. A product needs licensed course data; the suppliers found do not publish prices.
7. **No miles or yards.** Everything is metric.
8. **No words for anyone but the builder.** No first-run explanation, no privacy statement, no terms, nothing about running with a display in your eye.
9. **It draws sixty times a second whether or not anything changed.** That matters on a battery.
10. **One display.** The screens are drawn for 600×600 colour. A text display over Bluetooth needs its own, simpler screens from the same readings.

Items 3 and 4 are done, and links between friends take the edge off item 5. Items 7, 9 and 10 can still be done at the desk. Item 1 needs a pair of glasses to settle. Items 2, 6 and 8 need the owner.

## Sources

Hardware and platforms:

- ENGO 3 launch and price: https://www.t3.com/active/engo3-smart-glasses-running-launch-0426 and https://us.engoeyewear.com/products/engo-3
- ENGO's open command set (ActiveLook): https://github.com/ActiveLook/Activelook-API-Documentation and https://github.com/ActiveLook
- Even Realities G2 app store and developer kit: https://9to5google.com/2026/03/26/even-realities-even-hub-apps-and-better-conversate-mode/, https://www.digitaltrends.com/wearables/even-realities-launches-even-hub-to-turn-g2-smart-glasses-into-a-full-app-ecosystem/, https://github.com/pangoleen/awesome-even-realities-g2 and https://dev.to/yokomachi/got-an-even-g2-build-your-own-apps-hands-on-impressions-and-dev-tips-1glp
- Even Realities G2 price, weight and display: https://www.tomsguide.com/computing/smart-glasses/even-realities-g2-smart-glasses-review, https://idevice.com/smart-glasses/even-realities/roadmap?view=price and https://www.pbtech.co.nz/product/MVRERL0001/Even-Realities-G2-Round-Display-AI-Smart-Glasses-W
- Rokid Glasses developer kit: https://www.kickstarter.com/projects/rokid/new-rokid-glassesworlds-lighest-full-function-ai-glasses/posts/4476687 and https://github.com/buildwithfenna/rokid-docs
- Brilliant Labs Halo: https://venturebeat.com/business/brilliant-labs-launches-halo-glasses-a-new-generation-of-privacy-first-smartglasses and https://www.roadtovr.com/?p=124416
- Xreal Aura launch, price and Android XR: https://www.auganix.org/xr-news-xreal-aura-android-xr-glasses-launch/, https://9to5google.com/2026/10/07/xreal-aura-with-android-xr-start-at-1279/ and https://www.androidauthority.com/android-xr-xreal-aura-launch-3729162/
- Snap Specs: https://www.cnbc.com/2026/06/16/snap-unveils-2195-specs-ar-glasses-spiegel-bets-on-post-smartphone.html and https://the-gadgeteer.com/2026/06/18/snap-specs-ar-glasses-2026/
- Meta Ray-Ban Display, countries and web apps: https://roadtovr.com/meta-ray-ban-display-int-launch-connect-2026/, https://developers.meta.com/blog/build-for-display-glasses/ and https://www.engadget.com/2173297/meta-is-bringing-third-party-apps-and-games-to-its-display-glasses/
- Augmented reality in the browser on Android: https://developers.google.com/ar/develop/webxr/arcore-comparison?hl=en
- Web apps on the Meta pair, and where their position comes from: https://wearables.developer.meta.com/docs/develop/webapps/build/, https://developers.meta.com/wearables/web-apps/ and https://developers.meta.com/blog/meta-connect-recap-ai-glasses/
- Location permission for Meta's own walking directions: https://www.meta.com/help/ai-glasses/728826956444153/
- The Meta pair still needs a phone: https://www.thurrott.com/?p=326813 and https://www.engadget.com/wearables/meta-ray-ban-display-review-chunky-frames-with-impressive-abilities-193127070
- Not true augmented reality; Orion is: https://moorinsightsstrategy.com/research-notes/meta-ray-ban-display-bridging-the-gap-between-smart-glasses-and-ar/ and https://about.fb.com/news/2024/09/introducing-orion-our-first-true-augmented-reality-glasses/
- Connect 2026 announcements: https://www.meta.com/blog/meta-connect-2026-everything-we-announced/ and https://vr.org/meta-connect-2026

Getting data in, and golf data:

- Strava's 2026 developer rules: https://tryterra.co/blog/strava-api-changes-2026 and https://communityhub.strava.com/developers-api-7/new-strava-api-update-what-the-message-means-13433
- Garmin's personal access: https://the5krunner.com/2026/10/22/garmin-personal-api/
- Golf course data suppliers: https://thegolfwire.com/stracka-golf-course-data-api/ and https://www.golflogix.com/?p=294
