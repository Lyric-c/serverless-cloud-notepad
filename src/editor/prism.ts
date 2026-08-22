import Prism from "prismjs";
import type { ComponentProps } from "react";
import type { DOMDProvider } from "@do-md/core-react";

// 对齐 domd 官方 demo（common/lib/prism.ts）：token 类型直接从
// DOMDProvider 的 codeTokenizer 推导，tokenize() 对 Prism 结果做一次 cast。
// Prism 的 Token 结构比 core 的 Token 更宽松（嵌套 content 可能是单个 Token
// 而不是数组），但 core 在运行时能正常遍历 Prism token stream，所以在此
// cast 一次即可，无需额外的归一化层。
export type CodeToken = ReturnType<
    NonNullable<ComponentProps<typeof DOMDProvider>["codeTokenizer"]>
>[number];

// DOMD calls `tokenize` manually per code block. Disable Prism's
// DOMContentLoaded auto-highlight.
if (typeof window !== "undefined") {
    (Prism as unknown as { manual: boolean }).manual = true;
}

// ── Grammar registration ────────────────────────────────────────────────
//
// 官方 demo 用 `import("prismjs/components/...")` 按需动态加载，但我们的
// 产物是 esbuild 的 IIFE 单文件 bundle（无法代码分割），运行时动态 import
// 在浏览器里必然 404。因此所有要支持的语法都必须在这里静态引入。
import "prismjs/components/prism-markup"; // html / xml / svg
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-css";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-python";
import "prismjs/components/prism-java";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-php";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-docker";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-ini";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-graphql";

// Common shorthands users write in fenced code blocks.
const ALIAS: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    py: "python",
    rs: "rust",
    md: "markdown",
    yml: "yaml",
    cs: "csharp",
    "c#": "csharp",
    "c++": "cpp",
    kt: "kotlin",
    html: "markup",
    xml: "markup",
};

function normalize(lang: string): string {
    const k = lang.toLowerCase();
    return ALIAS[k] ?? k;
}

export function tokenize(code: string, lang?: string): CodeToken[] {
    if (!lang || !code) return [];
    const norm = normalize(lang);
    const grammar = Prism.languages[norm];
    if (grammar) return Prism.tokenize(code, grammar) as CodeToken[];
    return [];
}

export default Prism;
