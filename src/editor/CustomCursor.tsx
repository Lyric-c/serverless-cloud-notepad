import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    useEditorStore,
    useEditorStoreApi,
    useEditorDom,
} from "@do-md/core-react";

// 对齐 domd 官方 demo（plugins/rendering/CustomCursor/index.tsx）。
// 关键点：光标 div 必须带 contentEditable={false}，否则会被浏览器当作
// contentEditable 容器里的可编辑内容，干扰 domd 的 DOM reconciliation，
// 触发 "removeChild: node is not a child" 之类的错误。

let styleInjected = false;
function injectBlinkStyle() {
    if (styleInjected) return;
    styleInjected = true;
    const style = document.createElement("style");
    style.textContent = `@keyframes domd-cursor-blink{0%,100%{opacity:1}50%{opacity:0}}`;
    document.head.appendChild(style);
}

/** Starting from node (excluding itself), find the next leaf node within the same root */
function getNextLeaf(node: Node, root: Node): Node | null {
    let cur: Node | null = node;
    while (cur && cur !== root) {
        if (cur.nextSibling) {
            let leaf: Node = cur.nextSibling;
            while (leaf.firstChild) leaf = leaf.firstChild;
            return leaf;
        }
        cur = cur.parentNode;
    }
    return null;
}

/** Measure the left edge of the character at `index` in a text node */
function measureCharLeft(node: Node, index: number): DOMRect | null {
    const r = document.createRange();
    r.setStart(node, index);
    r.setEnd(node, index + 1);
    const rects = r.getClientRects();
    if (!rects.length) return null;
    const rect = rects[rects.length - 1];
    return new DOMRect(rect.left, rect.top, 0, rect.height);
}

/** Caret-style rect derived from a leaf element's own box (empty paragraph <br>, embeds) */
function measureLeafElementRect(el: HTMLElement): DOMRect | null {
    const rect = el.getBoundingClientRect();
    if (rect.height > 0) {
        return new DOMRect(rect.left, rect.top, 0, rect.height);
    }
    const r = document.createRange();
    r.selectNode(el);
    const rects = r.getClientRects();
    if (rects.length) {
        const last = rects[rects.length - 1];
        if (last.height > 0) {
            return new DOMRect(last.left, last.top, 0, last.height);
        }
    }
    return null;
}

/** The rect of the content just after a collapsed cursor */
function getDownstreamRect(
    range: Range,
    container: HTMLElement,
): DOMRect | null {
    let node: Node = range.startContainer;
    let offset = range.startOffset;

    // Element-container boundary (empty paragraph <p><br></p> → (p, 0)).
    if (node.nodeType === Node.ELEMENT_NODE && node.nodeName !== "BR") {
        let leaf: Node | null = node.childNodes[offset] ?? node.lastChild;
        while (leaf && leaf.firstChild) leaf = leaf.firstChild;
        if (!leaf) return null;
        if (offset >= node.childNodes.length && leaf.nodeName !== "BR") {
            return null;
        }
        node = leaf;
        offset = 0;
    }

    if (node instanceof HTMLElement) {
        return measureLeafElementRect(node);
    }

    if (node.nodeType !== Node.TEXT_NODE) return null;
    const text = node.textContent || "";

    if (offset < text.length) {
        return measureCharLeft(node, offset);
    }

    const leaf = getNextLeaf(node, container);
    if (leaf && leaf.nodeType === Node.TEXT_NODE) {
        return (leaf.textContent || "").length > 0
            ? measureCharLeft(leaf, 0)
            : null;
    }
    if (leaf instanceof HTMLElement) {
        return measureLeafElementRect(leaf);
    }
    return null;
}

function getCursorRect(container: HTMLElement) {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return null;

    const range = sel.getRangeAt(0);
    let rect = range.getBoundingClientRect();

    if (range.collapsed) {
        const node = range.startContainer;
        const offset = range.startOffset;
        const text =
            node.nodeType === Node.TEXT_NODE ? node.textContent || "" : "";

        // 光标紧跟硬换行 \n 时（下一行行首），原生 rect 落在上一行。
        // 用下游内容的位置覆盖。
        if (text[offset - 1] === "\n") {
            const downstream = getDownstreamRect(range, container);
            if (
                downstream &&
                (rect.height === 0 ||
                    downstream.top > rect.top + rect.height / 2)
            ) {
                rect = downstream;
            }
        }

        // 空段落 <br> 等 rect 为空的情况。
        if (rect.height === 0) {
            const downstream = getDownstreamRect(range, container);
            if (downstream) {
                rect = downstream;
            } else if (
                node.nodeType === Node.TEXT_NODE &&
                offset > 0 &&
                text[offset - 1] !== "\n"
            ) {
                const fallbackRange = range.cloneRange();
                fallbackRange.setStart(node, offset - 1);
                fallbackRange.setEnd(node, offset);
                const rects = fallbackRange.getClientRects();
                if (rects.length > 0) {
                    const lastRect = rects[rects.length - 1];
                    rect = new DOMRect(
                        lastRect.right,
                        lastRect.top,
                        0,
                        lastRect.height,
                    );
                }
            }
        }
    }

    if (rect.height === 0) return null;

    const containerRect = container.getBoundingClientRect();

    return {
        x: rect.left - containerRect.left + container.scrollLeft,
        y: rect.top - containerRect.top + container.scrollTop,
        height: rect.height,
    };
}

export function CustomCursor() {
    const { textAreaDomRef } = useEditorDom();
    const storeApi = useEditorStoreApi();
    const startCursorInfo = useEditorStore((store) => store.startCursorInfo);
    const duringComposition = useEditorStore(
        (store) => store.duringComposition,
    );

    const cursorRef = useRef<HTMLDivElement>(null);
    const rafRef = useRef<number>(0);
    const lastPosRef = useRef({ x: -1, y: -1 });
    const originalCaretColorRef = useRef<string | null>(null);
    const [mounted, setMounted] = useState(false);
    const [hasRangeSelection, setHasRangeSelection] = useState(false);
    const duringCompositionRef = useRef(duringComposition);
    duringCompositionRef.current = duringComposition;

    useEffect(() => {
        injectBlinkStyle();
    }, []);

    // 隐藏原生 caret：只在当前实例的 textAreaDom 上写 inline caret-color。
    // IME 组合期间和存在 range 选区时恢复原生 caret（iOS 选区 UI 依赖它）。
    useEffect(() => {
        const container = textAreaDomRef.current;
        if (!container) return;

        if (originalCaretColorRef.current === null) {
            originalCaretColorRef.current = container.style.caretColor;
        }

        container.style.caretColor =
            duringComposition || hasRangeSelection
                ? originalCaretColorRef.current
                : "transparent";

        return () => {
            container.style.caretColor = originalCaretColorRef.current ?? "";
        };
    }, [duringComposition, hasRangeSelection, textAreaDomRef, mounted]);

    useEffect(() => {
        if (textAreaDomRef.current) {
            setMounted(true);
        }
    }, []);

    const show = useCallback(() => {
        const el = cursorRef.current;
        if (!el) return;
        el.style.opacity = "1";
        el.style.animation = "domd-cursor-blink 1s step-end infinite";
    }, []);

    const hide = useCallback(() => {
        const el = cursorRef.current;
        if (!el) return;
        el.style.opacity = "0";
        el.style.animation = "none";
    }, []);

    const resetBlink = useCallback(() => {
        const el = cursorRef.current;
        if (!el) return;
        el.style.animation = "none";
        void el.offsetHeight;
        el.style.animation = "domd-cursor-blink 1s step-end infinite";
    }, []);

    const updatePosition = useCallback(() => {
        const container = textAreaDomRef.current;
        const cursor = cursorRef.current;
        if (!container || !cursor) return;

        const sel = document.getSelection();

        setHasRangeSelection(
            !!sel &&
                sel.rangeCount > 0 &&
                !sel.isCollapsed &&
                container.contains(sel.anchorNode),
        );

        if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) {
            hide();
            return;
        }

        if (!container.contains(sel.anchorNode)) {
            hide();
            return;
        }

        const pos = getCursorRect(container);
        if (!pos) {
            hide();
            return;
        }

        const moved =
            pos.x !== lastPosRef.current.x || pos.y !== lastPosRef.current.y;
        lastPosRef.current = { x: pos.x, y: pos.y };

        cursor.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
        cursor.style.height = `${pos.height}px`;

        if (moved) {
            resetBlink();
        } else {
            show();
        }
    }, [textAreaDomRef, show, hide, resetBlink]);

    const scheduleUpdate = useCallback(() => {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(updatePosition);
    }, [updatePosition]);

    useEffect(() => {
        if (startCursorInfo) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(() => {
                rafRef.current = requestAnimationFrame(updatePosition);
            });
        } else {
            hide();
        }
    }, [startCursorInfo, updatePosition, hide]);

    // selectionchange：同步处理 caret-color（iOS 选区 UI），再 rAF 更新位置。
    useEffect(() => {
        const handler = () => {
            const container = textAreaDomRef.current;
            if (container && !duringCompositionRef.current) {
                if (originalCaretColorRef.current === null) {
                    originalCaretColorRef.current =
                        container.style.caretColor;
                }
                const sel = document.getSelection();
                const hasRange =
                    !!sel &&
                    sel.rangeCount > 0 &&
                    !sel.isCollapsed &&
                    container.contains(sel.anchorNode);
                container.style.caretColor = hasRange
                    ? originalCaretColorRef.current
                    : "transparent";
            }
            scheduleUpdate();
        };
        document.addEventListener("selectionchange", handler);
        return () => document.removeEventListener("selectionchange", handler);
    }, [scheduleUpdate, textAreaDomRef]);

    // IME：组合期间隐藏自定义光标，让原生 caret 显示。
    useEffect(() => {
        const container = textAreaDomRef.current;
        if (!container) return;

        if (duringComposition) {
            hide();
        } else {
            scheduleUpdate();
        }
    }, [duringComposition, textAreaDomRef, scheduleUpdate, hide]);

    // blur / focus
    useEffect(() => {
        const container = textAreaDomRef.current;
        if (!container) return;

        const onBlur = () => hide();
        const onFocus = () => scheduleUpdate();

        container.addEventListener("blur", onBlur);
        container.addEventListener("focus", onFocus);
        return () => {
            container.removeEventListener("blur", onBlur);
            container.removeEventListener("focus", onFocus);
        };
    }, [textAreaDomRef, scheduleUpdate, hide]);

    // 文档变化（collab / 外部 reset 等）会重排内容但不动 DOM selection，
    // 不会触发 selectionchange，需在每次 store 更新时重新测量。
    useEffect(() => {
        if (!storeApi) return;
        return storeApi.subscribe(scheduleUpdate);
    }, [storeApi, scheduleUpdate]);

    // scroll / resize
    useEffect(() => {
        const container = textAreaDomRef.current;
        if (!container) return;

        const scrollParent = container.parentElement;
        if (!scrollParent) return;

        const onScroll = () => scheduleUpdate();
        scrollParent.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", scheduleUpdate);

        return () => {
            scrollParent.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", scheduleUpdate);
        };
    }, [textAreaDomRef, scheduleUpdate]);

    useEffect(() => {
        return () => cancelAnimationFrame(rafRef.current);
    }, []);

    if (!mounted || !textAreaDomRef.current) return null;

    return createPortal(
        <div
            ref={cursorRef}
            contentEditable={false}
            style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: 2,
                opacity: 0,
                pointerEvents: "none",
                willChange: "transform",
                contain: "strict",
                backgroundColor: "rgb(0, 189, 184)",
                borderRadius: 1,
                zIndex: 10,
            }}
        />,
        textAreaDomRef.current,
    );
}
