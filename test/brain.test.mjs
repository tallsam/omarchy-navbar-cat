// Tests for the cat's behaviour core.
//
// Brain.js is loaded by evaluating it rather than importing it, because it is
// a QML .js resource: QML exposes its top-level functions directly and has no
// export statement for node to read. Evaluating it here keeps one copy of the
// logic serving both the shell and this suite.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(REPO, "Brain.js"), "utf8");
const Brain = new Function(
  `${source}\nreturn { decide, freshState, pickSpot, CHAIN, PET_MS, PET_PERK_MS,`
    + ` AWAKE_MS, SCAMPER_MS, POUNCE_MS, POUNCE_COOLDOWN_MS, NOTIFY_MS, rhythmFor,`
    + ` toyMotion, toyGameLength, nextToyBat };`,
)();

// The middle of the bar, in cat-position terms, and the default keep-clear
// band. These are functions because BAR and CAT are declared further down.
function middle() { return (BAR - CAT) / 2; }
function inCentre(x, avoid = 0.2) {
  const half = (BAR * avoid) / 2;
  return x > middle() - half && x < middle() + half;
}

const DIAGONALS = new Set(["upleft", "upright", "dwleft", "dwright"]);

// Drive the cat all the way down to sleep from a fresh state, and hand back the
// decision and the clock reading at that moment. Several tests need a genuinely
// sleeping cat as their starting point.
function sleepingCat(overrides = {}) {
  const chainTotal = Brain.CHAIN.reduce(
    (sum, step) => sum + (Number.isFinite(step.ms) ? step.ms : 0),
    0,
  );
  const start = 300_000;
  let out = Brain.decide(
    input({ now: start, lastPointerMoveAt: 10_000, x: 500, ...overrides }),
    Brain.freshState(),
  );
  const asleepAt = start + chainTotal + 1000;
  out = Brain.decide(
    input({ now: asleepAt, lastPointerMoveAt: 10_000, x: out.target, ...overrides }),
    out.state,
  );
  return { out, asleepAt, chainTotal };
}

const BAR = 1000;
const CAT = 16;

// A snapshot with nothing going on: pointer off the bar, nothing playing,
// on battery, pointer moved a moment ago. Every test overrides just the field
// it cares about, so a rung firing is unambiguous.
function input(overrides = {}) {
  return {
    now: 10_000,
    axis: "h",
    barLength: BAR,
    catSize: CAT,
    x: 500,
    pointer: null,
    toy: null,
    pettedAt: null,
    lastPointerMoveAt: 10_000,
    music: false,
    charging: false,
    workspaceEvent: null,
    config: {
      chaseCursor: true,
      pettable: true,
      sleepAfter: 180,
      reactions: { music: true, charging: true, workspace: true },
    },
    ...overrides,
  };
}

function decide(overrides, state = Brain.freshState()) {
  return Brain.decide(input(overrides), state);
}

test("with nothing happening the cat wanders", () => {
  const out = decide({});
  assert.equal(out.reason, "wander");
});

test("a wander target stays put across ticks until reached", () => {
  let state = Brain.freshState();
  const first = Brain.decide(input({}), state);
  const second = Brain.decide(input({ now: 10_100 }), first.state);
  assert.equal(first.target, second.target, "cat should not re-roll its target every tick");
});

test("no pointer movement past sleepAfter puts the cat to sleep", () => {
  // Far past the threshold and standing on its target, so the idle chain has
  // had time to run all the way down to sleep.
  let state = Brain.freshState();
  let out = Brain.decide(
    input({ now: 300_000, lastPointerMoveAt: 10_000, x: 500 }),
    state,
  );
  // Let the chain elapse: feed the same resting situation well past its end.
  const chainTotal = Brain.CHAIN.reduce(
    (sum, step) => sum + (Number.isFinite(step.ms) ? step.ms : 0),
    0,
  );
  out = Brain.decide(
    input({ now: 300_000 + chainTotal + 1000, lastPointerMoveAt: 10_000, x: out.target }),
    out.state,
  );
  assert.equal(out.pose, "sleep");
  assert.equal(out.reason, "idle-sleep");
});

test("the idle chain runs stop -> wash -> scratch -> yawn -> sleep", () => {
  // Faithful to oneko's own progression (oneko.c:1107 onward).
  const seen = [];
  let state = Brain.freshState();
  let t = 300_000;
  let x = 500;
  // Prime: arrive at rest.
  let out = Brain.decide(input({ now: t, lastPointerMoveAt: 10_000, x }), state);
  x = out.target;
  for (const step of Brain.CHAIN) {
    out = Brain.decide(
      input({ now: t, lastPointerMoveAt: 10_000, x }),
      out.state,
    );
    seen.push(out.pose);
    t += Number.isFinite(step.ms) ? step.ms : 1000;
  }
  assert.deepEqual(seen, ["stop", "wash", "scratch", "yawn", "sleep"]);
});

test("music makes the cat dance where it already is", () => {
  // It used to walk to the centre of the bar to dance, which is exactly where
  // most people's clock sits.
  for (const x of [80, 400, BAR - CAT]) {
    const out = decide({ music: true, x });
    assert.equal(out.reason, "music");
    assert.equal(out.target, x, "music should not relocate the cat");
    assert.equal(out.gait, "idle");
    assert.equal(out.bob, true, "and it should be dancing immediately");
  }
});

test("music is ignored when its reaction is switched off", () => {
  const out = decide({
    music: true,
    config: { ...input().config, reactions: { music: false, charging: true, workspace: true } },
  });
  assert.equal(out.reason, "wander");
});

test("charging makes the cat sleepy where it stands", () => {
  // It used to be marched to the right third to "nap by the power widget".
  // A cat sleeps where it is, and being summoned to a fixed spot meant it
  // always slept in the same place and trudged back there after every stir.
  for (const x of [40, 500, BAR - CAT]) {
    const out = decide({ charging: true, x });
    assert.equal(out.reason, "charging");
    assert.equal(out.target, x, "charging should not relocate the cat");
    assert.equal(out.gait, "idle");
  }
});

test("music outranks charging, so mains power cannot silence it", () => {
  // Regression: charging used to come first. Because charging is a sleepy rung
  // that returns immediately, a laptop on mains power — which is most laptops,
  // most of the time — made the music reaction unreachable entirely.
  const out = decide({ charging: true, music: true, x: 100 });
  assert.equal(out.reason, "music");

  // Charging still wins when there is nothing playing.
  const quiet = decide({ charging: true, music: false, x: 100 });
  assert.equal(quiet.reason, "charging");
});

test("waking reactions all beat charging", () => {
  // The general rule the bug above violated: anything that means the cat
  // should be up and doing something outranks anything that puts it to sleep.
  const cases = [
    [{ pettedAt: 9_500 }, "petted"],
    [{ pointer: { onBar: true, pos: 300 } }, "chase"],
    [{ workspaceEvent: { at: 9_800, dir: 1 } }, "workspace"],
    [{ music: true }, "music"],
  ];
  for (const [extra, expected] of cases) {
    const out = decide({ charging: true, x: 100, ...extra });
    assert.equal(out.reason, expected, `${expected} should beat charging`);
  }
});

test("a charging cat eventually naps, right where it was", () => {
  const chainTotal = Brain.CHAIN.reduce(
    (sum, step) => sum + (Number.isFinite(step.ms) ? step.ms : 0),
    0,
  );
  let out = decide({ charging: true, x: 100 });
  assert.equal(out.pose, "stop", "settles before it sleeps");
  out = Brain.decide(
    input({ charging: true, x: 100, now: 10_000 + chainTotal + 2000 }),
    out.state,
  );
  assert.equal(out.pose, "sleep");
  assert.equal(out.target, 100, "and sleeps where it already was");
});

test("a workspace switch scampers the cat that way", () => {
  const right = decide({ workspaceEvent: { at: 9_800, dir: 1 }, x: 500 });
  assert.equal(right.reason, "workspace");
  assert.ok(right.target > 500, "switching right should send the cat right");
  assert.equal(right.gait, "run");

  const left = decide({ workspaceEvent: { at: 9_800, dir: -1 }, x: 500 });
  assert.ok(left.target < 500, "switching left should send the cat left");
});

test("a stale workspace switch stops mattering", () => {
  const out = decide({ workspaceEvent: { at: 1_000, dir: 1 } });
  assert.equal(out.reason, "wander");
});

test("a scamper cannot leave the bar", () => {
  const out = decide({ workspaceEvent: { at: 9_800, dir: 1 }, x: BAR - CAT - 5 });
  assert.ok(out.target <= BAR - CAT, `target ${out.target} escaped the bar`);
});

test("the cat runs to a pointer on the bar", () => {
  const out = decide({ pointer: { onBar: true, pos: 900 }, x: 100 });
  assert.equal(out.reason, "chase");
  assert.equal(out.gait, "run");
  assert.equal(out.pose, "right");
  assert.ok(Math.abs(out.target - (900 - CAT / 2)) < 1);
});

test("having reached the pointer, the cat sits and waits", () => {
  // Pounce off: arriving at the pointer is also the pounce trigger, and this
  // test is about what the cat does once it has landed and settled.
  const out = decide({
    pointer: { onBar: true, pos: 500 },
    x: 500 - CAT / 2,
    config: { ...input().config, pounce: false },
  });
  assert.equal(out.reason, "chase");
  assert.equal(out.gait, "idle");
  assert.equal(out.pose, "stop", "a waiting cat should not fall asleep on the job");
});

test("chase outranks charging and music", () => {
  const out = decide({
    pointer: { onBar: true, pos: 100 },
    charging: true,
    music: true,
    x: 900,
  });
  assert.equal(out.reason, "chase");
});

test("chaseCursor off means the pointer is ignored", () => {
  const out = decide({
    pointer: { onBar: true, pos: 900 },
    config: { ...input().config, chaseCursor: false },
  });
  assert.equal(out.reason, "wander");
});

test("a freshly petted cat holds still and looks pleased", () => {
  const out = decide({ pettedAt: 9_500, x: 400 });
  assert.equal(out.reason, "petted");
  assert.equal(out.gait, "idle");
  assert.equal(out.target, 400, "a petted cat should not wander off");
});

test("petting gets an acknowledgement before the grooming", () => {
  // Clicking and being met instantly with face-washing reads as the cat
  // ignoring you. It should look up first, then settle into grooming.
  const now = 10_000;
  const immediate = decide({ pettedAt: now - 10, x: 400 });
  assert.equal(immediate.pose, "awake", "should look up when clicked");

  const later = decide({ pettedAt: now - Brain.PET_PERK_MS - 10, x: 400 });
  assert.equal(later.pose, "wash", "then settle into contented grooming");

  const done = decide({ pettedAt: now - Brain.PET_MS - 1, x: 400 });
  assert.notEqual(done.reason, "petted");
});

test("petting outranks even the pointer", () => {
  const out = decide({ pettedAt: 9_500, pointer: { onBar: true, pos: 900 }, x: 400 });
  assert.equal(out.reason, "petted");
});

test("the pleasure wears off", () => {
  const out = decide({ pettedAt: 9_500 - Brain.PET_MS - 1, x: 400 });
  assert.notEqual(out.reason, "petted");
});

test("waking: a sleeping cat plays its awake frame before it moves", () => {
  // Put it to sleep, then give it a reason to move.
  let out = decide({ now: 300_000, lastPointerMoveAt: 10_000, x: 500 });
  const chainTotal = Brain.CHAIN.reduce(
    (sum, s) => sum + (Number.isFinite(s.ms) ? s.ms : 0),
    0,
  );
  const asleepAt = 300_000 + chainTotal + 1000;
  out = Brain.decide(
    input({ now: asleepAt, lastPointerMoveAt: 10_000, x: out.target }),
    out.state,
  );
  assert.equal(out.pose, "sleep");

  const woken = Brain.decide(
    input({ now: asleepAt + 10, pointer: { onBar: true, pos: 50 }, x: out.target }),
    out.state,
  );
  assert.equal(woken.pose, "awake");
  assert.equal(woken.gait, "idle", "the cat should not sprint before its eyes open");

  const moving = Brain.decide(
    input({
      now: asleepAt + Brain.AWAKE_MS + 20,
      pointer: { onBar: true, pos: 50 },
      x: out.target,
    }),
    woken.state,
  );
  assert.equal(moving.gait, "run", "after waking it should get going");
});

test("edges: a cat that wants to walk past the end claws at it instead", () => {
  const noPounce = { ...input().config, pounce: false };
  const out = decide({
    pointer: { onBar: true, pos: BAR + 200 },
    x: BAR - CAT,
    config: noPounce,
  });
  assert.equal(out.pose, "rtogi");

  const left = decide({ pointer: { onBar: true, pos: -200 }, x: 0, config: noPounce });
  assert.equal(left.pose, "ltogi");
});

test("vertical bars: the cat uses up and down frames", () => {
  const down = decide({ axis: "v", pointer: { onBar: true, pos: 900 }, x: 100 });
  assert.equal(down.pose, "down");
  const up = decide({ axis: "v", pointer: { onBar: true, pos: 100 }, x: 900 });
  assert.equal(up.pose, "up");
});

test("vertical bars: edge clawing uses the top and bottom frames", () => {
  const noPounce = { ...input().config, pounce: false };
  const bottom = decide({
    axis: "v", pointer: { onBar: true, pos: BAR + 200 }, x: BAR - CAT, config: noPounce,
  });
  assert.equal(bottom.pose, "dtogi");
  const top = decide({
    axis: "v", pointer: { onBar: true, pos: -200 }, x: 0, config: noPounce,
  });
  assert.equal(top.pose, "utogi");
});

test("petting is only offered while the cat is settled", () => {
  const moving = decide({ pointer: { onBar: true, pos: 900 }, x: 100 });
  assert.equal(moving.pettable, false, "a walking cat must not hold an input region");

  const settled = decide({
    pointer: { onBar: true, pos: 500 },
    x: 500 - CAT / 2,
    config: { ...input().config, pounce: false },
  });
  assert.equal(settled.pettable, true);
});

test("petting is never offered when the user has switched it off", () => {
  const out = decide({
    pointer: { onBar: true, pos: 500 },
    x: 500 - CAT / 2,
    config: { ...input().config, pettable: false, pounce: false },
  });
  assert.equal(out.pettable, false);
});

test("the cat never targets a position that would hang off the bar", () => {
  // Sweep the ladder with hostile geometry and check the invariant holds.
  const cases = [
    { pointer: { onBar: true, pos: 5 } },
    { pointer: { onBar: true, pos: BAR - 1 } },
    { charging: true },
    { music: true },
    { workspaceEvent: { at: 9_800, dir: 1 } },
    { workspaceEvent: { at: 9_800, dir: -1 } },
    {},
  ];
  for (const c of cases) {
    for (const x of [0, 250, BAR - CAT]) {
      const out = decide({ ...c, x });
      assert.ok(
        out.target >= 0 && out.target <= BAR - CAT,
        `target ${out.target} out of bounds for ${JSON.stringify(c)} at x=${x}`,
      );
    }
  }
});

test("a bar too narrow for the cat does not produce a negative target", () => {
  const out = decide({ barLength: 10, x: 0 });
  assert.ok(out.target >= 0 && Number.isFinite(out.target), `got ${out.target}`);
});

// ------------------------------------------------------------------ stirring

test("stir: a sleeping cat says when it next wants waking", () => {
  const { out } = sleepingCat();
  assert.equal(out.pose, "sleep");
  assert.ok(out.wakeIn > 0, "a sleeping cat must ask to be woken, or it sleeps forever");
});

test("stir: the cat rouses itself after a while and wanders", () => {
  const { out, asleepAt } = sleepingCat();
  // Well past the longest possible randomised interval.
  const later = asleepAt + out.wakeIn + 10;
  const stirred = Brain.decide(
    input({ now: later, lastPointerMoveAt: 10_000, x: out.target }),
    out.state,
  );
  assert.equal(stirred.reason, "stir");
  assert.notEqual(stirred.pose, "sleep", "it should be up and about");
});

test("stir: having pottered about, it goes back to sleep", () => {
  const { out, asleepAt, chainTotal } = sleepingCat();
  let state = out.state;
  let now = asleepAt + out.wakeIn + 10;

  let stirred = Brain.decide(input({ now, lastPointerMoveAt: 10_000, x: out.target }), state);
  assert.equal(stirred.reason, "stir");

  // Run past the whole stir window, standing where it was asked to go.
  now += 25_000 + 1000;
  let back = Brain.decide(
    input({ now, lastPointerMoveAt: 10_000, x: stirred.target }),
    stirred.state,
  );
  assert.equal(back.reason, "idle-sleep", "the stir should expire back into sleeping");

  // And then settle all the way down again.
  now += chainTotal + 1000;
  const asleepAgain = Brain.decide(
    input({ now, lastPointerMoveAt: 10_000, x: back.target }),
    back.state,
  );
  assert.equal(asleepAgain.pose, "sleep");
});

test("stir: a cat asleep on the charger stirs too, not just an idle one", () => {
  // Regression: the stir originally lived inside the idle-sleep rung, so a cat
  // that had nodded off on AC power booked a wake-up and then went straight
  // back to sleep without ever getting up.
  const chainTotal = Brain.CHAIN.reduce(
    (sum, s) => sum + (Number.isFinite(s.ms) ? s.ms : 0),
    0,
  );
  let out = decide({ charging: true, x: 100 });
  out = Brain.decide(
    input({ charging: true, x: 100, now: 10_000 + chainTotal + 2000 }),
    out.state,
  );
  assert.equal(out.pose, "sleep");
  assert.ok(out.wakeIn > 0, "a charging cat should book its own stir");

  const stirred = Brain.decide(
    input({
      charging: true,
      x: 100,
      now: 10_000 + chainTotal + 2000 + out.wakeIn + 10,
    }),
    out.state,
  );
  assert.equal(stirred.reason, "stir");
});

test("stir: after pottering about it settles wherever it ended up", () => {
  // The point of letting it sleep anywhere: having stirred and wandered off,
  // the cat must not walk all the way back to where it slept before.
  const chainTotal = Brain.CHAIN.reduce(
    (sum, s) => sum + (Number.isFinite(s.ms) ? s.ms : 0),
    0,
  );
  let out = decide({ charging: true, x: 100 });
  out = Brain.decide(
    input({ charging: true, x: 100, now: 10_000 + chainTotal + 2000 }),
    out.state,
  );
  let now = 10_000 + chainTotal + 2000 + out.wakeIn + 10;

  const stirred = Brain.decide(input({ charging: true, x: 100, now }), out.state);
  assert.equal(stirred.reason, "stir");
  const wanderedTo = stirred.target;
  assert.notEqual(wanderedTo, 100, "it should have somewhere new in mind");

  // Let the stir run out while standing at the new spot.
  now += 25_000 + 1000;
  const settling = Brain.decide(
    input({ charging: true, x: wanderedTo, now }),
    stirred.state,
  );
  assert.equal(settling.reason, "charging");
  assert.equal(
    settling.target, wanderedTo,
    "it should settle where it wandered to, not march back",
  );
});

test("stir: waking for a real reason clears the stir schedule", () => {
  const { out, asleepAt } = sleepingCat();
  const chased = Brain.decide(
    input({ now: asleepAt + 50, pointer: { onBar: true, pos: 100 }, x: out.target }),
    out.state,
  );
  assert.equal(chased.wakeIn, 0, "an awake cat has no pending self-wake");
});

// ------------------------------------------------------------------- pouncing

test("pounce: catching up with the pointer triggers a pounce", () => {
  const settled = decide({ pointer: { onBar: true, pos: 500 }, x: 300 });
  // Walk it in so the cat has a direction, then arrive.
  const arriving = Brain.decide(
    input({ pointer: { onBar: true, pos: 500 }, x: 492 }),
    settled.state,
  );
  assert.equal(arriving.reason, "pounce");
  assert.ok(DIAGONALS.has(arriving.pose), `expected a diagonal frame, got ${arriving.pose}`);
});

test("pounce: the arc lifts off and lands", () => {
  const start = decide({ pointer: { onBar: true, pos: 500 }, x: 300 });
  let out = Brain.decide(input({ pointer: { onBar: true, pos: 500 }, x: 492 }), start.state);
  const lifts = [out.lift];
  for (const at of [0.25, 0.5, 0.75]) {
    out = Brain.decide(
      input({ now: 10_000 + Brain.POUNCE_MS * at, pointer: { onBar: true, pos: 500 }, x: 492 }),
      out.state,
    );
    lifts.push(out.lift);
  }
  assert.ok(lifts[2] > lifts[0], "should be higher mid-pounce than at the start");
  assert.ok(lifts[2] >= lifts[3], "and coming back down by the end");
  assert.ok(Math.max(...lifts) <= 1.0001, "lift is normalised to 0..1");

  const after = Brain.decide(
    input({ now: 10_000 + Brain.POUNCE_MS + 50, pointer: { onBar: true, pos: 500 }, x: 492 }),
    out.state,
  );
  assert.notEqual(after.reason, "pounce", "the pounce must end");
  assert.equal(after.lift, 0);
});

test("pounce: it does not pounce again immediately", () => {
  const start = decide({ pointer: { onBar: true, pos: 500 }, x: 300 });
  let out = Brain.decide(input({ pointer: { onBar: true, pos: 500 }, x: 492 }), start.state);
  out = Brain.decide(
    input({ now: 10_000 + Brain.POUNCE_MS + 50, pointer: { onBar: true, pos: 500 }, x: 492 }),
    out.state,
  );
  assert.notEqual(out.reason, "pounce");
  const soon = Brain.decide(
    input({ now: 10_000 + Brain.POUNCE_MS + 200, pointer: { onBar: true, pos: 500 }, x: 492 }),
    out.state,
  );
  assert.notEqual(soon.reason, "pounce", "cooldown should hold it back");

  const eventually = Brain.decide(
    input({
      now: 10_000 + Brain.POUNCE_MS + Brain.POUNCE_COOLDOWN_MS + 500,
      pointer: { onBar: true, pos: 500 },
      x: 492,
    }),
    soon.state,
  );
  assert.equal(eventually.reason, "pounce", "and then allow another");
});

test("pounce: switching it off keeps the cat on the ground", () => {
  const config = { ...input().config, pounce: false };
  const start = decide({ pointer: { onBar: true, pos: 500 }, x: 300, config });
  const out = Brain.decide(
    input({ pointer: { onBar: true, pos: 500 }, x: 492, config }),
    start.state,
  );
  assert.notEqual(out.reason, "pounce");
  assert.equal(out.lift, 0);
});

test("pounce: it leaps into the screen, whichever edge the bar is on", () => {
  // On a top bar the cat must leap *downwards* — up is off the screen.
  for (const [edge, axis, outward, back] of [
    ["top", "h", ["dwleft", "dwright"], ["upleft", "upright"]],
    ["bottom", "h", ["upleft", "upright"], ["dwleft", "dwright"]],
    ["left", "v", ["dwright", "upright"], ["dwleft", "upleft"]],
    ["right", "v", ["dwleft", "upleft"], ["dwright", "upright"]],
  ]) {
    const start = decide({ edge, axis, pointer: { onBar: true, pos: 500 }, x: 300 });
    const out = Brain.decide(
      input({ edge, axis, pointer: { onBar: true, pos: 500 }, x: 492 }),
      start.state,
    );
    assert.equal(out.reason, "pounce", `${edge}: should pounce`);
    assert.ok(
      outward.includes(out.pose),
      `${edge}: leaving the bar should be one of ${outward}, got ${out.pose}`,
    );
    const returning = Brain.decide(
      input({ edge, axis, now: 10_000 + Brain.POUNCE_MS * 0.75, pointer: { onBar: true, pos: 500 }, x: 492 }),
      out.state,
    );
    assert.ok(
      back.includes(returning.pose),
      `${edge}: returning should be one of ${back}, got ${returning.pose}`,
    );
  }
});

test("pounce: a pouncing cat cannot be clicked and needs ticks", () => {
  const start = decide({ pointer: { onBar: true, pos: 500 }, x: 300 });
  const out = Brain.decide(input({ pointer: { onBar: true, pos: 500 }, x: 492 }), start.state);
  assert.equal(out.pettable, false);
  assert.equal(out.idle, false);
});

test("yarn: an active toy wins the cat's attention even while the pointer is on the bar", () => {
  const out = decide({
    x: 100,
    toy: { active: true, pos: 800 },
    pointer: { onBar: true, pos: 200 },
    notifyAt: 9_900,
    music: true,
  });
  assert.equal(out.reason, "toy");
  assert.equal(out.target, 800 - CAT / 2);
  assert.equal(out.gait, "run");
});

test("yarn: petting still wins the cat's attention", () => {
  const out = decide({
    pettedAt: 9_900,
    toy: { active: true, pos: 800 },
    x: 100,
  });
  assert.equal(out.reason, "petted");
});

test("yarn: catching the ball pounces, then reports one clean hit on landing", () => {
  const chasing = decide({ x: 300, toy: { active: true, pos: 500 } });
  let out = Brain.decide(
    input({ x: 492, toy: { active: true, pos: 500 } }),
    chasing.state,
  );
  assert.equal(out.reason, "pounce");
  assert.equal(out.toyHit, false);

  out = Brain.decide(
    input({ now: 10_000 + Brain.POUNCE_MS + 50, x: 492, toy: { active: true, pos: 500 } }),
    out.state,
  );
  assert.equal(out.toyHit, true);
  assert.equal(out.state.lastPounceAt, null, "yarn should not spend the cursor-pounce cooldown");
});

test("yarn: disabling pounces still lets the cat bat the ball on the ground", () => {
  const config = { ...input().config, pounce: false };
  const out = decide({ x: 492, toy: { active: true, pos: 500 }, config });
  assert.equal(out.reason, "toy");
  assert.equal(out.lift, 0);
  assert.equal(out.toyHit, true);
});

test("yarn: a bat arcs through the air, lands, then rolls to a stop", () => {
  const airborne = Brain.toyMotion(0.31);
  assert.equal(airborne.airborne, true);
  assert.ok(airborne.lift > 0.7, "the ball should be near the top of its arc");

  const landed = Brain.toyMotion(0.62);
  assert.equal(landed.airborne, false);
  assert.equal(landed.lift, 0);
  assert.equal(landed.along, 0.72);

  const rolling = Brain.toyMotion(0.8);
  assert.ok(rolling.along > landed.along && rolling.along < 1);
  assert.deepEqual(Brain.toyMotion(1), { along: 1, lift: 0, airborne: false });
});

test("yarn: pop and skitter profiles produce different play", () => {
  const pop = Brain.toyMotion(0.39, 1.05, 0.78, 0.86);
  assert.equal(pop.airborne, true);
  assert.ok(pop.lift > 1, "the pop should climb high");

  const skitter = Brain.toyMotion(0.32, 0.25, 0.32, 0.38);
  assert.deepEqual(skitter, { along: 0.38, lift: 0, airborne: false });
  assert.ok(pop.along > skitter.along, "the pop carries farther before landing");
});

test("yarn: games and bats vary while remaining bounded", () => {
  const state = Brain.freshState(42);
  const lengths = new Set();
  const profiles = new Set();
  for (let i = 0; i < 100; i++) {
    const length = Brain.toyGameLength(state);
    lengths.add(length);
    assert.ok(length >= 4 && length <= 7);

    const bat = Brain.nextToyBat(state, {
      barLength: BAR, toySize: 7, x: 500, lastDir: i % 2 ? -1 : 1,
    });
    profiles.add(bat.profile);
    assert.ok(bat.target >= 0 && bat.target <= BAR - 7);
    assert.ok(bat.duration > 0);
  }
  assert.deepEqual([...lengths].sort(), [4, 5, 6, 7]);
  assert.deepEqual([...profiles].sort(), ["fling", "pop", "skitter"]);
});

test("yarn: seeded play is reproducible but still varies distance and direction", () => {
  function transcript(seed) {
    const state = Brain.freshState(seed);
    return Array.from({ length: 40 }, () => {
      const bat = Brain.nextToyBat(state, {
        barLength: BAR, toySize: 7, x: 500, lastDir: 1,
      });
      return [bat.profile, Math.round(bat.target * 1000) / 1000, bat.duration];
    });
  }

  const first = transcript(42);
  assert.deepEqual(first, transcript(42));
  assert.notDeepEqual(first, transcript(43));
  assert.ok(new Set(first.map((bat) => bat[1])).size > 3, "distance should vary");
  assert.ok(first.some((bat) => bat[1] < 500), "some bats should reverse left");
  assert.ok(first.some((bat) => bat[1] > 500), "some bats should continue right");
});

test("yarn: a bat turns away from a blocked bar edge", () => {
  const bat = Brain.nextToyBat(Brain.freshState(7), {
    barLength: BAR, toySize: 7, x: 0, lastDir: -1,
  });
  assert.ok(bat.target > 0 && bat.target <= BAR - 7);
});

test("yarn: bat targets stay finite on both edges and degenerate bars", () => {
  for (const [barLength, toySize, x, lastDir] of [
    [BAR, 7, 0, -1],
    [BAR, 7, BAR - 7, 1],
    [BAR, 7, -100, -1],
    [BAR, 7, 5000, 1],
    [5, 7, 0, 1],
  ]) {
    const bat = Brain.nextToyBat(Brain.freshState(17), {
      barLength, toySize, x, lastDir,
    });
    assert.ok(Number.isFinite(bat.target));
    assert.ok(bat.target >= 0 && bat.target <= Math.max(0, barLength - toySize));
  }
});

test("the sleeping cat reports that it needs no ticks", () => {
  let out = decide({ now: 300_000, lastPointerMoveAt: 10_000, x: 500 });
  const chainTotal = Brain.CHAIN.reduce(
    (sum, s) => sum + (Number.isFinite(s.ms) ? s.ms : 0),
    0,
  );
  out = Brain.decide(
    input({ now: 300_000 + chainTotal + 1000, lastPointerMoveAt: 10_000, x: out.target }),
    out.state,
  );
  assert.equal(out.pose, "sleep");
  assert.equal(out.idle, true, "a sleeping cat should let the render timer stop");

  const busy = decide({ pointer: { onBar: true, pos: 900 }, x: 100 });
  assert.equal(busy.idle, false);
});


// ------------------------------------------------- keeping clear of the clock

test("spots the cat picks for itself avoid the middle of the bar", () => {
  // Omarchy centres the clock, so the middle is the one place reliably
  // occupied on nearly every setup.
  let state = Brain.freshState();
  const picks = [];
  for (let i = 0; i < 400; i++) {
    picks.push(Brain.pickSpot(state, BAR - CAT, BAR, 0.2));
  }
  const offenders = picks.filter((x) => inCentre(x));
  assert.equal(offenders.length, 0, `${offenders.length} picks landed on the clock`);
  // ...and it still uses both sides, rather than hugging one end.
  assert.ok(picks.some((x) => x < middle()), "should use the left of the bar");
  assert.ok(picks.some((x) => x > middle()), "should use the right of the bar");
  assert.ok(picks.every((x) => x >= 0 && x <= BAR - CAT), "and stay on the bar");
});

test("wandering keeps clear of the middle", () => {
  const config = { ...input().config, avoidCenter: 0.2 };
  let state = Brain.freshState();
  for (let i = 0; i < 60; i++) {
    // Arrive each time so the cat re-rolls a fresh target.
    const out = Brain.decide(input({ x: state.wanderTarget ?? 0, config }), state);
    state = out.state;
    if (out.reason === "wander") {
      assert.ok(!inCentre(out.target), `wander target ${out.target} sat on the clock`);
    }
  }
});

test("a stirring cat also keeps clear of the middle", () => {
  const chainTotal = Brain.CHAIN.reduce(
    (sum, s) => sum + (Number.isFinite(s.ms) ? s.ms : 0),
    0,
  );
  const config = { ...input().config, avoidCenter: 0.2 };
  let out = Brain.decide(input({ charging: true, x: 100, config }), Brain.freshState());
  out = Brain.decide(
    input({ charging: true, x: 100, now: 10_000 + chainTotal + 2000, config }),
    out.state,
  );
  const stirred = Brain.decide(
    input({
      charging: true, x: 100, config,
      now: 10_000 + chainTotal + 2000 + out.wakeIn + 10,
    }),
    out.state,
  );
  assert.equal(stirred.reason, "stir");
  assert.ok(!inCentre(stirred.target), `stir target ${stirred.target} sat on the clock`);
});

test("avoidCenter: 0 lets the cat use the whole bar again", () => {
  let state = Brain.freshState();
  const picks = [];
  for (let i = 0; i < 400; i++) picks.push(Brain.pickSpot(state, BAR - CAT, BAR, 0));
  assert.ok(picks.some((x) => inCentre(x)), "with avoidance off the middle is fair game");
});

test("chasing the pointer still goes to the middle if that is where you point", () => {
  // The keep-clear rule governs where the cat chooses to stop, not where you
  // send it. A cat that refused to come to the middle would just look broken.
  const out = decide({ pointer: { onBar: true, pos: BAR / 2 }, x: 100 });
  assert.equal(out.reason, "chase");
  assert.ok(inCentre(out.target), "the cat must still come when called to the centre");
});

test("a bar with no room outside the middle still yields a valid spot", () => {
  let state = Brain.freshState();
  for (const [maxX, len] of [[4, 20], [0, 16], [40, 56]]) {
    const x = Brain.pickSpot(state, maxX, len, 0.9);
    assert.ok(x >= 0 && x <= Math.max(0, maxX) && Number.isFinite(x), `got ${x}`);
  }
});


// --------------------------------------------------------------- notifications

test("a notification sends the cat to the end of the bar nearest the toast", () => {
  // Omarchy anchors toasts top-right, so on a horizontal bar that is the right
  // end; on a vertical bar it is the top.
  const out = decide({ notifyAt: 9_900, x: 200 });
  assert.equal(out.reason, "notification");
  assert.equal(out.gait, "run");
  assert.equal(out.target, BAR - CAT, "should head for the right end");

  const vertical = decide({ axis: "v", notifyAt: 9_900, x: 500 });
  assert.equal(vertical.target, 0, "on a vertical bar the toast is at the top");
});

test("having arrived under the toast the cat sits and watches", () => {
  const out = decide({ notifyAt: 9_900, x: BAR - CAT });
  assert.equal(out.reason, "notification");
  assert.equal(out.gait, "idle");
  assert.equal(out.pose, "stop", "it should watch, not fall asleep");
});

test("the notification wears off once the toast has gone", () => {
  const out = decide({ notifyAt: 10_000 - Brain.NOTIFY_MS - 1, x: 200 });
  assert.notEqual(out.reason, "notification");
});

test("a toast still on screen holds the cat's attention", () => {
  // The bar is wider than a short toast lives: at a run the cat needs about ten
  // seconds to cross it, and a low-priority toast is gone in five. Attention is
  // therefore tied to the toast actually being there, not to a timer, so a
  // long-lived or critical toast is still watched and the cat is not left
  // turning back halfway.
  const stale = 10_000 - Brain.NOTIFY_MS * 10;
  const out = decide({ notifying: true, notifyAt: stale, x: 200 });
  assert.equal(out.reason, "notification", "still on screen, still interesting");

  const gone = decide({ notifying: false, notifyAt: stale, x: 200 });
  assert.notEqual(gone.reason, "notification");
});

test("notifications outrank music and charging, but not you", () => {
  assert.equal(decide({ notifyAt: 9_900, music: true, charging: true }).reason, "notification");
  assert.equal(
    decide({ notifyAt: 9_900, pointer: { onBar: true, pos: 100 } }).reason, "chase",
    "your pointer still wins",
  );
});

test("notifications can be switched off", () => {
  const out = decide({
    notifyAt: 9_900,
    config: { ...input().config, reactions: { notification: false } },
  });
  assert.notEqual(out.reason, "notification");
});

// ------------------------------------------------------------- theme startle

test("switching theme startles the cat into a run", () => {
  const out = decide({ themeChangedAt: 9_800, x: 500 });
  assert.equal(out.reason, "theme");
  assert.equal(out.gait, "run");
  assert.notEqual(out.target, 500, "it should bolt somewhere");
});

test("a stale theme change stops mattering", () => {
  assert.notEqual(decide({ themeChangedAt: 1_000 }).reason, "theme");
});

test("a workspace switch outranks a theme change", () => {
  const out = decide({
    themeChangedAt: 9_800,
    workspaceEvent: { at: 9_800, dir: 1 },
    x: 500,
  });
  assert.equal(out.reason, "workspace", "a thing you did beats a thing that happened");
});

// -------------------------------------------------------- crepuscular rhythm

test("the day has phases, and they are the ones cats keep", () => {
  const phases = [0, 3, 5].map((h) => Brain.rhythmFor(h).phase);
  assert.deepEqual(phases, ["night", "night", "night"]);
  assert.equal(Brain.rhythmFor(7).phase, "dawn");
  assert.equal(Brain.rhythmFor(12).phase, "day");
  assert.equal(Brain.rhythmFor(18).phase, "dusk");
  assert.equal(Brain.rhythmFor(21).phase, "evening");
  assert.equal(Brain.rhythmFor(23).phase, "night");
});

test("dawn and dusk are the brisk ones", () => {
  assert.equal(Brain.rhythmFor(7).brisk, true);
  assert.equal(Brain.rhythmFor(18).brisk, true);
  assert.equal(Brain.rhythmFor(12).brisk, false);
  assert.equal(Brain.rhythmFor(2).brisk, false);
});

test("at night the cat gives up on the day sooner", () => {
  // Same idle gap, different hour: asleep at night, still pottering by day.
  const idle = { lastPointerMoveAt: 10_000, now: 10_000 + 70_000, x: 500 };
  const night = decide({ ...idle, hour: 2 });
  const day = decide({ ...idle, hour: 12 });
  assert.equal(night.reason, "idle-sleep", "70s of quiet is enough at 2am");
  assert.equal(day.reason, "wander", "but not at midday");
});

test("a brisk cat wanders at a run", () => {
  assert.equal(decide({ hour: 7 }).gait, "run", "dawn zoomies");
  assert.equal(decide({ hour: 12 }).gait, "walk", "ordinary daytime amble");
});

test("the rhythm can be switched off", () => {
  const config = { ...input().config, rhythm: false };
  const idle = { lastPointerMoveAt: 10_000, now: 10_000 + 70_000, x: 500, config };
  assert.equal(decide({ ...idle, hour: 2 }).reason, "wander", "night no longer special");
  assert.equal(decide({ hour: 7, config }).gait, "walk", "and dawn is not brisk");
});

test("an unknown hour behaves like an ordinary day", () => {
  // Every older test omits `hour`; none of them should change behaviour.
  const r = Brain.rhythmFor(undefined);
  assert.equal(r.phase, "day");
  assert.equal(r.sleepAfterScale, 1);
  assert.equal(r.stirEveryScale, 1);
  assert.equal(r.brisk, false);
});
