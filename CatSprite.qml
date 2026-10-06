// Draws one frame of the cat, themed.
//
// oneko's frames are two-colour: a silhouette and, inside it, the ink that
// makes up the outline, face, and paws. We keep those as two alpha-only sheets
// and tint each one separately, so the cat takes the bar's own colours and
// follows a theme switch without any asset rebuild.
//
// The fill sheet holds the *whole* silhouette and the ink is painted on top of
// it. Cutting the two into disjoint regions instead would show hairline seams
// wherever the compositor scales the sprite by a fractional factor — which is
// the normal case on a scaled output.

import QtQuick
import QtQuick.Effects
import "Frames.js" as Frames

Item {
  id: root

  property string pose: "stop"
  property int animTick: 0
  property color fillColor: "white"
  property color inkColor: "black"
  property string assetDir: ""
  // Which sprite set to draw. Every character shares the same 32-frame layout,
  // so switching is purely a change of source sheet.
  property string character: "neko"
  // Device pixels this sprite actually occupies, which decides which sheet is
  // the better source.
  property real devicePixels: width

  implicitWidth: 16
  implicitHeight: 16

  // The 16px sheet is a hand-tuned reduction; it beats letting the GPU shrink
  // the 32px art, but only while it is not itself being stretched. Past 16
  // device pixels the native sheet has the detail to spare.
  readonly property int cell: devicePixels <= 16 ? 16 : 32
  // Scaling by exactly 1:1 wants nearest-neighbour so the pixels stay hard;
  // anything else wants filtering, because fractional nearest-neighbour drops
  // and doubles rows at random.
  readonly property bool crisp: cell === width
  readonly property bool shellPose: character === "turtle" && pose === "shell"
  readonly property string sheetCharacter: shellPose ? "turtle-shell" : character
  readonly property int sheetFrames: shellPose ? 1 : Frames.COUNT

  readonly property var pattern: Frames.POSES[pose] !== undefined
    ? Frames.POSES[pose]
    : Frames.POSES["stop"]
  // Sleeping breathes at a quarter of the rate, exactly as oneko does it
  // (oneko.c:1101 shifts the tick right by two for the sleep state).
  readonly property int frame: shellPose ? 0 : (pose === "sleep"
    ? pattern[(animTick >> 2) & 1]
    : pattern[animTick & 1])

  // Tinting goes through `layer.effect` rather than MultiEffect's `source`
  // property. The source form needs a visible source item, so hiding the
  // untinted sheet to stop it drawing over the tinted one leaves the effect
  // with nothing to render and the cat never appears. Layering the item and
  // replacing its own rendering avoids the problem entirely, and is the form
  // the rest of the shell uses.
  component SheetLayer: Item {
    id: sheetLayer

    property string sheet
    property color tint

    anchors.fill: parent
    // The layer renders into an item-sized texture, which crops the sheet to
    // the current frame without a separate clip pass.
    layer.enabled: true
    layer.smooth: !root.crisp
    layer.effect: MultiEffect {
      colorization: 1.0
      colorizationColor: sheetLayer.tint
    }

    Image {
      // The whole sheet is laid out at the target cell size and slid sideways,
      // so changing frame is a translation rather than a texture reload.
      //
      // Empty until the plugin knows where it lives on disk; asking for
      // "/cat32-fill.png" resolves against the filesystem root and warns.
      source: root.assetDir === ""
        ? ""
        : root.assetDir + "/" + root.sheetCharacter + root.cell + "-" + sheetLayer.sheet + ".png"
      width: root.width * root.sheetFrames
      height: root.height
      x: -root.frame * root.width
      smooth: !root.crisp
      mipmap: false
      cache: true
      fillMode: Image.Stretch
    }
  }

  SheetLayer { sheet: "fill"; tint: root.fillColor }
  SheetLayer { sheet: "ink"; tint: root.inkColor }
}
