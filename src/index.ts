import { DendePart as ProtoDendePart, DendePart_PartType } from "./dende.js";

export type DendeMode = "drawing" | "filling";
export type RGBA = [number, number, number, number];

export enum DendePartType {
    Drawing, Filling, Undo, Redo, Clear
}

export interface IDendePart {
    type: DendePartType;
    isLineEnd: boolean;
    coordinates: Array<number>;
    color: RGBA;
    lineWidth: number;
}

/**
 * Represents a single action on the board (a line segment, a fill, a clear, etc).
 * Mostly used internally to structure data before serialization.
 */
export class DendePart implements IDendePart {
    type: DendePartType;
    isLineEnd: boolean;
    coordinates: Array<number>;
    color: RGBA;
    lineWidth: number;

    constructor() {
        this.coordinates = [];
        this.isLineEnd = false;
        this.type = DendePartType.Drawing;
        this.color = [0, 0, 0, 1];
        this.lineWidth = 2;
    }

    static fillWithColorAtPoint(rgba: RGBA, x: number, y: number): IDendePart {
        const p = new DendePart();
        p.type = DendePartType.Filling;
        p.color = rgba;
        p.coordinates.push(x, y);
        return p;
    }

    static clearBoard(): IDendePart {
        const p = new DendePart();
        p.type = DendePartType.Clear;
        return p;
    }

    static Undo(): IDendePart {
        const p = new DendePart();
        p.type = DendePartType.Undo;
        return p;
    }

    static Redo(): IDendePart {
        const p = new DendePart();
        p.type = DendePartType.Redo;
        return p;
    }
}

/**
 * The main Dende engine.
 * Handles the canvas DOM element, user interaction events, history stack, and Protocol Buffer serialization.
 */
export default class Dende {
    private canvas: HTMLCanvasElement;
    private width: number;
    private height: number;
    private ctx: CanvasRenderingContext2D;

    private isDrawing: boolean = false;
    private mode: DendeMode = "drawing";
    private delay: number = 33;

    private partListeners: Array<(p: Uint8Array) => any> = [];

    private pointsBuffer: Array<number> = [];
    private lastSent: number = Date.now();
    private otherStartedDrawing: boolean = false;

    private myColorRGBA: RGBA = [0, 0, 0, 1];
    private myLineWidth: number = 2;

    private undoStack: Array<ImageData> = []
    private redoStack: Array<ImageData> = []
    private readonly MAX_HISTORY = 20;

    private canDraw: boolean = true;

    /**
     * @param width The logical width of the canvas in pixels.
     * @param height The logical height of the canvas in pixels.
     */
    constructor(width: number, height: number) {
        this.canvas = document.createElement("canvas")
        const dpr = window.devicePixelRatio || 1;

        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;

        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;

        this.width = width;
        this.height = height;

        this.mode = "drawing";
        this.undoStack = [];
        this.redoStack = [];

        this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
        this.ctx.lineJoin = "round";
        this.ctx.lineCap = "round";
        this.ctx.scale(dpr, dpr);

        this.saveSnapshot();
        this.attachEvents();
    }

    /**
     * Unlocks the canvas, allowing the user to draw or fill.
     * Sets the cursor to 'crosshair'.
     */
    public enableDrawing() {
        this.canDraw = true;
        this.canvas.style.cursor = "crosshair";
    }

    /**
     * Subscribes to drawing events.
     * The callback receives a Uint8Array (serialized Protobuf) whenever the user performs an action.
     * Broadcast this byte array to other clients to sync the drawing.
     */
    public addPartListener(cb: (p: Uint8Array) => any) {
        this.partListeners.push(cb);
    }

    /**
     * Locks the canvas so the user cannot interact with it.
     * Useful when the user is in "view-only" mode.
     */
    public disableDrawing() {
        if (this.isDrawing) {
            this.isDrawing = false;
            this.ctx.stroke();
            this.ctx.closePath();
            this.flushBuffer(true);
            this.saveSnapshot();
        }

        this.canDraw = false;
        this.canvas.style.cursor = "default";
    }

    private attachEvents() {
        const stopDrawing = () => {
            if (!this.isDrawing) return;
            this.isDrawing = false;
            this.ctx.closePath();
            this.flushBuffer(true)
            this.saveSnapshot();
        }

        this.canvas.addEventListener("mouseup", stopDrawing)
        this.canvas.addEventListener("mouseleave", stopDrawing)

        this.canvas.addEventListener("mousedown", (e) => {
            if (!this.canDraw) return;
            const x = e.offsetX;
            const y = e.offsetY;

            this.redoStack = [];

            if (this.mode == "filling") {
                this._fillAtPoint(x, y, this.myColorRGBA);
                const dendePart = DendePart.fillWithColorAtPoint(this.myColorRGBA, x, y)
                this.emitPart(dendePart)
                this.saveSnapshot();
            } else if (this.mode == "drawing") {
                this.isDrawing = true;
                this.applyLocalSettings();

                this.pointsBuffer.push(x, y);
                this.ctx.beginPath();
                this.ctx.moveTo(x, y);
                this.ctx.lineTo(x, y);
                this.ctx.stroke();
            }
        });

        this.canvas.addEventListener("mousemove", (e) => {
            if (!this.isDrawing || !this.canDraw) return;
            const x = e.offsetX;
            const y = e.offsetY;

            this.ctx.lineTo(x, y);
            this.ctx.stroke();
            this.pointsBuffer.push(x, y);

            if (Date.now() - this.lastSent >= this.delay) {
                this.flushBuffer(false);
            }
        })
    }

    private applyLocalSettings() {
        const [r, g, b, a] = this.myColorRGBA;
        this.ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
        this.ctx.lineWidth = this.myLineWidth;
    }

    /**
     * Reverts the last action (drawing, filling, or clearing).
     * Emits an Undo part so connected clients also undo.
     */
    public undo() {
        this._undo()
        this.emitPart(DendePart.Undo())
    }

    private _undo() {
        if (this.undoStack.length < 2) return;

        const current = this.ctx.getImageData(0, 0, this.width, this.height);
        this.redoStack.push(current);

        this.undoStack.pop();
        const previous = this.undoStack[this.undoStack.length - 1];

        if (previous) {
            this.ctx.putImageData(previous, 0, 0);
        }
    }

    /**
     * Re-applies the last undone action.
     * Emits a Redo part so connected clients also redo.
     */
    public redo() {
        this._redo();
        this.emitPart(DendePart.Redo())
    }

    private _redo() {
        if (this.redoStack.length === 0) return;

        const next = this.redoStack.pop();
        if (!next) return;

        const current = this.ctx.getImageData(0, 0, this.width, this.height);
        this.undoStack.push(current);

        this.ctx.putImageData(next, 0, 0);
    }

    private flushBuffer(isEnding: boolean) {
        if (this.mode !== "drawing") return;

        const part = new DendePart();
        part.type = DendePartType.Drawing;
        part.isLineEnd = isEnding;
        part.color = this.myColorRGBA;
        part.coordinates = [...this.pointsBuffer]
        part.lineWidth = this.myLineWidth;

        this.emitPart(part);

        this.lastSent = Date.now();
        this.pointsBuffer = [];
    }

    private saveSnapshot() {
        const snapshot = this.ctx.getImageData(0, 0, this.width, this.height);
        this.undoStack.push(snapshot)
        if (this.undoStack.length > this.MAX_HISTORY) {
            this.undoStack.shift()
        }
    }

    private _fillAtPoint(startX: number, startY: number, color: RGBA) {
        const imageData = this.ctx.getImageData(0, 0, this.width, this.height);
        const data = imageData.data;

        const startPos = (Math.floor(startY) * this.width + Math.floor(startX)) * 4;
        const startR = data[startPos];
        const startG = data[startPos + 1];
        const startB = data[startPos + 2];
        const startA = data[startPos + 3];

        const fillR = color[0];
        const fillG = color[1];
        const fillB = color[2];
        const fillA = Math.floor(color[3] * 255);

        if (startR === fillR && startG === fillG && startB === fillB && startA === fillA) return;

        const stack = [Math.floor(startX), Math.floor(startY)];

        while (stack.length > 0) {
            const y = stack.pop();
            const x = stack.pop();
            if (y === undefined || x === undefined) continue;
            const pos = (y * this.width + x) * 4;
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;

            if (data[pos] === startR && data[pos + 1] === startG && data[pos + 2] === startB && data[pos + 3] === startA) {
                data[pos] = fillR; data[pos + 1] = fillG; data[pos + 2] = fillB; data[pos + 3] = fillA;
                stack.push(x - 1, y); stack.push(x + 1, y); stack.push(x, y - 1); stack.push(x, y + 1);
            }
        }
        this.ctx.putImageData(imageData, 0, 0);
    }

    /**
     * Wipes the entire canvas and resets the redo stack.
     * Emits a Clear part.
     */
    public clear() {
        this._clear();
        this.saveSnapshot();
        this.emitPart(DendePart.clearBoard());
    }

    private _clear() {
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.redoStack = [];
    }

    /**
     * Hard reset. Clears canvas, history stacks, and mode state.
     * Does NOT emit a network event (local only).
     */
    public reset() {
        this._clear()
        this.ctx.closePath()
        this.isDrawing = false
        this.otherStartedDrawing = false;
        this.mode = "drawing"
        this.enableDrawing()
        this.undoStack = []
        this.redoStack = []
        this.saveSnapshot()
    }

    /**
     * Converts an IDendePart object into Protobuf bytes and triggers the listener.
     * Use this if you need to manually synthesize an event.
     */
    emitPart(p: IDendePart) {
        const protoMessage = {
            type: p.type as number,
            isLineEnd: p.isLineEnd,
            coordinates: p.coordinates.map(c => Math.round(c)),
            color: {
                r: p.color[0],
                g: p.color[1],
                b: p.color[2],
                a: p.color[3]
            },
            lineWidth: p.lineWidth
        };

        const bytes = ProtoDendePart.toBinary(protoMessage);
        this.partListeners.forEach(cb => cb(bytes));
    }

    /**
     * Deserializes raw bytes (Protobuf) and renders the result onto the canvas.
     * Feed this method the data you receive from other clients/server.
     * * @param bytes The binary data received from the network.
     */
    public putPart(bytes: Uint8Array) {
        if (this.canDraw) return;

        const part = ProtoDendePart.fromBinary(bytes);
        const colorData = part.color || { r: 0, g: 0, b: 0, a: 1 };
        const rgba: RGBA = [colorData.r, colorData.g, colorData.b, colorData.a];

        switch (part.type) {
            case DendePart_PartType.CLEAR: {
                this.redoStack = []
                this.ctx.clearRect(0, 0, this.width, this.height);
                this.saveSnapshot();
                break;
            }

            case DendePart_PartType.FILLING: {
                this.redoStack = []
                if (part.coordinates.length >= 2) {
                    this._fillAtPoint(part.coordinates[0], part.coordinates[1], rgba);
                    this.saveSnapshot();
                }
                break;
            }

            case DendePart_PartType.DRAWING: {
                this.redoStack = []
                const [r, g, b, a] = rgba;

                this.ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
                this.ctx.lineWidth = part.lineWidth;
                this.ctx.lineCap = "round";
                this.ctx.lineJoin = "round";

                if (!this.otherStartedDrawing) {
                    this.otherStartedDrawing = true;
                    this.ctx.beginPath();
                    if (part.coordinates.length >= 2) {
                        this.ctx.moveTo(part.coordinates[0], part.coordinates[1]);
                        this.ctx.lineTo(part.coordinates[0], part.coordinates[1]);
                        this.ctx.stroke();

                        for (let i = 2; i < part.coordinates.length; i += 2) {
                            this.ctx.lineTo(part.coordinates[i], part.coordinates[i + 1]);
                        }
                    }
                } else {
                    for (let i = 0; i < part.coordinates.length; i += 2) {
                        this.ctx.lineTo(part.coordinates[i], part.coordinates[i + 1]);
                    }
                }
                this.ctx.stroke();

                if (part.isLineEnd) {
                    this.saveSnapshot();
                    this.otherStartedDrawing = false;
                    this.ctx.stroke()
                }

                break;
            }

            case DendePart_PartType.REDO: {
                this._redo();
                break;
            }

            case DendePart_PartType.UNDO: {
                this._undo();
                break;
            }
        }
    }

    /**
     * @deprecated Use `addPartListener` instead.
     */
    onPartCreated(callback: (p: Uint8Array) => any) {
        this.partListeners.push(callback);
    }

    getDrawingMode(): DendeMode {
        return this.mode;
    }

    getHTMLElement(): HTMLCanvasElement {
        return this.canvas;
    }

    getWidth(): number {
        return this.width;
    }

    getHeight(): number {
        return this.height;
    }

    /**
     * Switch between "drawing" (brush) and "filling" (bucket) modes.
     */
    setDrawingMode(mode: DendeMode) {
        this.mode = mode;
    }

    setLineWidth(lineWidth: number) {
        this.myLineWidth = lineWidth;
        this.ctx.lineWidth = lineWidth;
    }

    setLineColorRGBA(r: number, g: number, b: number, a: number = 1) {
        this.myColorRGBA = [r, g, b, a];
        this.ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
    }

    /**
     * Sets the throttle rate for mousemove events. 
     * Lower FPS = less network traffic but choppier lines. 
     * Default is ~30fps.
     */
    setFPS(fps: number) {
        this.delay = Math.round(1000 / fps);
    }

    static Part = DendePart;
}