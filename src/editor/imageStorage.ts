import Dexie, { type Table } from "dexie";

const MIME_TO_EXT: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/avif": "avif",
    "image/heic": "heic",
    "image/tiff": "tiff",
};

function extOf(file: File | Blob, nameHint?: string): string {
    const name = (file instanceof File ? file.name : nameHint) || "";
    const dot = name.lastIndexOf(".");
    if (dot > 0 && dot < name.length - 1) {
        return name.slice(dot + 1).toLowerCase();
    }
    return MIME_TO_EXT[file.type] || "bin";
}

async function sha256Hex(blob: Blob): Promise<string> {
    const buf = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    return hex.slice(0, 32);
}

// ── Web (IndexedDB via Dexie) ────────────────────────────────────────────────

interface ImageRecord {
    id: string;
    blob: Blob;
    mimeType: string;
    createdAt: number;
}

class DomdDb extends Dexie {
    images!: Table<ImageRecord, string>;
    constructor() {
        super("domd");
        this.version(1).stores({ images: "id, createdAt" });
    }
}

let _db: DomdDb | null = null;
function db(): DomdDb {
    if (!_db) _db = new DomdDb();
    return _db;
}

async function storeWeb(file: Blob, id: string): Promise<void> {
    const existing = await db().images.get(id);
    if (existing) return;
    await db().images.put({
        id,
        blob: file,
        mimeType: file.type,
        createdAt: Date.now(),
    });
}

export async function readWebImage(id: string): Promise<Blob | null> {
    const row = await db().images.get(id);
    return row?.blob ?? null;
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface StoredImage {
    url: string;
    altText: string;
}

export async function storeImage(file: File): Promise<StoredImage> {
    const ext = extOf(file);
    const hash = await sha256Hex(file);
    const name = `${hash}.${ext}`;
    const altText = file.name || `image.${ext}`;

    await storeWeb(file, hash);
    return { url: `domd-idb://${hash}`, altText };
}

// ── Loader (DOMDProvider imageLoader prop) ───────────────────────────────────

export async function loadImage(src: string): Promise<string> {
    if (src.startsWith("domd-idb://")) {
        const id = src.slice("domd-idb://".length);
        const blob = await readWebImage(id);
        if (!blob) throw new Error(`image not found: ${src}`);
        return URL.createObjectURL(blob);
    }
    return src;
}
