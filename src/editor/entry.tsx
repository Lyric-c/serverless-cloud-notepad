import { createRoot } from "react-dom/client";
import { CloudEditor, type CloudEditorOptions } from "./CloudEditor";

// ── Theme detection & application ────────────────────────────────────────────

(function initTheme() {
    const stored = (() => {
        try {
            return localStorage.getItem("theme");
        } catch {
            return null;
        }
    })();
    const osDark = () =>
        window.matchMedia("(prefers-color-scheme: dark)").matches;

    const theme = stored || (osDark() ? "dark" : "light");
    document.documentElement.dataset.theme = theme;

    window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", (e) => {
            const current = (() => {
                try {
                    return localStorage.getItem("theme");
                } catch {
                    return null;
                }
            })();
            if (current) return;
            document.documentElement.dataset.theme = e.matches
                ? "dark"
                : "light";
        });
})();

// ── Public API ───────────────────────────────────────────────────────────────

;(window as any).CloudEditor = {
    mount(container: HTMLElement, options: {
        initialContent: string;
        path: string;
        metadata?: any;
        editable?: boolean;
        onSave?: (markdown: string) => Promise<void>;
        onPasswordSet?: (passwd: string) => Promise<void>;
        onShareToggle?: (enabled: boolean) => Promise<string | null>;
    }) {
        const root = createRoot(container);
        root.render(
            <CloudEditor
                initialContent={options.initialContent}
                path={options.path}
                metadata={options.metadata}
                editable={options.editable ?? true}
                onSave={options.onSave ?? (async () => {})}
                onPasswordSet={options.onPasswordSet}
                onShareToggle={options.onShareToggle}
            />
        );
        return root;
    },
};
