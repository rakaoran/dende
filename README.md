# Dende

It's a wrapper around the HTML5 Canvas made specifically for turn-based drawing games (think Gartic or Skribbl).

The main problem with raw canvas is that syncing it over a network is a pain. Sending an image every frame is heavy, and sending raw coordinates gets messy. Dende handles the state, the history (undo/redo), and serializes everything into tiny binary packets (Protobufs) that you can just fire over a socket.

**Published on npm** as `@rakaoran/dende` so you can just `npm install` it and get going. No need to build from source unless you're making changes.

## How to Build

If you're hacking on this or just cloned it, here's how to build the `dist` folder:

```bash
npm install
npm run build
```

This uses `tsup` to compile the TypeScript and Protobuf stuff into ESM and CJS bundles in the `dist/` folder.

## How it Actually Works

You don't need to manually handle `mousedown` or `mousemove` events. Dende does that.

1. **Local Drawing**: When you draw, Dende updates your canvas immediately so it feels responsive.
2. **Serialization**: In the background, it batches your strokes into `DendePart` objects.
3. **Broadcasting**: It fires an event with a `Uint8Array` (bytes). You send this byte array to other players however you want (WebSocket, WebRTC, whatever).
4. **Remote Drawing**: When you receive bytes from someone else, you feed them into Dende, and it draws them exactly as they happened.

## Quick Start

### 1. Init

Create the instance and slap it into the DOM.

```typescript
import Dende from "@rakaoran/dende";

// 800x600 canvas
const board = new Dende(800, 600);
document.body.appendChild(board.getHTMLElement());

// Turn on drawing (cursor becomes a crosshair)
board.enableDrawing();
```

### 2. Sending Data

Listen for parts. This triggers whenever you draw a line, fill a bucket, clear the screen, or undo.

```typescript
board.addPartListener((bytes) => {
    // 'bytes' is a Uint8Array. 
    // Send this to your server/peers immediately.
    socket.emit("draw_action", bytes);
});
```

### 3. Receiving Data

When data comes in from the network, just shove it into `putPart`.

```typescript
socket.on("draw_action", (data) => {
    // Dende knows what to do with it.
    board.putPart(new Uint8Array(data));
});
```

## Features

- **It uses Protobufs**: The data is binary. It's way smaller than JSON.
- **Undo/Redo**: It's built-in. `board.undo()` removes the last stroke locally and emits an undo packet so everyone else sees the undo happen too.
- **Bucket Fill**: It has a flood fill algorithm (`board.setDrawingMode("filling")`).
- **FPS Throttling**: By default, it sends updates at ~30 FPS (`delay: 33ms`) to save bandwidth. You can change this with `board.setFPS(60)`.
- **Scaling**: It handles `devicePixelRatio` automatically, so lines won't look blurry on Retina screens.

> Note: You can't both draw and receive drawing at the same time, you switch between the two modes (drawing and receiving) using `enableDrawing()` and `disableDrawing()`

## API Cheat Sheet

| Method                         | What it does                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `enableDrawing()`              | Unlocks the canvas for local drawing.                                           |
| `disableDrawing()`             | Lock the canvas for drawing receiving only.                                     |
| `setLineColorRGBA(r, g, b, a)` | Sets your brush color.                                                          |
| `setLineWidth(px)`             | Sets brush size.                                                                |
| `setDrawingMode("filling")`    | Switches to bucket tool.                                                        |
| `undo()` / `redo()`            | Moves through history stack.                                                    |
| `clear()`                      | Wipes everything.                                                               |
| `reset()`                      | Local only. Hard reset (clears history & canvas) without telling other players. |
