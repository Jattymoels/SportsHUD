# Landscape: competitors, market and risks

Checked 2026-11-11.

## Summary

The space is contested and early, not finished. Nobody has shipped a polished pace-sport or golf product on Meta's display. What exists is hobby web apps, audio-only integrations from Meta's official partners, and dedicated hardware from small companies. The opening is real, and it is a timing bet: build something people use before the partners extend to the display, on hardware that has sold in the tens of thousands.

## Running and pace sports

| Example | What it is | Status | Threat |
| --- | --- | --- | --- |
| ENGO (engo3) | Dedicated sport glasses with a colour HUD for pace, heart rate and power. Works with Garmin and Apple Watch | Shipping. The company raised €5.1 million in 2026 | The real incumbent, but small and tied to its own hardware |
| Meta + Garmin + Strava | Garmin stats read aloud on request; Strava stats overlaid on captured video | Shipping, audio only. Garmin data is not shown on the Ray-Ban Display | High if they extend to the display. They own the data and are official partners |
| Stijn Spanhove's ghost run | Web app on the Ray-Ban Display: ghost racer from a Strava GPX, coins, sprint zones, mini leaderboard | Demo by one developer | Proves the idea is buildable in days; not a product |
| Ghosting (Faxx Apps) | Hands-free running pace HUD for Meta display glasses | Listed in the GlassApps community catalog | Low; hobby app |
| Speedometer app | Speed, distance and time on the Ray-Ban Display | Hobby web app | Low |
| HUD Foundry | Garmin data field plus Android app for ENGO glasses, with custom layouts and course navigation | Private beta | Low; ENGO only |
| hubu, rokid-Strava | Open-source HUDs for Rokid glasses reading Garmin watches or Strava | Open source | Low; shows the pattern repeats on every platform |
| Garmin HUD | Reported plans for a microLED sports HUD; nothing confirmed | Rumour | High if real |
| Ghost Pacer | 2020 Kickstarter for AR glasses with a holographic running partner | Did not become a mainstream product | Prior art for the ghost idea |
| Recon Jet, Garmin Varia Vision, Everysight Raptor | Earlier sports HUDs | All discontinued | A warning: this category has failed before, mostly on hardware |

Ghost racing on the wrist already exists in sports watches. The new part is putting the opponent in the field of view.

## Golf

| Example | What it is | Status | Threat |
| --- | --- | --- | --- |
| BirdiLens GV1 | Dedicated AR golf glasses: green distances, hole layout, plays-like yardage, hazards, wind, AI club recommendations | Shipping. US company founded in 2025 | The most direct competitor; has its own hardware and app |
| RANGEZ | AR glasses designed for golf | Pre-orders sold out; crowdfunding planned; not shipped | Medium |
| 18Birdies on Meta glasses | Spoken yardages, hazard reminders, voice scoring | Shipping, audio only, US and Canada only. No in-lens display found | High if it extends to the display. It has 45,000+ mapped courses |
| Arccos on Meta glasses | Spoken club recommendations from shot history, plays-like distances | Shipping, audio only, US and Canada only; needs Arccos hardware | High, same reason |
| golf-caddie-glasses | Round data and shot logging on Even Realities G2 glasses | Open source | Low |
| Bushnell, Arccos, Garmin rangefinders | Viewfinders showing club recommendations, wind-adjusted distance, or a full hole overlay | Shipping | The silent incumbent. A glance at a rangefinder or watch is the habit to beat, not audio |

Gaps this project can use:

- No golf display app on Meta's glasses.
- Meta's golf integrations don't work in Australia.
- Audio is a poor fit for a quiet course, which favours a silent, glance-only design.

## Market

| Fact | Figure | Source quality |
| --- | --- | --- |
| US runners | Over 50 million ran or jogged in 2024 | Industry statistic, secondary source |
| Runner spending | Just under US$1,000 a year on average | Secondary source |
| Running clubs on Strava | Grew 3.5× in 2025 | Strava's own report |
| Ray-Ban Display sales | About 14,800 units in Q3 2026; about 26,800 in Q1 2026 | Third-party estimate from Meta's revenue; not reported figures |
| Meta's reported target | 500,000 display units cumulative over about two years | Supply-chain reporting |
| Displayless Ray-Ban Meta sales | Over 1 million units a quarter | Third-party estimate |

Demand for the sports is not the constraint. The number of display glasses in the world is.

## Risks

| Risk | Why it matters | Mitigation in the spec |
| --- | --- | --- |
| Small install base | Tens of thousands of display glasses sold; not available in Australia | Keep the engine portable to other glasses |
| Partners move first | 18Birdies, Arccos, Garmin and Strava are official Meta partners and own the data | Compete on the game layer and experience, not raw stats |
| Low build barrier | Several people have built running HUDs as side projects | Prove the hard behaviours (anchoring, a stable ghost) that hobby apps skip |
| Platform dependence | Meta controls distribution and isn't taking submissions yet | Web app on a public URL works today without Meta's approval |
| Strava's API terms | Apps may not show one user's Strava data to another | Use the user's own exported files; build own backend for friend racing |
| Course data | Good golf data is licensed | OpenStreetMap for prototyping; licence before a commercial launch |
| Golf rules | Club advice and wind are likely restricted in competition (Rule 4.3, **unverified**) | Competition mode showing distances only |
| Hardware fit | The display glasses are heavier and not built for sport | Out of our control; watch for a sport model with a display |

## Sources

- ENGO funding: https://vr.org/articles/engo-eyewear-5-1-million-ar-sports-glasses-funding-2026
- engo3 launch: https://www.auganix.org/?p=18356
- Meta, Garmin and Strava integration: https://www.uploadvr.com/meta-smart-glasses-garmin-strava-integration/
- Garmin data not on the display: https://the5krunner.com/2025/09/18/new-garmin-varia-hud-draws-closer-as-meta-and-strava-support-emerges/
- Ghost run demo: https://www.tomshardware.com/peripherals/wearable-tech/resourceful-runner-can-race-my-own-ghost-using-homemade-meta-ray-ban-display-app-also-adds-bonus-coins-mini-leaderboard-and-more
- Developer apps roundup: https://www.heise.de/en/news/Games-Youtube-Fitness-Developers-make-Meta-Ray-Ban-Display-more-versatile-11314233.html
- GlassApps catalog: https://glassapps.io/
- HUD Foundry beta: https://forums.garmin.com/developer/connect-iq/f/showcase/444523/beta-testers-wanted-android-garmin-data-field-for-engo-2-smart-glasses/2076471
- Rokid projects: https://github.com/Anezium/awesome-rokid
- Garmin HUD reporting: https://the5krunner.com/2026/08/20/garmin-wearable-strategy-new-categories/
- Ghost Pacer: https://www.yankodesign.com/2020/08/22/these-augmented-reality-glasses-project-a-virtual-running-partner-to-help-you-crush-your-goals/amp/
- Everysight Raptor discontinued: https://support.everysight.com/hc/en-us/articles/28133477119260-Everysight-Raptor-discontinued-support-has-ended
- BirdiLens GV1: https://thegolfwire.com/birdilens-gv1-golf-smart-glasses/ and https://www.thehackersparadise.com/birdilens-gv1-review/
- RANGEZ: https://rangez.co/
- Meta golf integration: https://www.meta.com/blog/meta-ai-glasses-oakley-meta-hstn-oakley-meta-vanguard-18birdies-arccos/ and https://www.meta.com/help/ai-glasses/1003277785741347/
- 18Birdies display support unclear: https://www.uploadvr.com/18birdies-arccos-meta-glasses-ai-golf-caddy/
- Even G2 projects: https://github.com/pangoleen/awesome-even-realities-g2
- Rangefinders: https://www.golfmonthly.com/best-golf-deals/best-golf-laser-rangefinders-74127
- Running statistics: https://www.ringly.io/discover/running-statistics-2026
- Strava Year in Sport coverage: https://www.t3.com/active/running/strava-year-in-sport-trend-report-2025
- Display sales estimates: https://arinsider.co/2026/10/28/how-many-xr-devices-did-meta-sell-in-q3-3/ and https://arinsider.co/2026/05/06/how-many-xr-devices-did-meta-sell-in-q1-2/
- Meta's unit target: https://displaydaily.com/metas-ray-ban-display-glasses-turn-near-eye-from-experiment-to-supply-constrained-business/
- Strava API terms: https://marathonhandbook.com/strava-api-changes/
- A view on Strava extending to the display: https://arinsider.co/2026/07/20/smart-glasses-dont-need-an-app-store/
