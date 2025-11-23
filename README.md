# Dende – A Canvas Wrapper for Turn-based Drawing Apps

Dende is a lightweight TypeScript drawing package built for real-time turn-based (only one player draws at a time) drawing applications. It manages canvas state, handles local drawing interactions, and provides a clean event system for serializing and transmitting drawing actions over the network.

## Key Features

- **Dual-mode drawing**: Toggle between freehand drawing and bucket fill
- **Local state preservation**: Your settings (color, line width) stay intact even when others draw
- **Event-driven architecture**: Every action emits a serializable `DendePart` object
- **Undo/Redo stacks**: Full history management with configurable depth
- **Network-friendly**: No built-in networking, you get to choose how (json, protobuf... whatever suits you)
- **Configurable performance**: Control update frequency via FPS settings
- **High-DPI support**: Automatic scaling for Retina and high-density displays

## Main Methods

### Initialization

```typescript
const dende = new Dende(800, 600); // width, height
document.body.appendChild(dende.getHTMLElement());
```

### Drawing Control

| Method | Description |
|--------|-------------|
| `setDrawingMode(mode: "drawing" \| "filling")` | Switch between freehand and bucket fill |
| `setLineColorRGBA(r, g, b, a)` | Set your brush color (0-255 or 0-1 for alpha) |
| `setLineWidth(width: number)` | Set brush thickness |
| `setFPS(fps: number)` | Control how often drawing updates are sent (default ~30 FPS) |
| `enableDrawing()` | Allow local drawing input |
| `disableDrawing()` | Block local drawing (use when waiting for opponent's turn) |

### History

| Method | Description |
|--------|-------------|
| `undo()` | Undo last action and emit it as a part |
| `redo()` | Redo last undone action and emit it as a part |
| `clear()` | Wipe the canvas and emit a clear part |
| `reset()` | Hard reset: clear canvas, empty history stacks |

### Events & Network

| Method | Description |
|--------|-------------|
| `addPartListener(callback)` | Listen for drawing events (fired when user draws/fills/undos/clears) |
| `putPart(part: DendePart)` | Apply a remote DendePart (e.g., from opponent's actions) |
| `getHTMLElement()` | Get the underlying canvas element |

### Accessors

```typescript
dende.getDrawingMode();  // "drawing" | "filling"
dende.getWidth();
dende.getHeight();
```

## DendePart – The Core Data Type

Every drawing action is wrapped in a `DendePart` object, and the types are used as enum to reduce data sent over the network (sending 0 instead of "drawing"):

```typescript
export enum DendePartType {
    Drawing,  // Stroke with coordinates
    Filling,  // Bucket fill at a point
    Undo,     // Undo action
    Redo,     // Redo action
    Clear     // Clear canvas
}

class DendePart {
    type: DendePartType;
    isLineEnd: boolean;           // True if this completes a stroke
    coordinates: Array<number>;   // [x1, y1, x2, y2, ...] flattened
    color: RGBA;                  // [r, g, b, a]
    lineWidth: number;
}
```

## Usage Example: Turn-Based Drawing Game

See the HTML and Js files attached, two canvases and one listens to the other.

To generate the `dist/` file run: `tsc`.

## Why Dende Works Great for Turn-Based Drawing

**Separation of concerns**: Dende handles rendering and state. You handle networking. This means:
- You can serialize `DendePart` objects however you want (JSON, binary, protobuf, etc.)
- You control transport (WebSocket, HTTP, carrier pigeon)
- You decide retry logic, compression, and conflict resolution

**Efficient updates**: Drawing strokes are batched and sent at configurable intervals (via `setFPS`). A stroke that takes 200ms to draw might only send 6–7 updates instead of 200, keeping bandwidth low.

**Turn-based friendly**: Disable drawing with `disableDrawing()` while waiting. Remote actions come through `putPart()` without interfering with local state.

**Local state isolation**: When your opponent draws in their color, it doesn't clobber your brush settings. The library preserves your `myColorRGBA` and `myLineWidth` separately from the shared canvas context.

**Full history**: Undo/redo actions are also emitted as parts, so your opponent sees the exact same history state.

## Tips

- Use lower FPS for slower networks: `dende.setFPS(15)` instead of 30
- Disable drawing when you want to listen to incoming data
- The library handles high-DPI displays automatically