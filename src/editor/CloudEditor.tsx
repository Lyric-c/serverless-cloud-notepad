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
    useFormatState,
    useRenderData,
} from "@do-md/core-react";
import {
    attachKeyboardCommands,
    clearFormatting,
    EMPTY_BLOCK_FORMAT_STATE,
    insertDivider,
    insertTable,
    readBlockFormatState,
    setParagraphStyle,
    toggleList,
    toggleQuote,
    type BlockFormatState,
    type HeadingLevel,
    type ListKind,
} from "@do-md/commands";
import { tableRenderComponent } from "./TableElement";
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

// ── Formatting toolbar（Aa 格式下拉菜单 + 图标插入按钮）──────────────────────

// 菜单/按钮通用：阻止 pointerdown/mousedown 默认，避免点击时编辑器先失焦、
// startCursorInfo 丢失导致命令 no-op。
const keepSelection = {
    onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
} as const;

function CheckIcon() {
    return (
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
            <path d="M3 8.5 6.2 11.5 13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function ChevronIcon() {
    return (
        <svg viewBox="0 0 16 16" className="size-2.5" fill="none" aria-hidden="true">
            <path d="M4 6.5 8 10.5 12 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// 1024 网格填充风格图标
function TableIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 1024 1024" fill="currentColor" className={className} aria-hidden="true">
            <path d="M141.074286 906.496h741.851428c89.581714 0 134.582857-44.562286 134.582857-132.845714V250.331429c0-88.283429-45.001143-132.845714-134.582857-132.845715H141.074286C51.931429 117.504 6.491429 161.645714 6.491429 250.331429V773.668571c0 88.704 45.44 132.845714 134.582857 132.845715zM75.501714 253.805714c0-44.580571 23.990857-67.291429 66.852572-67.291428h339.437714v176.566857H75.483429z m466.706286 109.275429V186.514286h339.437714c42.422857 0 66.852571 22.710857 66.852572 67.291428v109.275429z m0 237.44v-177.005714h406.290286v177.005714z m-60.416-177.005714v177.005714H75.483429v-177.005714zM881.645714 837.485714H542.208v-176.548571h406.290286v109.275428c0 44.580571-24.429714 67.291429-66.852572 67.291429z m-739.291428 0c-42.861714 0-66.852571-22.692571-66.852572-67.273143v-109.293714h406.290286v176.585143z" />
        </svg>
    );
}

const MARK_NAMES = { bold: "粗体", italic: "斜体", underline: "下划线", strike: "删除线", highlight: "高亮" } as const;
type MarkKey = keyof typeof MARK_NAMES;

const PARAGRAPH_STYLES: Array<{ level: HeadingLevel; label: string; className: string }> = [
    { level: 1, label: "标题", className: "text-xl font-semibold" },
    { level: 2, label: "小标题", className: "text-lg font-semibold" },
    { level: 3, label: "子标题", className: "text-base font-semibold" },
    { level: 0, label: "正文", className: "text-sm" },
];

const LIST_STYLES: Array<{ kind: ListKind; label: string; glyph: string }> = [
    { kind: "bullet", label: "无序列表", glyph: "•" },
    { kind: "ordered", label: "有序列表", glyph: "1." },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
    return <div className="px-2 pt-1.5 pb-1 text-xs text-base-content/40 select-none">{children}</div>;
}

function Separator() {
    return <div aria-hidden className="my-1 h-px bg-base-content/10" />;
}

function MenuRow({
    label,
    labelClassName = "text-sm",
    glyph,
    active = false,
    disabled = false,
    onSelect,
}: {
    label: string;
    labelClassName?: string;
    glyph?: string;
    active?: boolean;
    disabled?: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            role="menuitemradio"
            aria-checked={active}
            disabled={disabled}
            className={
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors " +
                (disabled
                    ? "opacity-35 cursor-not-allowed"
                    : "hover:bg-base-content/10 active:bg-base-content/15 cursor-pointer")
            }
            {...keepSelection}
            onClick={onSelect}
        >
            <span className="w-3.5 shrink-0 text-primary">{active ? <CheckIcon /> : null}</span>
            {glyph ? <span className="w-4 shrink-0 text-center text-sm text-base-content/70">{glyph}</span> : null}
            <span className={"flex-1 truncate leading-tight " + labelClassName}>{label}</span>
        </button>
    );
}

function FormatDropdown() {
    const storeApi = useEditorStoreApi();
    const formatState = useFormatState();
    const rootRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [blockState, setBlockState] = useState<BlockFormatState>(EMPTY_BLOCK_FORMAT_STATE);

    // 块样式快照需要一次完整 toMarkdown()，开销较大，只在菜单打开瞬间读取。
    const refreshBlockState = useCallback(
        () => setBlockState(readBlockFormatState(storeApi ?? null)),
        [storeApi],
    );
    const close = useCallback(() => setOpen(false), []);
    const toggle = useCallback(() => {
        setOpen((prev) => {
            if (!prev) refreshBlockState();
            return !prev;
        });
    }, [refreshBlockState]);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) close();
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open, close]);

    const runAction = useCallback(
        (action: () => void) => {
            action();
            close();
        },
        [close],
    );

    const blockDisabled = !blockState.available || blockState.guard !== null;

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                title="格式"
                className={"btn btn-xs btn-square gap-0.5 " + (open ? "btn-primary" : "btn-ghost text-base-content/60")}
                {...keepSelection}
                onClick={toggle}
            >
                Aa
                <ChevronIcon />
            </button>

            {open && (
                <div
                    role="menu"
                    className="absolute left-1/2 -translate-x-1/2 top-full mt-1 w-60 rounded-box border border-base-content/15 bg-base-100 p-1.5 text-sm text-base-content shadow-lg z-50"
                >
                    <SectionLabel>字符样式</SectionLabel>
                    <div className="flex items-start justify-around px-1 pb-1">
                        {(Object.keys(MARK_NAMES) as MarkKey[]).map((mark) => {
                            const { active, can } = formatState[mark];
                            const glyphs: Record<MarkKey, React.ReactNode> = {
                                bold: <span className="font-bold">B</span>,
                                italic: <span className="italic">I</span>,
                                underline: <span className="underline">U</span>,
                                strike: <span className="line-through">S</span>,
                                highlight: <span>H</span>,
                            };
                            return (
                                <div key={mark} className="flex flex-col items-center gap-0.5">
                                    <button
                                        type="button"
                                        role="menuitemcheckbox"
                                        aria-checked={active}
                                        disabled={!can}
                                        title={MARK_NAMES[mark]}
                                        className={
                                            "btn btn-sm btn-square " +
                                            (mark === "highlight" && active
                                                ? "bg-warning/30 border-warning/40 text-base-content"
                                                : active
                                                  ? "btn-active btn-primary"
                                                  : "btn-ghost")
                                        }
                                        {...keepSelection}
                                        onClick={() => runAction(() => storeApi?.format(mark))}
                                    >
                                        {glyphs[mark]}
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    <Separator />
                    <SectionLabel>段落样式</SectionLabel>
                    {PARAGRAPH_STYLES.map(({ level, label, className }) => (
                        <MenuRow
                            key={level}
                            label={label}
                            labelClassName={className}
                            active={blockState.heading === level}
                            disabled={blockDisabled}
                            onSelect={() => runAction(() => setParagraphStyle(storeApi ?? null, level))}
                        />
                    ))}

                    <Separator />
                    <SectionLabel>列表</SectionLabel>
                    {LIST_STYLES.map(({ kind, label, glyph }) => (
                        <MenuRow
                            key={kind}
                            label={label}
                            glyph={glyph}
                            active={blockState[kind]}
                            disabled={blockDisabled}
                            onSelect={() => runAction(() => toggleList(storeApi ?? null, kind))}
                        />
                    ))}

                    <Separator />
                    <MenuRow
                        label="引用块"
                        active={blockState.quote}
                        disabled={blockDisabled}
                        onSelect={() => runAction(() => toggleQuote(storeApi ?? null))}
                    />
                    <MenuRow
                        label="分隔线"
                        disabled={blockDisabled}
                        onSelect={() => runAction(() => insertDivider(storeApi ?? null))}
                    />

                    <Separator />
                    <MenuRow
                        label="清除格式"
                        disabled={blockDisabled}
                        onSelect={() => runAction(() => clearFormatting(storeApi ?? null))}
                    />
                </div>
            )}
        </div>
    );
}

// 描边式清单图标（lucide list-checks 风格），观感更接近 editor 页面的线性图标。
function ChecklistIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
            <path d="m3 17 2 2 4-4" />
            <path d="m3 7 2 2 4-4" />
            <path d="M13 6h8" />
            <path d="M13 12h8" />
            <path d="M13 18h8" />
        </svg>
    );
}

function FormatTools() {
    const storeApi = useEditorStoreApi();

    return (
        <div className="flex items-center gap-0.5 text-sm">
                    <FormatDropdown />

                    <button
                        type="button"
                        className="btn btn-xs btn-square btn-ghost text-base-content/60"
                        aria-label="Insert table"
                        title="插入表格"
                        {...keepSelection}
                        onClick={() => insertTable(storeApi ?? null)}
                    >
                        <TableIcon className="size-3.5" />
                    </button>
                    <button
                        type="button"
                        className="btn btn-xs btn-square btn-ghost text-base-content/60"
                        aria-label="Toggle checklist"
                        title="待办清单"
                        {...keepSelection}
                        onClick={() => toggleList(storeApi ?? null, "todo")}
                    >
                        <ChecklistIcon className="size-4" />
                    </button>
        </div>
    );
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

    // ⌘B / ⌘I / ⌘U etc. — route through format() instead of native execCommand,
    // so shortcuts and toolbar buttons are literally the same call.
    useEffect(() => {
        if (!isEditable || !storeApi) return;
        const mac = /Mac|iPhone|iPad/.test(navigator.platform);
        return attachKeyboardCommands(storeApi, { mac });
    }, [storeApi, isEditable]);

    // Share link state
    // metadata.share 在服务端是布尔开关；只有旧数据可能带 md5 字符串。
    // 这里做类型收窄，避免对非字符串调用 .slice 导致崩溃。
    const [shareMd5, setShareMd5] = useState<string | null>(
        typeof metadata?.share === "string" ? metadata.share : null,
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
            {/* Top toolbar：左侧格式工具，中间路径（可收缩），右侧操作按钮 */}
            <div className="shrink-0 min-h-9 flex items-center flex-wrap gap-x-2 gap-y-1 px-3 py-1 text-xs text-base-content/50 bg-base-200 border-b border-base-300 select-none">
                {isEditable && <FormatTools />}

                <span className="truncate font-mono text-xs flex-1 basis-24 min-w-0 order-last w-full sm:order-none sm:w-auto">
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
    // store.setEditable 热切换，绝不重新挂载 DOMDProvider。
    return (
        <DOMDProvider
            renderComponent={tableRenderComponent}
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
