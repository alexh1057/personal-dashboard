# Jump — Doodle Jump reverse-engineered with an REA model

The Jump tab is a rebuild of *Doodle Jump* (Lima Sky, 2009). The original was
reverse-engineered by watching how it behaves, not by decompiling it. The
observations were sorted into McCarthy's **REA model** (Resources, Events,
Agents), and the code in `app.js` Section 6 follows the same split.

The numbers below are calibrated by feel against the original's behaviour.
They were not extracted from the original binary.

## Resources

A resource is a quantity that events increase or decrease.

| Resource | What it is | Stock behaviour |
|---|---|---|
| **Altitude** | The score: the highest point reached | Only ratchets up |
| **Upward momentum** | The doodler's vertical speed | Drained by gravity, refilled by bounces |
| **Platforms** | Footholds | Green/blue reusable, white single-use, brown zero-use (a trap) |
| **Boosters** | Springs, propeller hats, jetpacks | Springs stay on their platform; hats and jetpacks are consumed |
| **Ammo** | Pellets fired from the snout | Unlimited, limited only by a cooldown |
| **Life** | Exactly one | Losing it ends the run |
| **Screen** | The visible window | Moves up only; anything below it is gone for good |

## Events and their duality

In REA, events come in give/get pairs ("duality"). Every event in the game
trades one resource for another.

| Event | Give | Get | Ledger counter |
|---|---|---|---|
| **Bounce** | A foothold (white platforms vanish) | 600 u/s of momentum | `bounces` |
| **Climb** (continuous) | Momentum, to gravity | Altitude | — (the score) |
| **Spring** | Landing on the coil | 1000 u/s of momentum | `springs` |
| **Booster pickup** | The hat or jetpack | Steady thrust for 2.5–3 s, and immunity to monsters | `boosters` |
| **Break** | A brown foothold | Nothing: the one one-sided trade | `broken` |
| **Stomp** | Risk: landing on a monster | The monster removed, plus a bounce | `stomped` |
| **Shoot** | Cooldown time | The monster removed, if hit | `shot` |
| **Monster hit** | The life | Nothing; the run ends | — (the cause) |
| **Fall** | The life | Nothing; the run ends | — (the cause) |
| **Spawn** | — (the generator) | New platforms, items and monsters above the screen | — |

Each run keeps these counters as its **ledger**, shown on the game-over panel.

## Agents

| Agent | Role |
|---|---|
| **Player** (external) | Supplies tilt, touch or keyboard input |
| **Doodler** (internal) | The avatar, and the only agent that moves resources |
| **Generator** (internal, "the house") | Issues platforms, boosters and monsters, bound by the reachability rule |
| **Monsters** (external, adversarial) | Hovering or patrolling; can take the life |

Gravity is not an agent. It is a policy: the rule that governs the climb event.

## Policies derived from the model

1. **Reachability.** The generator lays one usable platform per step. The gap
   to it is capped at 85% of a normal jump's apex (127.5 of 150 units), so
   every run can be climbed. Brown platforms are decoys in the gaps and never
   count as the path.
2. **Difficulty follows altitude, not time.** `d = min(1, altitude / 25000)`
   drives everything:
   - Base gap grows from 38 to 118 units, ±25%.
   - Moving platforms appear from 1,500 and rise to a 45% share.
   - White platforms appear from 4,000 and rise to a 20% share.
   - Brown decoys appear from 800 and rise to a 37% chance per step.
   - Springs thin out from 7% to 4%. Propellers are 1.2% and jetpacks 0.6%.
   - Monsters appear from 2,500, at least 700 units apart, with 3.5% to 9.5% chance per step.
3. **The camera is a ratchet.** It follows once the doodler rises above 42%
   of the screen height and never scrolls down. Falling below the bottom edge
   ends the run.
4. **Platforms are one-way.** They only catch the doodler while it is falling,
   and only by the feet.
5. **The screen wraps horizontally.** Leaving one side brings the doodler back
   on the other.
6. **Monsters are lethal except from above.** Landing on a monster's head
   stomps it. Touching it any other way costs the life. A booster flies
   straight through. Each monster is placed on the opposite half of the screen
   from the platform just laid, with clearance above it.

## Constants

The world is 320 units wide, matching the original iPhone's 320 pt screen.
The visible height follows the canvas aspect ratio.

| Constant | Value | Why |
|---|---|---|
| Gravity | 1200 u/s² | With the bounce below, gives a 0.5 s rise, close to the original's rhythm |
| Bounce | 600 u/s | Apex 150 units, about a third of the screen |
| Spring | 1000 u/s | Apex about 417 units, just under three normal jumps |
| Propeller | 480 u/s for 2.5 s | Slow, short lift |
| Jetpack | 860 u/s for 3 s | Fast, long lift |
| Max sideways speed | 380 u/s | Crosses the screen in under a second |
| Platform | 58 × 14 | Proportions of the original's platforms on a 320-wide screen |
| Physics step | 1/120 s, fixed | A slow frame can't tunnel through a platform |

## Left out

The original has more than this rebuild. Not built: the trampoline,
spring shoes, shield, rocket, UFOs, black holes, vertically moving platforms,
and exploding platforms.
