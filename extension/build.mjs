import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";

if (existsSync("dist")) rmSync("dist", { recursive: true });
mkdirSync("dist", { recursive: true });

const common = {
  bundle: true,
  target: "chrome120",
  sourcemap: true,
};

await Promise.all([
  esbuild.build({
    ...common,
    entryPoints: ["src/background/service-worker.ts"],
    outfile: "dist/service-worker.js",
    format: "esm",
  }),
  esbuild.build({
    ...common,
    entryPoints: ["src/content/content-main.ts"],
    outfile: "dist/content-main.js",
    format: "iife",
  }),
  esbuild.build({
    ...common,
    entryPoints: ["src/content/content-isolated.ts"],
    outfile: "dist/content-isolated.js",
    format: "iife",
  }),
  esbuild.build({
    ...common,
    entryPoints: ["src/popup/popup.ts"],
    outfile: "dist/popup.js",
    format: "iife",
  }),
]);

cpSync("manifest.json", "dist/manifest.json");
cpSync("src/popup/popup.html", "dist/popup.html");
cpSync("src/popup/popup.css", "dist/popup.css");

console.log("Build complete!");
