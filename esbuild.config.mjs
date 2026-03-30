import esbuild from "esbuild";

const watch = process.argv.includes("watch");

const buildOptions = {
  entryPoints: ["main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  target: "es2018",
  platform: "browser",
  outfile: "main.js",
  logLevel: "info",
};

if (watch) {
  const context = await esbuild.context(buildOptions);
  await context.watch();
} else {
  await esbuild.build(buildOptions);
}
