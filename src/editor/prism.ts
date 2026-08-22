import Prism, { type Token, type TokenStream } from "prismjs";

// domd 的 codeTokenizer 期望的 token 形状：content 只能是 string 或 Token[]，
// 不允许裸 Token（见 @do-md/core-react 的 codeTokenizer 签名）。
export type CodeToken = string | {
    type: string;
    content: string | CodeToken[];
    alias?: string | string[];
    length?: number;
};

// DOMD calls `tokenize` manually per code block. Disable Prism's
// DOMContentLoaded auto-highlight.
if (typeof window !== "undefined") {
    (Prism as unknown as { manual: boolean }).manual = true;
}

// ── Grammar registration ────────────────────────────────────────────────
//
// 编辑器产物是 esbuild 的 IIFE 单文件 bundle，无法做代码分割，因此运行时
// `import("prismjs/components/...")` 在浏览器里会 404。所有要支持的语法都
// 必须在这里静态引入，让 esbuild 打进 bundle。
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

// Prism 的 Token.content 是 TokenStream（允许裸 Token），domd 渲染器只处理
// `string | Token[]`。这里递归归一化，把裸 Token 包成数组，避免 domd 在
// 提取文本时对非数组调用 forEach 报错。
function normalizeContent(content: TokenStream): string | CodeToken[] {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map(normalizeToken);
    return [normalizeToken(content)];
}

function normalizeToken(token: string | Token): CodeToken {
    if (typeof token === "string") return token;
    return {
        type: token.type,
        content: normalizeContent(token.content),
        ...(token.alias ? { alias: token.alias } : {}),
        ...(typeof token.length === "number" ? { length: token.length } : {}),
    };
}

export function tokenize(code: string, lang?: string): CodeToken[] {
    // 空代码块（刚输入 ```sql 还没内容）直接返回空数组。Prism.tokenize("")
    // 会返回 [""]，给 domd 的空 PreCode 塞进一个空 token 节点，破坏光标定位。
    if (!lang || !code) return [];
    const norm = normalize(lang);
    const grammar = Prism.languages[norm];
    if (grammar) return Prism.tokenize(code, grammar).map(normalizeToken);
    return [];
}

export default Prism;
