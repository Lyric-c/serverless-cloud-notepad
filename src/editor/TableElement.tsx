import {
    getRenderElementProps,
    getSpanRenderIdProps,
    MarkdownType,
    RenderChildren,
    serializeRenderData,
    useEditorStore,
    useEditorStoreApi,
    viewOnlyProps,
} from "@do-md/core-react";
import type {
    RenderElementProps,
    SerializedRenderData,
} from "@do-md/core-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

// ── 表格编辑挂件（Obsidian 风格，视图层装饰）────────────────────────────────
//   - 右缘 / 下缘悬停热区 → 追加列 / 行
//   - 跟随光标的 ⋯ / ⋮ 手柄 → 浮动菜单：在右侧插入列、在下方插入行、删除

type Props = RenderElementProps;

/** 悬停热区：4px 间隙 + 16px 条带 = 20px。"+" 常驻挂载但透明，
 *  悬停进入热区（含间隙）时仅显示该热区的按钮；悬停表格本身不显示。 */
const ADD_BUTTON_CLASS =
    "absolute flex cursor-pointer select-none items-center justify-center " +
    "rounded-sm border border-base-content/20 text-base-content/40 " +
    "opacity-0 transition-opacity duration-150 group-hover/zone:opacity-100 " +
    "hover:bg-base-content/5 hover:text-base-content/90";

const HANDLE_CLASS =
    "absolute flex cursor-pointer select-none items-center justify-center " +
    "rounded-full border border-base-content/20 bg-base-100 shadow-sm " +
    "text-base-content/50 hover:bg-base-200 hover:text-base-content/90";

const MENU_CLASS =
    "absolute z-10 flex w-max min-w-36 flex-col overflow-hidden rounded-lg " +
    "border border-base-content/15 bg-base-100 py-1 shadow-lg";

const MENU_ITEM_CLASS =
    "flex cursor-pointer items-center px-3 py-1.5 text-left text-sm " +
    "text-base-content/80 hover:bg-base-200 " +
    "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

function PlusIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
    );
}

function DotsIcon({ vertical = false }: { vertical?: boolean }) {
    return (
        <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="currentColor"
            aria-hidden="true"
            style={vertical ? { transform: "rotate(90deg)" } : undefined}
        >
            <circle cx="2.5" cy="6" r="1.1" />
            <circle cx="6" cy="6" r="1.1" />
            <circle cx="9.5" cy="6" r="1.1" />
        </svg>
    );
}

/** 光标当前所在单元格的位置。 */
interface CellLocation {
    /** 0 起的列号。 */
    colIdx: number;
    /** BODY 行中 0 起的行号；null = 表头行。 */
    bodyRowIdx: number | null;
    /** HTMLTableElement.rows 扁平集合中的行号。 */
    tableRowIdx: number;
}

const subtreeContains = (node: SerializedRenderData, uuid: string): boolean =>
    node.uuid === uuid || !!node.children?.some((child) => subtreeContains(child as SerializedRenderData, uuid));

/** 把光标 uuid（单元格内任意节点：span/段落/单元格自身）映射到所在 (row, column)。
 *  只在稳定的序列化形态上遍历——内部树结构不可直接访问。 */
function locateCursorCell(table: SerializedRenderData, cursorUuid: string): CellLocation | null {
    let tableRowIdx = 0;
    for (const section of table.children ?? []) {
        const isHead = section.type === "THead";
        const isBody = section.type === "TBody";
        if (!isHead && !isBody) continue;
        let bodyRowIdx = 0;
        for (const row of section.children ?? []) {
            if (row.type !== "TR") continue;
            let colIdx = 0;
            for (const cell of row.children ?? []) {
                if (cell.type !== "TH" && cell.type !== "TD") continue;
                if (subtreeContains(cell as SerializedRenderData, cursorUuid)) {
                    return { colIdx, bodyRowIdx: isBody ? bodyRowIdx : null, tableRowIdx };
                }
                colIdx++;
            }
            tableRowIdx++;
            if (isBody) bodyRowIdx++;
        }
    }
    return null;
}

interface CellHandlesProps {
    tableUuid: string;
    location: CellLocation;
    tableRef: React.RefObject<HTMLTableElement | null>;
    /** 结构版本信号：任何重解析都会产生新节点，作为依赖可在行列变更后重新测量。 */
    parsedData: RenderElementProps["parsedData"];
}

/** 跟随光标的编辑挂件：骑在光标所在列上缘的「⋯」手柄、所在行左缘的「⋮」手柄。
 *  点击弹出浮层菜单，提供该列/行的插入与删除操作。几何信息来自真实单元格盒子
 *  （HTMLTableElement.rows[r].cells[c]），相对 overlay 测量；结构变化、滚动、
 *  窗口缩放时重新测量。全部为 view-only 装饰。 */
function CellHandles({ tableUuid, location, tableRef, parsedData }: CellHandlesProps) {
    const storeApi = useEditorStoreApi();
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const [openMenu, setOpenMenu] = useState<"row" | "col" | null>(null);
    const [rects, setRects] = useState<{
        col: { left: number; width: number };
        row: { top: number; height: number };
    } | null>(null);

    const { colIdx, bodyRowIdx, tableRowIdx } = location;

    useLayoutEffect(() => {
        const measure = () => {
            const tableEl = tableRef.current;
            const overlayEl = overlayRef.current;
            const cellEl = tableEl?.rows[tableRowIdx]?.cells[colIdx];
            if (!tableEl || !overlayEl || !cellEl) {
                setRects(null);
                return;
            }
            const base = overlayEl.getBoundingClientRect();
            const cell = cellEl.getBoundingClientRect();
            setRects({
                col: { left: cell.left - base.left, width: cell.width },
                row: { top: cell.top - base.top, height: cell.height },
            });
        };
        measure();
        const scroller = tableRef.current?.parentElement;
        scroller?.addEventListener("scroll", measure);
        window.addEventListener("resize", measure);
        return () => {
            scroller?.removeEventListener("scroll", measure);
            window.removeEventListener("resize", measure);
        };
    }, [tableRef, tableRowIdx, colIdx, parsedData]);

    // 光标移动到其他单元格（打字、点击或结构操作重新落位）：过期的菜单关闭。
    useEffect(() => setOpenMenu(null), [tableRowIdx, colIdx]);

    // 点击外部任意 pointerdown 关闭菜单。
    useEffect(() => {
        if (!openMenu) return;
        const onPointerDown = (e: PointerEvent) => {
            if (!overlayRef.current?.contains(e.target as Node)) setOpenMenu(null);
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        return () => document.removeEventListener("pointerdown", onPointerDown, true);
    }, [openMenu]);

    // 阻止交互把焦点/光标移出单元格——手柄只在光标位于表格内时存在，
    // 焦点被抢走会立刻让正在被点击的 UI 消失。
    const swallowPointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const insertColumnAfter = useCallback(() => {
        setOpenMenu(null);
        storeApi?.addTableColumn(tableUuid, colIdx + 1);
    }, [storeApi, tableUuid, colIdx]);

    const insertRowBelow = useCallback(() => {
        setOpenMenu(null);
        storeApi?.addTableRow(tableUuid, bodyRowIdx === null ? 0 : bodyRowIdx + 1);
    }, [storeApi, tableUuid, bodyRowIdx]);

    const deleteColumn = useCallback(() => {
        setOpenMenu(null);
        storeApi?.deleteTableColumn(tableUuid, colIdx);
    }, [storeApi, tableUuid, colIdx]);

    const deleteRow = useCallback(() => {
        setOpenMenu(null);
        if (bodyRowIdx === null) return; // 表头行不可删除
        storeApi?.deleteTableRow(tableUuid, bodyRowIdx);
    }, [storeApi, tableUuid, bodyRowIdx]);

    if (!rects) {
        // 首帧测量前：先挂载 overlay 让 ref 存在，暂不渲染任何挂件。
        return (
            <div ref={overlayRef} {...viewOnlyProps} className="pointer-events-none absolute inset-0" />
        );
    }

    const colCenter = rects.col.left + rects.col.width / 2;
    const rowCenter = rects.row.top + rects.row.height / 2;

    return (
        <div ref={overlayRef} {...viewOnlyProps} className="pointer-events-none absolute inset-0">
            {/* 列手柄：骑在表格上缘，对准光标所在列的中心。 */}
            <button
                type="button"
                aria-label="列操作"
                className={`${HANDLE_CLASS} pointer-events-auto h-3.5 w-6 -translate-x-1/2`}
                style={{ left: colCenter, top: -8 }}
                onPointerDown={swallowPointerDown}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenu((m) => (m === "col" ? null : "col"));
                }}
            >
                <DotsIcon />
            </button>
            {/* 行手柄：骑在表格左缘，对准光标所在行的中心。 */}
            <button
                type="button"
                aria-label="行操作"
                className={`${HANDLE_CLASS} pointer-events-auto h-6 w-3.5 -translate-y-1/2`}
                style={{ left: -8, top: rowCenter }}
                onPointerDown={swallowPointerDown}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenu((m) => (m === "row" ? null : "row"));
                }}
            >
                <DotsIcon vertical />
            </button>
            {openMenu === "col" ? (
                <div
                    className={`${MENU_CLASS} pointer-events-auto -translate-x-1/2`}
                    style={{ left: colCenter, top: 10 }}
                    onPointerDown={swallowPointerDown}
                >
                    <button type="button" className={MENU_ITEM_CLASS} onClick={insertColumnAfter}>
                        向右插入列
                    </button>
                    <button type="button" className={MENU_ITEM_CLASS} onClick={deleteColumn}>
                        删除本列
                    </button>
                </div>
            ) : null}
            {openMenu === "row" ? (
                <div
                    className={`${MENU_CLASS} pointer-events-auto -translate-y-1/2`}
                    style={{ left: 10, top: rowCenter }}
                    onPointerDown={swallowPointerDown}
                >
                    <button type="button" className={MENU_ITEM_CLASS} onClick={insertRowBelow}>
                        在下方插入行
                    </button>
                    <button
                        type="button"
                        className={MENU_ITEM_CLASS}
                        disabled={bodyRowIdx === null}
                        onClick={deleteRow}
                    >
                        删除本行
                    </button>
                </div>
            ) : null}
        </div>
    );
}

/** 内核 Table 元素的宿主覆盖组件。只使用公共覆盖套件：
 *  结构经 serializeRenderData 读取稳定形态，内容经 RenderChildren 渲染。 */
function TableElementBase({ parsedData }: Props) {
    const isEditable = useEditorStore((store) => store.isEditable);
    const storeApi = useEditorStoreApi();
    const tableRef = useRef<HTMLTableElement | null>(null);

    // 该子树的稳定形态快照：光标定位在其上进行（uuid/type 为稳定键），
    // 仅在重解析时重算。
    const serialized = useMemo(
        () => serializeRenderData(parsedData as never) as SerializedRenderData & { uuid: string },
        [parsedData],
    );

    // 光标追踪：只订阅光标节点（uuid，不含 offset），因此在单元格内打字不会
    // 重渲染整个表格。光标不在本表内时解析为 null，不渲染任何挂件。
    const cursorUuid = useEditorStore((store) => store.startCursorInfo?.uuid ?? null);
    const cursorCell = useMemo(
        () => (cursorUuid ? locateCursorCell(serialized, cursorUuid) : null),
        [serialized, cursorUuid],
    );

    const appendColumn = useCallback(() => {
        storeApi?.addTableColumn(serialized.uuid);
    }, [storeApi, serialized.uuid]);

    const appendRow = useCallback(() => {
        storeApi?.addTableRow(serialized.uuid);
    }, [storeApi, serialized.uuid]);

    // 阻止 pointerdown 把焦点/光标移出编辑器，并阻止 click 冒泡进编辑器的选区处理。
    const swallowPointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    return (
        // 外层贴合表格宽度（w-max），左右条带才能贴住表格真实边缘；
        // 内核 .Table 的垂直外边距移到此处（mt-1/mb-5），表格本身归零。
        <div className="relative mt-1 mb-5 w-max max-w-[calc(100%-1.25rem)]">
            <div className="overflow-x-auto">
                <table
                    ref={tableRef}
                    contentEditable={isEditable}
                    {...getRenderElementProps(parsedData)}
                    {...getSpanRenderIdProps(parsedData)}
                    style={{ marginTop: 0, marginBottom: 0 }}
                >
                    <RenderChildren parsedData={parsedData} />
                </table>
            </div>
            {isEditable && cursorCell ? (
                <CellHandles
                    tableUuid={serialized.uuid}
                    location={cursorCell}
                    tableRef={tableRef}
                    parsedData={parsedData}
                />
            ) : null}
            {isEditable ? (
                <>
                    {/* 右缘热区：贴合表格右缘，覆盖间隙(4px)+条带(16px)。按钮贴
                        热区外侧放置，与表格之间保留间隙，悬停间隙也能显示按钮。 */}
                    <div {...viewOnlyProps} className="group/zone absolute top-0 bottom-0 left-full w-5">
                        <button
                            type="button"
                            title="添加列"
                            className={`${ADD_BUTTON_CLASS} inset-y-0 right-0 w-4`}
                            onPointerDown={swallowPointerDown}
                            onClick={(e) => {
                                e.stopPropagation();
                                appendColumn();
                            }}
                        >
                            <PlusIcon />
                        </button>
                    </div>
                    {/* 下缘热区：同理沿下边缘布置。 */}
                    <div {...viewOnlyProps} className="group/zone absolute top-full left-0 right-0 h-5">
                        <button
                            type="button"
                            title="添加行"
                            className={`${ADD_BUTTON_CLASS} inset-x-0 bottom-0 h-4`}
                            onPointerDown={swallowPointerDown}
                            onClick={(e) => {
                                e.stopPropagation();
                                appendRow();
                            }}
                        >
                            <PlusIcon />
                        </button>
                    </div>
                </>
            ) : null}
        </div>
    );
}

export const TableElement = memo(TableElementBase);

export const tableRenderComponent = {
    [MarkdownType.Table]: TableElement,
};
