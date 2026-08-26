// An occasional, self-contained yarn game: lifecycle, motion, and rendering.

import QtQuick
import "Brain.js" as Brain

Item {
  id: root

  property bool playEnabled: true
  property bool blocked: false
  property var brainState: null
  property real barLength: 0
  property real catPos: 0
  property int catSize: 16
  property int lastDir: 1
  property int tickMs: 33

  property bool vertical: false
  property int headroom: 0
  property int inwardSign: 1
  property real stripCentre: 0
  property color fillColor: "white"
  property color inkColor: "black"

  property bool active: false
  readonly property int ballSize: Math.max(6, Math.round(catSize * 0.44))
  readonly property real targetCentre: target + ballSize / 2
  readonly property bool scheduled: alarm.running
  readonly property int scheduledIn: alarm.interval

  property real target: 0
  property real drawPos: 0
  property real lift: 0
  property real flightFrom: 0
  property real flightAt: -1
  property int flightMs: 650
  property int batsLeft: 0
  property int direction: 1
  property real travel: 0
  property bool airborne: false
  property real tailKick: 0
  property real hop: 0.75
  property real airEnd: 0.62
  property real landAt: 0.72

  signal wakeRequested()
  signal pleased(real at)

  visible: active
  width: ballSize * 8
  height: width

  readonly property real inset: ballSize * 3.5
  readonly property real crossPos:
    stripCentre + lift * headroom * inwardSign - ballSize / 2

  x: vertical ? Math.round(crossPos - inset) : Math.round(drawPos - inset)
  y: vertical ? Math.round(drawPos - inset) : Math.round(crossPos - inset)

  function schedule() {
    if (!playEnabled) {
      alarm.stop()
      return
    }
    // An occasional surprise, not something that takes over the bar.
    alarm.interval = 180000 + Math.round(Math.random() * 300000)
    alarm.restart()
  }

  function startGame() {
    if (active || !playEnabled) return
    if (blocked || !brainState || barLength <= 0) {
      alarm.interval = 30000
      alarm.restart()
      return
    }

    alarm.stop()
    var start = Math.max(0, Math.min(
      barLength - ballSize, catPos + (catSize - ballSize) / 2))
    active = true
    batsLeft = Brain.toyGameLength(brainState)
    target = start
    drawPos = start
    lift = 0
    flightAt = -1
    travel = 0
    airborne = false
    tailKick = 0
    direction = lastDir || 1
    hop = 0.75
    airEnd = 0.62
    landAt = 0.72
    wakeRequested()
  }

  function launch(to, duration, now) {
    var maxPos = Math.max(0, barLength - ballSize)
    flightFrom = Math.max(0, Math.min(maxPos, drawPos))
    target = Math.max(0, Math.min(maxPos, to))
    if (target !== flightFrom) direction = target > flightFrom ? 1 : -1
    drawPos = flightFrom
    flightMs = duration
    flightAt = now
    lift = 0
    airborne = true
    tailKick = 0
  }

  function step(now) {
    if (tailKick > 0) tailKick = Math.max(0, tailKick - tickMs / 420)
    if (!active || flightAt < 0) return

    var progress = Math.min(1, (now - flightAt) / flightMs)
    var previous = drawPos
    var motion = Brain.toyMotion(progress, hop, airEnd, landAt)
    if (airborne && !motion.airborne) tailKick = 1
    airborne = motion.airborne
    drawPos = flightFrom + (target - flightFrom) * motion.along
    lift = motion.lift
    travel += Math.abs(drawPos - previous)

    if (progress >= 1) {
      drawPos = target
      lift = 0
      airborne = false
      flightAt = -1
    }
  }

  function hit(now) {
    if (!active || !playEnabled) return
    batsLeft--
    if (batsLeft <= 0) {
      active = false
      lift = 0
      pleased(now)
      schedule()
      return
    }

    var bat = Brain.nextToyBat(brainState, {
      barLength: barLength,
      toySize: ballSize,
      x: target,
      lastDir: lastDir,
    })
    hop = bat.hop
    airEnd = bat.airEnd
    landAt = bat.landAt
    launch(bat.target, bat.duration, now)
  }

  Timer {
    id: alarm
    repeat: false
    onTriggered: root.startGame()
  }

  onPlayEnabledChanged: {
    if (!playEnabled) {
      alarm.stop()
      active = false
    } else {
      schedule()
    }
  }
  Component.onCompleted: schedule()

  Canvas {
    id: canvas
    anchors.fill: parent
    antialiasing: false
    rotation: root.vertical ? 90 : 0

    property int rollFrame: Math.floor(root.travel
      / Math.max(1, root.ballSize * 0.55)) % 4
    property real unravel: Math.min(1, root.travel
      / Math.max(1, root.catSize * 28))
    property int currentDirection: root.direction
    property bool currentAirborne: root.airborne
    property real currentTailKick: root.tailKick
    property color currentFill: root.fillColor
    property color currentInk: root.inkColor

    onRollFrameChanged: requestPaint()
    onUnravelChanged: requestPaint()
    onCurrentDirectionChanged: requestPaint()
    onCurrentAirborneChanged: requestPaint()
    onCurrentTailKickChanged: requestPaint()
    onCurrentFillChanged: requestPaint()
    onCurrentInkChanged: requestPaint()

    onPaint: {
      var ctx = getContext("2d")
      var s = root.ballSize
      var unit = s / 7
      var pixel = Math.max(1, unit)
      var centre = s * 4
      var left = centre - s / 2
      var top = centre - s / 2

      ctx.clearRect(0, 0, width, height)

      // Travel pulls thread from the ball. In flight it trails almost taut; on
      // the bar it pools into an S-curve and whips once when the ball lands.
      var tailLength = s * (0.7 + unravel * 2.7)
      var tailReach = currentAirborne
        ? tailLength : tailLength * (1 - unravel * 0.28)
      var bend = currentAirborne ? s * 0.06 : s * (0.2 + unravel * 0.45)
      var coil = currentAirborne ? 0 : s * unravel * 0.35
      if (currentTailKick > 0) {
        bend += Math.sin((1 - currentTailKick) * Math.PI * 2)
          * currentTailKick * s * 0.65
      }
      ctx.fillStyle = currentFill
      var tailSteps = Math.round(6 + unravel * 14)
      for (var i = 0; i <= tailSteps; i++) {
        var t = i / tailSteps
        var tx = centre - currentDirection * (s * 0.38 + tailReach * t)
        var ty = centre + s * 0.12 + bend * Math.sin(Math.PI * t)
          + coil * Math.sin(Math.PI * 2 * t)
        ctx.fillRect(
          Math.round(tx - pixel / 2), Math.round(ty - pixel / 2), pixel, pixel)
      }

      // Seven-pixel ball: dark silhouette, light body, then one wrapped strand
      // pattern rotated through four snapped, distance-driven frames.
      var outer = [[2, 3], [1, 5], [0, 7], [0, 7], [0, 7], [1, 5], [2, 3]]
      ctx.fillStyle = currentInk
      for (var y = 0; y < outer.length; y++) {
        ctx.fillRect(
          Math.round(left + outer[y][0] * unit), Math.round(top + y * unit),
          Math.ceil(outer[y][1] * unit), Math.ceil(unit))
      }

      var inner = [[2, 3], [1, 5], [1, 5], [1, 5], [2, 3]]
      ctx.fillStyle = currentFill
      for (var iy = 0; iy < inner.length; iy++) {
        ctx.fillRect(
          Math.round(left + inner[iy][0] * unit),
          Math.round(top + (iy + 1) * unit),
          Math.ceil(inner[iy][1] * unit), Math.ceil(unit))
      }

      var strand = [
        [2, 1], [3, 1], [4, 2], [4, 3], [3, 3], [2, 3],
        [2, 4], [3, 5], [4, 5], [1, 3], [5, 3]
      ]
      ctx.fillStyle = currentInk
      for (var p = 0; p < strand.length; p++) {
        var px = strand[p][0]
        var py = strand[p][1]
        for (var turn = 0; turn < rollFrame; turn++) {
          var oldX = px
          px = 6 - py
          py = oldX
        }
        ctx.fillRect(
          Math.round(left + px * unit), Math.round(top + py * unit), pixel, pixel)
      }
    }
  }
}
