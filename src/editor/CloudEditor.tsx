import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import {
    DOMD,
    DOMDProvider,
    toMarkdown,
    useEditorStore,
    useEditorStoreApi,
    useRenderData,
} from "@do-md/core-react";
import { tokenize } from "./prism";
import { loadImage } from "./imageStorage";
import { useLatest } from "./useLatest";
import { ImageDropHandler } from "./useImageDrop";
import { CustomCursor } from "./CustomCursor";

// ── Types ────────────────────────────────────────────────────────────────────

export interface NoteMetadata {
    mode?: "md" | "plain";
    share?: string;
    pw?: boolean;
    updateAt?: number;
}

export interface CloudEditorOptions {
    initialContent: string;
    path: string;
    metadata?: NoteMetadata;
    initialEditable?: boolean;
    canToggle?: boolean;
    onSave: (markdown: string) => Promise<void>;
    onPasswordSet?: (passwd: string) => Promise<void>;
    onShareToggle?: (enabled: boolean) => Promise<string | null>;
}

// ── Auto-save hook ───────────────────────────────────────────────────────────

// 始终调用（遵守 Hooks 规则），内部根据 enabled 决定是否真正保存。
function useAutoSave(
    renderData: ReturnType<typeof useRenderData>,
    doSave: (data: ReturnType<typeof useRenderData>) => Promise<void>,
    enabled: boolean,
) {
    const seenInitialRef = useRef(false);
    useEffect(() => {
        if (!seenInitialRef.current) {
            seenInitialRef.current = true;
            return;
        }
        if (!enabled) return;
        const id = setTimeout(() => doSave(renderData), 30000);
        return () => clearTimeout(id);
    }, [renderData, doSave, enabled]);
}

// ── CloudEditor Component ────────────────────────────────────────────────────

function CloudEditorInner({
    path,
    metadata,
    canToggle,
    onSave,
    onPasswordSet,
    onShareToggle,
}: {
    path: string;
    metadata?: NoteMetadata;
    canToggle: boolean;
    onSave: (markdown: string) => Promise<void>;
    onPasswordSet?: (passwd: string) => Promise<void>;
    onShareToggle?: (enabled: boolean) => Promise<string | null>;
}) {
    const renderData = useRenderData();
    const storeApi = useEditorStoreApi();
    const isEditable = useEditorStore((store) => store.isEditable);

    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const domdRef = useRef<HTMLDivElement>(null);

    // Auto-focus
    const didFocusRef = useRef(false);
    useEffect(() => {
        if (!storeApi || didFocusRef.current) return;
        didFocusRef.current = true;
        storeApi.focus();
    }, [storeApi]);

    // Save logic
    const metaRef = useLatest(metadata);
    const doSave = useCallback(
        async (data: ReturnType<typeof useRenderData>) => {
            const md = toMarkdown(data) ?? "";
            setSaving(true);
            try {
                await onSave(md);
                setSaved(true);
                setTimeout(() => setSaved(false), 2000);
            } catch (err) {
                console.error("[cloud-editor] save failed", err);
            } finally {
                setSaving(false);
            }
        },
        [onSave],
    );

    const doSaveRef = useRef(doSave);
    doSaveRef.current = doSave;
    const renderDataRef = useRef(renderData);
    renderDataRef.current = renderData;

    // Auto-save — only for editable mode
    useAutoSave(renderData, doSave, isEditable);

    // Cmd/Ctrl+S — only for editable mode
    useEffect(() => {
        if (!isEditable) return;
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                e.preventDefault();
                doSaveRef.current(renderDataRef.current);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [isEditable]);

    // Toggle edit/read-only via store.setEditable — hot switch, no remount
    // (the DOMDProvider is never re-keyed; its content stays intact).
    const handleToggleEdit = useCallback(() => {
        storeApi?.setEditable(!isEditable);
    }, [storeApi, isEditable]);

    // Share link state
    const [shareMd5, setShareMd5] = useState<string | null>(
        metadata?.share ?? null,
    );
    const [showShareCopied, setShowShareCopied] = useState(false);
    const [showPwModal, setShowPwModal] = useState(false);
    const [pwInput, setPwInput] = useState("");

    // Password handling
    const handlePasswordSubmit = useCallback(async () => {
        if (!onPasswordSet) return;
        setShowPwModal(false);
        try {
            await onPasswordSet(pwInput);
        } catch (err) {
            console.error("[cloud-editor] password set failed", err);
        }
    }, [onPasswordSet, pwInput]);

    // Share toggle
    const handleShareToggle = useCallback(async () => {
        if (!onShareToggle) return;
        const currentlyShared = !!shareMd5;
        try {
            const result = await onShareToggle(!currentlyShared);
            if (!currentlyShared && result) {
                setShareMd5(result);
                // Copy to clipboard
                const shareUrl = `${window.location.origin}/share/${result}`;
                await navigator.clipboard.writeText(shareUrl);
                setShowShareCopied(true);
                setTimeout(() => setShowShareCopied(false), 2000);
            } else if (currentlyShared) {
                setShareMd5(null);
            }
        } catch (err) {
            console.error("[cloud-editor] share toggle failed", err);
        }
    }, [onShareToggle, shareMd5]);

    const hasPassword = metadata?.pw ?? false;

    return (
        <div className="fixed inset-0 flex flex-col bg-base-100 overflow-hidden">
            {/* Top toolbar */}
            <div className="shrink-0 h-9 flex items-center gap-2 px-3 text-xs text-base-content/50 bg-base-200 border-b border-base-300 select-none">
                <span className="truncate flex-1 font-mono text-xs">
                    /{path}
                </span>

                {isEditable && onShareToggle && (
                    <button
                        onClick={handleShareToggle}
                        className={`btn btn-xs ${shareMd5 ? "btn-primary" : "btn-ghost"}`}
                        title={shareMd5 ? "Unshare" : "Share"}
                    >
                        {showShareCopied ? "Copied!" : shareMd5 ? `Shared: ${shareMd5.slice(0, 6)}...` : "Share"}
                    </button>
                )}

                {isEditable && onPasswordSet && (
                    <button
                        onClick={() => {
                            setPwInput("");
                            setShowPwModal(true);
                        }}
                        className={`btn btn-xs ${hasPassword ? "btn-warning" : "btn-ghost"}`}
                        title={hasPassword ? "Change password" : "Set password"}
                    >
                        {hasPassword ? "🔒" : "🔓"}
                    </button>
                )}

                {isEditable && saving && (
                    <span className="text-xs opacity-50">Saving...</span>
                )}
                {isEditable && saved && (
                    <span className="text-xs text-success">Saved</span>
                )}
                {metadata?.updateAt && (
                    <span className="text-xs opacity-40">
                        {new Date(metadata.updateAt * 1000).toLocaleDateString()}
                    </span>
                )}
                {canToggle && (
                    <button
                        onClick={handleToggleEdit}
                        className={`btn btn-xs ${isEditable ? "btn-ghost" : "btn-primary"}`}
                    >
                        {isEditable ? "Lock" : "Edit"}
                    </button>
                )}
                {!canToggle && !isEditable && (
                    <span className="text-xs opacity-40">Read-only</span>
                )}
            </div>

            {/* Editor area */}
            <div
                className="flex-1 overflow-y-auto"
                onClick={(e) => {
                    if (domdRef.current?.contains(e.target as Node)) return;
                    storeApi?.focus();
                }}
            >
                <div className="max-w-3xl mx-auto px-6 py-8">
                    <div ref={domdRef}>
                        <DOMD />
                        {isEditable && <CustomCursor />}
                    </div>
                </div>
            </div>

            {/* Password modal */}
            {showPwModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
                    onClick={() => setShowPwModal(false)}
                >
                    <div
                        className="bg-base-100 rounded-xl shadow-xl p-6 w-80"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-sm font-semibold mb-3">
                            {hasPassword ? "Change Password" : "Set Password"}
                        </h3>
                        <p className="text-xs text-base-content/50 mb-3">
                            Leave empty to remove password protection.
                        </p>
                        <input
                            type="password"
                            value={pwInput}
                            onChange={(e) => setPwInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handlePasswordSubmit();
                                if (e.key === "Escape") setShowPwModal(false);
                            }}
                            placeholder="Enter password..."
                            autoFocus
                            className="input input-sm w-full mb-4"
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setShowPwModal(false)}
                                className="btn btn-sm btn-ghost"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handlePasswordSubmit}
                                className="btn btn-sm btn-primary"
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── CloudEditor (with providers) ─────────────────────────────────────────────

export function CloudEditor({
    initialContent,
    path,
    metadata,
    initialEditable = true,
    canToggle = false,
    onSave,
    onPasswordSet,
    onShareToggle,
}: CloudEditorOptions) {
    // editable 只在构造时作为初始值；运行期的编辑/只读切换通过
    // store.setEditable 热切换，绝不重新挂载 DOMDProvider（对齐 domd demo）。
    return (
        <DOMDProvider
            editable={initialEditable}
            placeholder="Start writing Markdown..."
            initMd={initialContent}
            imageLoader={loadImage}
            codeTokenizer={tokenize}
        >
            <ImageDropHandler />
            <CloudEditorInner
                path={path}
                metadata={metadata}
                canToggle={canToggle}
                onSave={onSave}
                onPasswordSet={onPasswordSet}
                onShareToggle={onShareToggle}
            />
        </DOMDProvider>
    );
}
