const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFile, readdir } = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function compileModule(source, filename, require) {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require, __filename: filename, __dirname: path.dirname(filename) });
  return module.exports;
}

async function loadCatalog() {
  const file = path.join(root, "src", "renderer", "i18n-catalog.ts");
  return compileModule(await readFile(file, "utf8"), file, () => { throw new Error("catalog must stay dependency-free"); }).semanticCatalog;
}

async function loadRuntimeCatalog() {
  const catalogFile = path.join(root, "src", "renderer", "i18n-catalog.ts");
  const catalog = compileModule(await readFile(catalogFile, "utf8"), catalogFile, () => { throw new Error("catalog must stay dependency-free"); });
  const runtimeFile = path.join(root, "src", "renderer", "i18n.tsx");
  return compileModule(await readFile(runtimeFile, "utf8"), runtimeFile, (request) => {
    if (request === "./i18n-catalog") return catalog;
    if (request === "react") return { createContext: () => ({}), useContext: () => null, useMemo: fn => fn(), useState: value => [value, () => {}] };
    if (request === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
    throw new Error(`unexpected runtime dependency: ${request}`);
  }).translationCatalog;
}

test("semantic localization keys are complete for both languages and every renderer use", async () => {
  const catalog = await loadCatalog();
  assert.deepEqual(Object.keys(catalog.ru).sort(), Object.keys(catalog.en).sort());
  for (const [locale, values] of Object.entries(catalog)) {
    for (const [key, value] of Object.entries(values)) assert.ok(value.trim(), `${locale}.${key} must not be empty`);
  }
  const directory = path.join(root, "src", "renderer");
  const files = await readdir(directory);
  const semanticUses = new Set();
  for (const file of files.filter(file => file.endsWith(".tsx") && file !== "i18n.tsx")) {
    const source = await readFile(path.join(directory, file), "utf8");
    for (const match of source.matchAll(/\bt\("([A-Za-z][A-Za-z0-9]*)"/g)) semanticUses.add(match[1]);
  }
  for (const key of semanticUses) assert.ok(Object.hasOwn(catalog.ru, key), `missing semantic locale key: ${key}`);
});

test("every renderer literal translated through t has an English runtime entry", async () => {
  const catalog = await loadRuntimeCatalog();
  const directory = path.join(root, "src", "renderer");
  const files = await readdir(directory);
  const uses = new Set();
  for (const file of files.filter(file => file.endsWith(".tsx") && file !== "i18n.tsx")) {
    const source = await readFile(path.join(directory, file), "utf8");
    for (const match of source.matchAll(/\bt\(\s*(["'])(.*?)\1/g)) uses.add(match[2]);
  }
  const missing = [...uses].filter(key => !Object.hasOwn(catalog.en, key));
  assert.deepEqual(missing, [], `missing English translations: ${missing.join(" | ")}`);
});

test("known renderer error fallbacks have English runtime entries", async () => {
  const catalog = await loadRuntimeCatalog();
  const directory = path.join(root, "src", "renderer");
  const files = await readdir(directory);
  const fallbacks = new Set();
  for (const file of files.filter(file => file.endsWith(".tsx"))) {
    const source = await readFile(path.join(directory, file), "utf8");
    for (const match of source.matchAll(/(?:set(?:Models)?Error|projectError)\([^\n]*?(["'])([А-Яа-яЁё][^"']*)\1/g)) fallbacks.add(match[2]);
  }
  const missing = [...fallbacks].filter(key => !Object.hasOwn(catalog.en, key));
  assert.deepEqual(missing, [], `missing English error fallback translations: ${missing.join(" | ")}`);
});
