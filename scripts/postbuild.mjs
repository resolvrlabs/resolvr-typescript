import { cp, mkdir, writeFile } from "node:fs/promises";

const distDirectory = new URL("../dist/", import.meta.url);
const typesDirectory = new URL("types/", distDirectory);
const esmDirectory = new URL("esm/", distDirectory);
const cjsDirectory = new URL("cjs/", distDirectory);

await mkdir(esmDirectory, { recursive: true });
await mkdir(cjsDirectory, { recursive: true });
await cp(typesDirectory, esmDirectory, { recursive: true });
await cp(typesDirectory, cjsDirectory, { recursive: true });
await writeFile(new URL("package.json", esmDirectory), '{"type":"module"}\n');
await writeFile(new URL("package.json", cjsDirectory), '{"type":"commonjs"}\n');
