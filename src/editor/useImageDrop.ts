import { useEffect } from "react";
import { useEditorStoreApi } from "@do-md/core-react";
import { storeImage } from "./imageStorage";

async function insertImagesSequential(
    store: ReturnType<typeof useEditorStoreApi>,
    files: File[],
) {
    for (const file of files) {
        try {
            const { url, altText } = await storeImage(file);
            store?.insertImage(url, altText);
        } catch (err) {
            console.error("[image-drop] failed to store", file.name, err);
        }
    }
}

export function useImageDrop(): void {
    const store = useEditorStoreApi();

    // Drag-drop images
    useEffect(() => {
        if (typeof window === "undefined") return;

        const onDrop = (e: DragEvent) => {
            const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
                f.type.startsWith("image/"),
            );
            if (files.length === 0) return;
            e.preventDefault();
            void insertImagesSequential(store, files);
        };

        const onDragOver = (e: DragEvent) => {
            if (
                Array.from(e.dataTransfer?.items ?? []).some(
                    (i) => i.kind === "file" && i.type.startsWith("image/"),
                )
            ) {
                e.preventDefault();
            }
        };

        window.addEventListener("drop", onDrop, true);
        window.addEventListener("dragover", onDragOver, true);
        return () => {
            window.removeEventListener("drop", onDrop, true);
            window.removeEventListener("dragover", onDragOver, true);
        };
    }, [store]);

    // Paste images (screenshots, clipboard)
    useEffect(() => {
        if (typeof window === "undefined") return;

        const onPaste = (e: ClipboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (
                target &&
                (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
            ) {
                return;
            }
            const files = Array.from(e.clipboardData?.items ?? [])
                .filter(
                    (i) => i.kind === "file" && i.type.startsWith("image/"),
                )
                .map((i) => i.getAsFile())
                .filter((f): f is File => !!f);
            if (files.length === 0) return;
            e.preventDefault();
            e.stopPropagation();
            void insertImagesSequential(store, files);
        };

        window.addEventListener("paste", onPaste, true);
        return () => window.removeEventListener("paste", onPaste, true);
    }, [store]);
}

export function ImageDropHandler(): null {
    useImageDrop();
    return null;
}
