import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = dirname(new URL(import.meta.url).pathname);

// ── CSS: PostCSS + Tailwind ──────────────────────────────────────────
async function buildCSS() {
    const postcss = (await import("postcss")).default;
    const tailwindcss = (await import("@tailwindcss/postcss")).default;

    const root = resolve(ROOT);
    const cssInput = resolve(root, "tailwind.css");
    const cssOutput = resolve(root, "static/css/editor.css");

    let css = readFileSync(cssInput, "utf-8");

    // Run Tailwind first
    const tailwindResult = await postcss([tailwindcss()]).process(css, {
        from: cssInput,
        to: cssOutput,
    });

    // Prepend do-md editor styles and prism theme
    const doMdCss = readFileSync(
        resolve(root, "node_modules/@do-md/core-react/style.css"),
        "utf-8",
    );
    const prismCss = readFileSync(resolve(root, "prism-theme.css"), "utf-8");

    const finalCss = doMdCss + "\n" + prismCss + "\n" + tailwindResult.css;

    mkdirSync(dirname(cssOutput), { recursive: true });
    writeFileSync(cssOutput, finalCss);
    console.log(
        `✓ CSS built → static/css/editor.css (${(finalCss.length / 1024).toFixed(1)} KB)`,
    );
}

// ── JS: esbuild bundle ───────────────────────────────────────────────
async function buildJS() {
    const entry = resolve(ROOT, "src/editor/entry.tsx");
    const outfile = resolve(ROOT, "static/js/editor.js");

    await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        minify: true,
        format: "iife",
        globalName: "__editor_module__", // unused externally; we use window.CloudEditor
        outfile,
        target: ["es2020"],
        external: [], // bundle everything
        define: {
            "process.env.NODE_ENV": '"production"',
        },
    });

    const stat = readFileSync(outfile);
    console.log(`✓ JS built  → static/js/editor.js (${(stat.length / 1024).toFixed(1)} KB)`);
}

// ── Run ──────────────────────────────────────────────────────────────
(async () => {
    console.log("Building editor...");
    await Promise.all([buildCSS(), buildJS()]);
    console.log("Done.");
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
