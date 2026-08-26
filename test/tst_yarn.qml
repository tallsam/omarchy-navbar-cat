import QtQuick
import QtTest
import ".."
import "../Brain.js" as Brain

TestCase {
  id: testCase
  name: "Yarn"

  property var yarn: null

  Component {
    id: yarnComponent
    Yarn {}
  }

  SignalSpy {
    id: pleasedSpy
    signalName: "pleased"
  }

  function init() {
    yarn = createTemporaryObject(yarnComponent, testCase, {
      playEnabled: false,
      brainState: Brain.freshState(42),
      barLength: 1000,
      catPos: 300,
      catSize: 16,
      lastDir: 1,
      tickMs: 33,
      stripCentre: 13,
      headroom: 24,
      inwardSign: 1,
    })
    verify(yarn)
    compare(yarn.scheduled, false)
    pleasedSpy.target = yarn
    pleasedSpy.clear()
  }

  function cleanup() {
    pleasedSpy.target = null
    yarn = null
  }

  function verifyNormalSchedule() {
    verify(yarn.scheduled)
    verify(yarn.scheduledIn >= 180000)
    verify(yarn.scheduledIn <= 480000)
  }

  function test_defaultConstructionSchedulesFirstGame() {
    var defaultYarn = createTemporaryObject(yarnComponent, testCase, {
      brainState: Brain.freshState(42),
      barLength: 1000,
      catPos: 300,
    })
    verify(defaultYarn)
    verify(defaultYarn.scheduled)
    verify(defaultYarn.scheduledIn >= 180000)
    verify(defaultYarn.scheduledIn <= 480000)
  }

  function test_blockedStartRetriesSoon() {
    yarn.playEnabled = true
    verifyNormalSchedule()
    yarn.blocked = true
    yarn.startGame()
    compare(yarn.active, false)
    compare(yarn.scheduledIn, 30000)
  }

  function test_completeGameEmitsPleasureOnceAndReschedules() {
    yarn.playEnabled = true
    yarn.startGame()
    verify(yarn.active)
    verify(yarn.batsLeft >= 4 && yarn.batsLeft <= 7)
    compare(yarn.scheduled, false)

    var hits = yarn.batsLeft
    var now = 10000
    for (var i = 0; i < hits; i++) {
      yarn.hit(now)
      if (yarn.active) {
        verify(yarn.flightAt >= 0)
        now += yarn.flightMs + 1
        yarn.step(now)
        compare(yarn.flightAt, -1)
        fuzzyCompare(yarn.drawPos, yarn.target, 0.001)
      }
    }

    compare(yarn.active, false)
    compare(pleasedSpy.count, 1)
    verifyNormalSchedule()
    yarn.hit(now + 1)
    compare(pleasedSpy.count, 1)
  }

  function test_disableCancelsGameAndReenableSchedules() {
    yarn.playEnabled = true
    yarn.startGame()
    verify(yarn.active)

    yarn.playEnabled = false
    compare(yarn.active, false)
    compare(yarn.scheduled, false)
    yarn.hit(10000)
    compare(pleasedSpy.count, 0)

    yarn.playEnabled = true
    verifyNormalSchedule()
  }

  function test_verticalGeometrySwapsAxesAndZeroHeadroomStaysOnBar() {
    yarn.active = true
    yarn.drawPos = 100
    yarn.lift = 1

    yarn.vertical = false
    var horizontalX = yarn.x
    var horizontalY = yarn.y
    yarn.vertical = true
    compare(yarn.x, horizontalY)
    compare(yarn.y, horizontalX)

    yarn.vertical = false
    yarn.headroom = 0
    compare(yarn.y, Math.round(
      yarn.stripCentre - yarn.ballSize / 2 - yarn.inset))
  }
}
