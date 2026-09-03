import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporary = await mkdtemp(join(tmpdir(), "resolvr-sdk-package-"));
const cache = join(temporary, "npm-cache");

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: cache },
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    process.exitCode = result.status ?? 1;
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return result.stdout;
}

try {
  const packageRoot = new URL("../", import.meta.url).pathname;
  const packed = JSON.parse(
    run(
      "npm",
      ["pack", "--json", "--pack-destination", temporary],
      packageRoot,
    ),
  );
  const packagedFiles = packed[0].files.map((file) => file.path);
  for (const required of [
    "dist/esm/index.js",
    "dist/esm/index.d.ts",
    "dist/esm/package.json",
    "dist/cjs/index.js",
    "dist/cjs/index.d.ts",
    "dist/cjs/package.json",
    "dist/types/index.d.ts",
    "README.md",
    "LICENSE",
  ]) {
    if (!packagedFiles.includes(required)) {
      throw new Error(`Published tarball is missing ${required}`);
    }
  }
  for (const forbiddenPrefix of [
    "src/",
    "test/",
    "scripts/",
    "contracts/",
    "docs/",
    ".github/",
  ]) {
    if (packagedFiles.some((file) => file.startsWith(forbiddenPrefix))) {
      throw new Error(
        `Published tarball contains forbidden path ${forbiddenPrefix}`,
      );
    }
  }
  const tarball = join(temporary, packed[0].filename);
  const tsc = join(packageRoot, "node_modules/typescript/lib/tsc.js");
  const install = join(temporary, "consumer");
  await writeFile(
    join(temporary, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  await mkdir(install, { recursive: true });
  await writeFile(
    join(install, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  run("npm", ["install", "--ignore-scripts", tarball], install);
  await writeFile(
    join(install, "esm.mjs"),
    'import { ResolvrClient } from "@resolvrlabs/sdk";\nconst client = new ResolvrClient({ apiKey: "smoke" });\nif (!client.apiBaseUrl.endsWith("/v1")) process.exit(1);\n',
  );
  await writeFile(
    join(install, "cjs.cjs"),
    'const { ResolvrClient } = require("@resolvrlabs/sdk");\nconst client = new ResolvrClient({ apiKey: "smoke" });\nif (!client.apiBaseUrl.endsWith("/v1")) process.exit(1);\n',
  );
  run(process.execPath, ["esm.mjs"], install);
  run(process.execPath, ["cjs.cjs"], install);

  const typeConsumer = `import {
  ResolvrClient,
  type RecaptchaV2Task,
} from "@resolvrlabs/sdk";

const client = new ResolvrClient({ apiKey: "smoke" });
const task: RecaptchaV2Task = {
  type: "recaptcha_v2",
  url: "https://example.test",
  proxy: "http://proxy.example.test:8080",
  params: { siteKey: "placeholder", data: { s: "" } },
};
void client.solve(task).then((result) => result.data.token);
`;
  await writeFile(join(install, "consumer-esm.ts"), typeConsumer);
  await writeFile(join(install, "consumer-cjs.cts"), typeConsumer);
  await writeFile(
    join(install, "tsconfig.esm.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["consumer-esm.ts"],
    }),
  );
  await writeFile(
    join(install, "tsconfig.cjs.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "Node16",
        moduleResolution: "Node16",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["consumer-cjs.cts"],
    }),
  );
  run(process.execPath, [tsc, "-p", "tsconfig.esm.json"], install);
  run(process.execPath, [tsc, "-p", "tsconfig.cjs.json"], install);

  const installedPackage = JSON.parse(
    await readFile(
      join(install, "node_modules/@resolvrlabs/sdk/package.json"),
      "utf8",
    ),
  );
  if (installedPackage.name !== "@resolvrlabs/sdk") {
    throw new Error("Installed package metadata is invalid");
  }
  if (
    installedPackage.exports?.["."]?.require?.types !== "./dist/cjs/index.d.ts"
  ) {
    throw new Error("CJS export is missing nested CommonJS types");
  }
  if (
    installedPackage.exports?.["."]?.import?.types !== "./dist/esm/index.d.ts"
  ) {
    throw new Error("ESM export is missing nested ESM types");
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
