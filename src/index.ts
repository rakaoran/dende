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

export default class Dende {
    private canvas: HTMLCanvasElement;
    private width: number;
    private height: number;
    private ctx: CanvasRenderingContext2D;

    private isDrawing: boolean = false;
    private mode: DendeMode = "drawing";
    private delay: number = 33;

    // CHANGED: Listener now expects the Interface
    private partListeners: Array<(p: IDendePart) => any> = [];

    private pointsBuffer: Array<number> = [];
    private lastSent: number = Date.now();
    private otherStartedDrawing: boolean = false;

    private myColorRGBA: RGBA = [0, 0, 0, 1];
    private myLineWidth: number = 2;

    private undoStack: Array<ImageData> = []
    private redoStack: Array<ImageData> = []
    private readonly MAX_HISTORY = 20;

    private canDraw: boolean = true;

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

    public enableDrawing() {
        this.canDraw = true;
        this.canvas.style.cursor = "crosshair";
    }

    // CHANGED: Accepts Interface
    public addPartListener(cb: (p: IDendePart) => any) {
        this.partListeners.push(cb);
    }

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

        // We create a class instance here, but it matches the Interface perfectly
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

    public clear() {
        this._clear();
        this.saveSnapshot();
        this.emitPart(DendePart.clearBoard());
    }

    private _clear() {
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.redoStack = [];
    }

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

    // CHANGED: Accepts Interface
    emitPart(p: IDendePart) {
        this.partListeners.forEach(cb => cb(p));
    }

    // --- NETWORK HANDLER ---
    // CHANGED: Accepts Interface (Crucial for WebSocket data)
    public putPart(part: IDendePart) {
        if (this.canDraw) return;

        switch (part.type) {
            case DendePartType.Clear: {
                this.redoStack = []
                this.ctx.clearRect(0, 0, this.width, this.height);
                this.saveSnapshot();
                break;
            }

            case DendePartType.Filling: {
                this.redoStack = []
                this._fillAtPoint(part.coordinates[0]!, part.coordinates[1]!, part.color);
                this.saveSnapshot();
                break;
            }

            case DendePartType.Drawing: {
                this.redoStack = []
                const [r, g, b, a] = part.color;

                this.ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
                this.ctx.lineWidth = part.lineWidth;
                this.ctx.lineCap = "round";
                this.ctx.lineJoin = "round";

                if (!this.otherStartedDrawing) {
                    this.otherStartedDrawing = true;
                    this.ctx.beginPath();
                    // Start at the first point
                    this.ctx.moveTo(part.coordinates[0]!, part.coordinates[1]!);
                    this.ctx.lineTo(part.coordinates[0]!, part.coordinates[1]!);
                    this.ctx.stroke();

                    // Loop starts at 2 because 0 is handled by moveTo
                    for (let i = 2; i < part.coordinates.length; i += 2) {
                        this.ctx.lineTo(part.coordinates[i]!, part.coordinates[i + 1]!);
                    }
                } else {
                    // If continuing a line, simply connect to ALL new points
                    // Loop starts at 0
                    for (let i = 0; i < part.coordinates.length; i += 2) {
                        this.ctx.lineTo(part.coordinates[i]!, part.coordinates[i + 1]!);
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

            case DendePartType.Redo: {
                this._redo();
                break;
            }

            case DendePartType.Undo: {
                this._undo();
                break;
            }
        }
    }

    // CHANGED: Callback expects Interface
    onPartCreated(callback: (p: IDendePart) => any) {
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

    setFPS(fps: number) {
        this.delay = Math.round(1000 / fps);
    }

    static Part = DendePart;
}