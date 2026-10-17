const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const generatedIndex = path.join(dist, "index.html");
const templatePath = path.join(root, "web", "index.html");

if (!fs.existsSync(generatedIndex)) {
  throw new Error("Expo web export not found at frontend/dist/index.html");
}

const generated = fs.readFileSync(generatedIndex, "utf8");
const entryScript = generated.match(/<script[^>]+src=["'][^"']*entry-[^"']+\.js["'][^>]*><\/script>/i);
if (!entryScript) {
  throw new Error("Unable to locate the generated Expo entry script");
}

const template = fs.readFileSync(templatePath, "utf8");
const output = template.replace("</body>", `  ${entryScript[0]}\n</body>`);
fs.writeFileSync(generatedIndex, output, "utf8");

for (const name of ["logo-icon.png", "og-image.png"]) {
  fs.copyFileSync(path.join(root, "public", name), path.join(dist, name));
}

const generatedImages = path.join(dist, "assets", "images");
fs.mkdirSync(generatedImages, { recursive: true });
for (const name of ["favicon.png", "icon.png"]) {
  fs.copyFileSync(path.join(root, "assets", "images", name), path.join(generatedImages, name));
}

// pnpm's virtual store can leak into Metro asset URLs, producing paths such as
// /assets/node_modules/.pnpm/<store-key>/node_modules/<package>/... . Some
// static hosts skip dot-directories, which makes icon fonts render as empty
// squares. Flatten those generated assets to the stable node_modules layout
// used by the previous production bundle and rewrite bundle references.
const webBundles = path.join(dist, "_expo", "static", "js", "web");
const virtualStore = path.join(dist, "assets", "node_modules", ".pnpm");
if (fs.existsSync(virtualStore)) {
  for (const storeEntry of fs.readdirSync(virtualStore)) {
    const nestedModules = path.join(virtualStore, storeEntry, "node_modules");
    if (fs.existsSync(nestedModules)) {
      fs.cpSync(nestedModules, path.join(dist, "assets", "node_modules"), {
        recursive: true,
        force: true,
      });
    }
  }

  for (const name of fs.readdirSync(webBundles)) {
    if (!name.endsWith(".js")) continue;
    const bundlePath = path.join(webBundles, name);
    const bundle = fs.readFileSync(bundlePath, "utf8");
    const normalized = bundle.replace(
      /\/assets\/node_modules\/\.pnpm\/[^/"']+\/node_modules\//g,
      "/assets/node_modules/",
    );
    fs.writeFileSync(bundlePath, normalized, "utf8");
  }

  fs.rmSync(virtualStore, { recursive: true, force: true });
}

fs.writeFileSync(path.join(dist, "_redirects"), "/* /index.html 200\n", "utf8");
