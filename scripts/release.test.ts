import { afterEach, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { archiveName, packageRelease } from "./release";

const root = resolve(import.meta.dir, "..");
const temporary: string[] = [];
function temp() { const path = mkdtempSync(join(tmpdir(), "grok-release-test-")); temporary.push(path); return path; }
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

test("archive names reject unsupported targets and unsafe versions", () => {
  expect(archiveName("0.1.0", "aarch64-apple-darwin")).toBe("grok-build2-0.1.0-aarch64-apple-darwin.tar.gz");
  expect(() => archiveName("../../escape", "aarch64-apple-darwin")).toThrow();
  expect(() => archiveName("0.1.0", "../../escape")).toThrow();
});

test("Changesets versions the private binary package without npm publishing", () => {
  const workspace = temp();
  mkdirSync(join(workspace, ".changeset"));
  writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "grok-build2", version: "0.1.0", private: true }));
  cpSync(join(root, ".changeset/config.json"), join(workspace, ".changeset/config.json"));
  writeFileSync(join(workspace, ".changeset/test.md"), '---\n"grok-build2": patch\n---\n\nFix a regression.\n');
  const result = spawnSync(process.execPath, [join(root, "node_modules/@changesets/cli/bin.js"), "version"], { cwd: workspace, encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(JSON.parse(readFileSync(join(workspace, "package.json"), "utf8")).version).toBe("0.1.1");
  expect(readFileSync(join(workspace, "CHANGELOG.md"), "utf8")).toContain("Fix a regression.");
  expect(existsSync(join(workspace, ".changeset/test.md"))).toBe(false);
});

test("source launcher resolves symlinks before invoking Cargo", () => {
  const workspace = temp();
  const source = join(workspace, "source"); const commands = join(workspace, "commands");
  mkdirSync(source); mkdirSync(commands);
  cpSync(join(root, "grok2"), join(source, "grok2"));
  chmodSync(join(source, "grok2"), 0o755);
  writeFileSync(join(source, "Cargo.toml"), "[workspace]\n");
  writeFileSync(join(commands, "cargo"), '#!/bin/sh\nexit 37\n');
  chmodSync(join(commands, "cargo"), 0o755);
  symlinkSync("../source/grok2", join(commands, "grok"));
  const result = spawnSync(join(commands, "grok"), ["build"], { env: { ...process.env, PATH: `${commands}:${process.env.PATH}` } });
  expect(result.status).toBe(37);
});

test("archive installs both command names and preserves resume arguments without building", () => {
  const workspace = temp();
  mkdirSync(join(workspace, "scripts"));
  for (const file of ["grok2", "LICENSE", "CHANGELOG.md", "THIRD-PARTY-NOTICES", "SOURCE_REV", "README.md", "scripts/install-release.sh", "scripts/update-release.rb"]) cpSync(join(root, file), join(workspace, file));
  const fakeBinary = join(workspace, "fake-binary");
  writeFileSync(fakeBinary, '#!/bin/sh\n[ "$GROK_DISABLE_AUTOUPDATER" = 1 ] || exit 9\nif [ "$1" = --version ]; then echo "grok 0.1.0"; exit; fi\n[ "$OPENAI_API_KEY" = test-only-key ] || exit 10\nprintf "%s\\n" "$@"\n');
  chmodSync(fakeBinary, 0o755);
  const target = process.platform === "darwin" ? "aarch64-apple-darwin" : "x86_64-unknown-linux-gnu";
  const archive = packageRelease(workspace, fakeBinary, "0.1.0", target);
  expect(readFileSync(`${archive}.sha256`, "utf8").split(" ")[0]).toBe(createHash("sha256").update(readFileSync(archive)).digest("hex"));
  const unpack = join(workspace, "unpack"); mkdirSync(unpack);
  expect(spawnSync("tar", ["-xzf", archive, "-C", unpack]).status).toBe(0);
  const install = join(workspace, "installed"); const commands = join(workspace, "commands");
  const env = { ...process.env, GROK2_INSTALL_DIR: install, GROK2_BIN_DIR: commands };
  const badInstall = spawnSync("bash", [join(unpack, "install.sh")], { env: { ...env, GROK2_BIN_DIR: install }, encoding: "utf8" });
  expect(badInstall.status).toBe(1);
  expect(badInstall.stderr).toContain("directories must differ");
  expect(existsSync(join(install, "grok2"))).toBe(false);
  expect(spawnSync("bash", [join(unpack, "install.sh")], { env }).status).toBe(0);
  expect(readlinkSync(join(commands, "grok"))).toBe(join(realpathSync(install), "grok2"));
  expect(readlinkSync(join(commands, "grok2"))).toBe(join(realpathSync(install), "grok2"));
  const mocks = join(workspace, "mocks"); mkdirSync(mocks);
  writeFileSync(join(mocks, "curl"), '#!/bin/sh\nprintf 200\n');
  writeFileSync(join(mocks, "ruby"), '#!/bin/sh\nprintf test-only-key\n');
  for (const file of ["curl", "ruby"]) chmodSync(join(mocks, file), 0o755);
  const config = join(workspace, "proxy.yaml"); writeFileSync(config, "api-keys: [test-only-key]\n");
  for (const command of ["grok", "grok2"]) {
    const result = spawnSync(join(commands, command), ["--resume", "saved-session"], {
      env: { ...env, PATH: `${mocks}:${process.env.PATH}`, CLI_PROXY_CONFIG: config, CLI_PROXY_BIN: fakeBinary, GROK2_BINARY: join(install, "xai-grok-pager") }, encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("--resume\nsaved-session\n");
  }
  expect(spawnSync("bash", [join(unpack, "install.sh")], { env }).status).toBe(0);
  expect(existsSync(join(install, "xai-grok-pager.previous"))).toBe(true);
});
