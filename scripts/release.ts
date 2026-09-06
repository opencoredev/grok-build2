import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export function archiveName(version: string, target: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Expected a stable semantic version");
  if (!["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"].includes(target)) {
    throw new Error("Unsupported release target");
  }
  return `grok-build2-${version}-${target}.tar.gz`;
}

export function packageRelease(root: string, binary: string, version: string, target: string): string {
  const name = archiveName(version, target);
  const stage = mkdtempSync(join(tmpdir(), "grok-release-"));
  const output = join(root, "dist", name);
  try {
    mkdirSync(join(root, "dist"), { recursive: true });
    for (const file of ["grok2", "LICENSE", "CHANGELOG.md", "THIRD-PARTY-NOTICES", "SOURCE_REV", "README.md"]) {
      copyFileSync(join(root, file), join(stage, file));
    }
    copyFileSync(join(root, "scripts/install-release.sh"), join(stage, "install.sh"));
    copyFileSync(join(root, "scripts/update-release.rb"), join(stage, "update.rb"));
    writeFileSync(join(stage, "release.json"), JSON.stringify({ schema: 1, product: "grok-build2", version, target }) + "\n");
    copyFileSync(binary, join(stage, "xai-grok-pager"));
    for (const file of ["grok2", "install.sh", "xai-grok-pager"]) chmodSync(join(stage, file), 0o755);
    const result = spawnSync("tar", ["--format=ustar", "-czf", output, "-C", stage, "."], {
      stdio: "inherit", env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    if (result.status !== 0) throw new Error("Archive creation failed");
    const digest = createHash("sha256").update(readFileSync(output)).digest("hex");
    writeFileSync(`${output}.sha256`, `${digest}  ${basename(output)}\n`);
    return output;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [target, binary] = Bun.argv.slice(2);
  if (!target || !binary) throw new Error("Usage: bun scripts/release.ts TARGET BINARY");
  const root = resolve(import.meta.dir, "..");
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  console.log(packageRelease(root, resolve(binary), version, target));
}
