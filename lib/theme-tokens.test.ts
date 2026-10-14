// The theme's color tokens (app/globals.css): every one resolves in both
// themes, components use them rather than raw colors, and the pairs the app
// draws hold their WCAG contrast. The rendered screens are checked with axe in
// e2e/contrast.spec.ts.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const CSS = readFileSync(path.join(ROOT, "app/globals.css"), "utf8");

// ── Parsing ────────────────────────────────────────────────────────────────

/** The body of the first rule whose selector line is exactly `selector {`. */
function block(selector: string): string {
  const start = CSS.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  return CSS.slice(start, CSS.indexOf("\n}\n", start));
}

function props(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Drop comments first: they mention token names.
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w*-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const THEME = props(block("@theme"));
const DARK = { ...THEME, ...props(block(":root")) };
const LIGHT = { ...DARK, ...props(block('[data-theme="light"]')) };
const SCOPES = { dark: DARK, light: LIGHT } as const;
type Scheme = keyof typeof SCOPES;

/** Semantic color tokens: the ones that make Tailwind utilities. */
const SEMANTIC = Object.keys(THEME)
  .filter((k) => k.startsWith("--color-") && THEME[k] !== "initial")
  .map((k) => k.slice("--color-".length));

// ── Color math ─────────────────────────────────────────────────────────────

type RGBA = [number, number, number, number]; // sRGB 0-255, alpha 0-1

function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const enc = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  return lin.map((x) => Math.round(Math.min(1, Math.max(0, enc(Math.min(1, Math.max(0, x))))) * 255)) as [number, number, number];
}

function resolve(value: string, scope: Record<string, string>, depth = 0): RGBA {
  if (depth > 10) throw new Error(`token cycle at ${value}`);
  const v = value.trim();
  const ref = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(v);
  if (ref) {
    const [, name, fallback] = ref;
    if (scope[name] !== undefined) return resolve(scope[name], scope, depth + 1);
    if (fallback) return resolve(fallback, scope, depth + 1);
    throw new Error(`${name} is not defined`);
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  const rgb = /^rgb\((\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\)$/.exec(v);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] ? Number(rgb[4]) : 1];
  const ok = /^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)$/.exec(v);
  if (ok) return [...oklchToRgb(Number(ok[1]) / 100, Number(ok[2]), Number(ok[3])), 1];
  throw new Error(`can't read color ${v}`);
}

/** A token's color in a theme; "name/15" is the token at 15% (a tint). */
function color(token: string, scheme: Scheme): RGBA {
  const [name, pct] = token.split("/");
  const prop = name.startsWith("--") ? name : `--color-${name}`;
  const c = resolve(`var(${prop})`, SCOPES[scheme]);
  return pct ? [c[0], c[1], c[2], c[3] * (Number(pct) / 100)] : c;
}

function over(top: RGBA, under: RGBA): RGBA {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1) as RGBA;
}

function luminance([r, g, b]: RGBA): number {
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast of fg on a stack of layers, the first painted lowest (e.g. card, then a tint). */
function contrast(fg: string, layers: string[], scheme: Scheme): number {
  const bg = layers.map((l) => color(l, scheme)).reduce((acc, c) => over(c, acc));
  const f = over(color(fg, scheme), bg);
  const [hi, lo] = [luminance(f), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ── Source files ───────────────────────────────────────────────────────────

function sources(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir)).flatMap((f) => {
    const rel = path.join(dir, f);
    if (statSync(path.join(ROOT, rel)).isDirectory()) return rel.startsWith("app/api") ? [] : sources(rel);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [rel] : [];
  });
}
const FILES = ["app", "components", "lib", "data", "hooks"].flatMap(sources);
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

// Fixed colors that are not theme colors.
const FIXED_COLOR_FILES: Record<string, string> = {
  "components/Logo.tsx": "brand artwork (docs/brand)",
  "components/ChessBoard.tsx": "the board's squares, fixed like a real board",
  "components/marketing/frames.tsx": "device hardware (bezels, buttons, window controls)",
  "components/marketing/app-chrome.tsx": "the phone's camera cutout",
  "app/layout.tsx": "theme-color meta for the first paint, before CSS",
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe("theme tokens", () => {
  it("defines the semantic set", () => {
    for (const t of ["bg", "card", "raised", "fill", "fg", "fg-muted", "fg-subtle", "line", "line-strong", "field", "focus", "accent", "accent-solid", "danger", "warning", "success", "info", "scrim", "on-accent"]) {
      expect(SEMANTIC, t).toContain(t);
    }
  });

  it("switches Tailwind's palette off", () => {
    expect(THEME["--color-*"]).toBe("initial");
  });

  it("gives every semantic token its own light value", () => {
    const light = props(block('[data-theme="light"]'));
    expect(SEMANTIC.filter((t) => light[`--color-${t}`] === undefined)).toEqual([]);
  });

  it.each(["dark", "light"] as const)("resolves every color token in %s", (scheme) => {
    const scope = SCOPES[scheme];
    const colorProps = Object.keys(scope).filter((k) => /^--(color|status|chart)-/.test(k) && scope[k] !== "initial");
    for (const k of colorProps) expect(() => resolve(`var(${k})`, scope), k).not.toThrow();
  });

  it("keeps light values inside sRGB (out-of-gamut colors fringe on edges)", () => {
    const light = props(block('[data-theme="light"]'));
    expect(Object.entries(light).filter(([, v]) => v.includes("oklch"))).toEqual([]);
  });
});

describe("components use the tokens", () => {
  const defined = new Set(Object.keys(LIGHT));
  // Custom properties a component sets on itself (style={{ "--x": … }}).
  for (const f of FILES) for (const m of read(f).matchAll(/["'](--[\w-]+)["']\s*:/g)) defined.add(m[1]);

  it("only references defined variables", () => {
    const missing: string[] = [];
    for (const f of [...FILES, "app/globals.css"]) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const m of code.matchAll(/var\((--[\w-]+)(,[^)]*)?\)/g)) {
        const name = m[1];
        if (name.startsWith("--tw-") || defined.has(name) || m[2]) continue; // a fallback covers -mark twins
        missing.push(`${f}: ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("uses no Tailwind palette classes", () => {
    const palette = /(?<![\w-])(?:[\w-]+:)*-?(?:bg|text|border(?:-[trblxy])?|divide|ring|from|to|via|fill|stroke|outline|placeholder|accent|caret|shadow|decoration)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?![\w-])/g;
    const hits = FILES.flatMap((f) => [...read(f).matchAll(palette)].map((m) => `${f}: ${m[0]}`));
    expect(hits).toEqual([]);
  });

  it("names a token in every color utility", () => {
    const tokens = new Set(SEMANTIC);
    const notColors = new Set([
      "transparent", "current", "inherit", "none", "dashed", "collapse", "inset", "center", "left", "right", "opacity",
      "xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "y", "x", "t", "b", "l", "r",
      "gradient-to-b", "gradient-to-br", "gradient-to-r",
    ]);
    const utility = /(?<![\w\-[/.])(?:[\w-]+:)*-?(bg|text|border|divide|ring|from|to|via|fill|stroke|outline|placeholder|caret|shadow|decoration)-([a-z][\w-]*?)(?:\/(?:\d+|\[[^\]]+\]))?(?=[\s"'`}]|$)/g;
    const unknown: string[] = [];
    for (const f of FILES) {
      for (const m of read(f).matchAll(utility)) {
        const name = m[2].replace(/^(?:[trblxy]|offset)-/, "");
        if (tokens.has(name) || notColors.has(name) || /^[trblxy]?-?\d+$/.test(name) || /^offset-\d+$/.test(m[2])) continue;
        if (m[1] === "placeholder" && f.includes("supabase")) continue;
        unknown.push(`${f}: ${m[0]}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("keeps raw colors to the fixed-color files", () => {
    const raw = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/;
    const hits = FILES.filter((f) => !FIXED_COLOR_FILES[f]).flatMap((f) =>
      read(f)
        .split("\n")
        .map((line, i) => ({ line: line.trim(), i }))
        // Skip comments and the "#id" of SVG url() references.
        .filter(({ line }) => raw.test(line.replace(/url\(#[^)]*\)/g, "")) && !line.startsWith("//") && !line.startsWith("*"))
        .map(({ line, i }) => `${f}:${i + 1} ${line.slice(0, 100)}`),
    );
    expect(hits).toEqual([]);
  });
});

describe("contrast (WCAG 2.2 AA)", () => {
  const surfaces = ["card", "bg"];
  const TEXT = 4.5;
  const MARK = 3; // UI component edges, chart lines, meaningful icons, large text

  type Pair = [fg: string, layers: string[], min: number];
  const pairs: Pair[] = [];
  const on = (fgs: string[], layers: string[][], min: number) => {
    for (const fg of fgs) for (const l of layers) pairs.push([fg, l, min]);
  };

  // Text on the page, cards and neutral fills.
  on(["fg", "fg-body", "fg-secondary", "fg-muted", "fg-subtle"], [["card"], ["bg"], ["card", "fill"], ["bg", "fill"]], TEXT);
  on(["accent-fg", "accent-fg-strong", "accent-fg-max"], [["card"], ["bg"], ["card", "accent/15"]], TEXT);
  // Status text on surfaces and on its own tint (bg-x/10 … /20).
  for (const [fg, base] of [
    ["danger-fg", "danger"], ["danger-fg-strong", "danger"],
    ["warning-fg", "warning"], ["warning-fg-strong", "warning"], ["warning-fg-max", "warning"],
    ["success-fg", "success"], ["success-fg-strong", "success"],
    ["ok-fg", "ok"], ["info-fg", "info"], ["info-fg-strong", "info"],
    ["auto-fg", "auto"], ["auto-fg-strong", "auto"], ["auto-fg-max", "auto"],
    ["attention-fg", "attention"], ["tag-cyan-fg", "tag-cyan"], ["tag-rose-fg", "tag-rose"],
  ]) {
    on([fg], [...surfaces.map((s) => [s]), ["card", `${base}/15`], ["card", `${base}/20`]], TEXT);
  }
  // White text on solid fills.
  on(["on-accent"], ["accent-solid", "info-solid", "danger-solid", "warning-solid", "ok-solid", "success-solid", "brand-from", "brand-to"].map((s) => [s]), TEXT);
  // Inline status text (badges, labels) on surfaces and its own 13% tint.
  for (const s of ["ok", "warn", "caution", "bad", "muted", "info", "blue", "sky", "violet", "teal", "orange"]) {
    on([`--status-${s}`], [["card"], ["bg"]], TEXT);
    // Scheduled-blue is only ever a number on a plain card, never on its tint.
    if (s !== "blue") on([`--status-${s}`], [["card", `--status-${s}-mark/13`]], TEXT);
  }
  // Shift-type and time-off labels on their own tints.
  for (const s of ["shift-opener", "shift-mid", "shift-closer", "timeoff-approved", "timeoff-denied", "timeoff-pending"]) {
    on([s], [["card"], ["card", `${s}-mark/13`]], TEXT);
  }
  // Control edges, focus and the marks that carry meaning on their own.
  on(["field", "line-emphasis", "focus"], surfaces.map((s) => [s]), MARK);
  on(["--status-ok-mark", "--status-warn-mark", "--status-caution-mark", "--status-bad-mark", "--status-info-mark", "--status-blue-mark", "--status-violet-mark"], surfaces.map((s) => [s]), MARK);
  // Charts: series and axis labels on the card.
  on(["--chart-scheduled", "--chart-target", "--chart-actual", "--chart-budget", "--chart-over", "--chart-under", "--chart-met"], [["card"]], MARK);
  on(["--chart-axis"], [["card"]], TEXT);
  on(["--chart-tooltip-fg"], [["--chart-tooltip-bg"]], TEXT);

  for (const scheme of ["light", "dark"] as const) {
    it(`holds every pair in ${scheme}`, () => {
      const failing = pairs
        .map(([fg, layers, min]) => ({ pair: `${fg} on ${layers.join(" + ")}`, ratio: contrast(fg, layers, scheme), min }))
        .filter((p) => p.ratio < p.min)
        .map((p) => `${p.pair}: ${p.ratio.toFixed(2)} < ${p.min}`);
      expect(failing).toEqual([]);
    });
  }
});
