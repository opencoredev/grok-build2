import { afterEach, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { packageRelease } from "./release";

const root = resolve(import.meta.dir, "..");
const updater = join(root, "scripts/update-release.rb");
const target = process.platform === "darwin" ? "aarch64-apple-darwin" : "x86_64-unknown-linux-gnu";
const temps: string[] = [];
function temp() { const dir = mkdtempSync(join(tmpdir(), "grok-update-test-")); temps.push(dir); return dir; }
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function ruby(code: string, args: string[] = [], extra: Record<string, string> = {}) {
  return spawnSync("ruby", ["-r", updater, "-e", code, ...args], { encoding: "utf8", env: { ...process.env, ...extra }, timeout: 15000 });
}
function fixture() {
  const dir = temp();
  const install = join(dir, "installed");
  const commands = join(dir, "bin");
  const source = join(dir, "source");
  mkdirSync(join(source, "scripts"), { recursive: true });
  for (const file of ["grok2", "LICENSE", "CHANGELOG.md", "THIRD-PARTY-NOTICES", "SOURCE_REV", "README.md", "scripts/install-release.sh", "scripts/update-release.rb"]) {
    cpSync(join(root, file), join(source, file));
  }
  function payload(version: string, binaryVersion = version) {
    const binary = join(source, "binary");
    writeFileSync(binary, `#!/bin/sh\nif [ "$1" = --version ]; then echo "grok ${binaryVersion}"; exit; fi\nprintf '${version}\\n'; printf '%s\\n' "$@"\n`);
    chmodSync(binary, 0o755);
    const archive = packageRelease(source, binary, version, target);
    const unpacked = join(dir, `payload-${version}`);
    mkdirSync(unpacked);
    expect(spawnSync("tar", ["-xzf", archive, "-C", unpacked]).status).toBe(0);
    return { archive, unpacked };
  }
  const old = payload("0.1.0");
  const installed = ruby("Grok2Release.new(ARGV[0]).install(ARGV[1], ARGV[2])", [install, old.unpacked, commands]);
  expect(installed.status).toBe(0);
  return { dir, install, commands, source, payload };
}
const adapter = `
class FixtureRelease < Grok2Release
  def download(url, destination, limit)
    raise 'offline' if ENV['OFFLINE'] == '1'
    name = url.end_with?('/latest') ? 'latest.json' : File.basename(URI(url).path)
    FileUtils.cp(File.join(ENV.fetch('FEED'), name), destination)
  end
end
FixtureRelease.new(ARGV[0]).update(ARGV[1] == 'auto')
`;
function feed(fx: ReturnType<typeof fixture>, version = "0.1.1", binaryVersion = version) {
  const release = fx.payload(version, binaryVersion);
  const dir = join(fx.dir, `feed-${version}`); mkdirSync(dir);
  const name = basename(release.archive);
  for (const file of [name, `${name}.sha256`]) cpSync(join(fx.source, "dist", file), join(dir, file));
  const metadata = { tag_name: `v${version}`, draft: false, prerelease: false, assets: [name, `${name}.sha256`].map(name => ({ name, browser_download_url: `https://github.com/opencoredev/grok-build2/releases/download/v${version}/${name}` })) };
  writeFileSync(join(dir, "latest.json"), JSON.stringify(metadata));
  return { dir, name, metadata, ...release };
}
function current(fx: ReturnType<typeof fixture>) { return readlinkSync(join(fx.install, "current")); }

test("update switches a complete release, keeps aliases and supports rollback", () => {
  const fx = fixture(); const before = current(fx); const next = feed(fx);
  const result = ruby(adapter, [fx.install], { FEED: next.dir });
  expect(result.stderr).toBe(""); expect(result.status).toBe(0);
  expect(current(fx)).not.toBe(before);
  expect(realpathSync(join(fx.install, "previous"))).toBe(realpathSync(join(fx.install, before)));
  expect(realpathSync(join(fx.commands, "grok"))).toBe(realpathSync(join(fx.commands, "grok2")));
  expect(readFileSync(join(fx.install, "current", "release.json"), "utf8")).toContain('"0.1.1"');
  expect(spawnSync(join(fx.install, before, "xai-grok-pager"), ["--version"], { encoding: "utf8" }).stdout).toContain("0.1.0");
  expect(ruby("Grok2Release.new(ARGV[0]).rollback", [fx.install]).status).toBe(0);
  expect(current(fx)).toBe(before);
  expect(existsSync(join(fx.install, ".update-paused"))).toBe(true);
  expect(ruby(adapter, [fx.install, "auto"], { FEED: next.dir }).status).toBe(0);
  expect(current(fx)).toBe(before);
  expect(ruby(adapter, [fx.install], { FEED: next.dir }).status).toBe(0);
  expect(current(fx)).not.toBe(before);
});

test("offline checks and corrupt checksums keep the installed release", () => {
  const fx = fixture(); const before = current(fx); const next = feed(fx);
  expect(ruby(adapter, [fx.install], { FEED: next.dir, OFFLINE: "1" }).status).not.toBe(0);
  expect(current(fx)).toBe(before);
  writeFileSync(join(next.dir, `${next.name}.sha256`), `${"0".repeat(64)}  ${next.name}\n`);
  const result = ruby(adapter, [fx.install], { FEED: next.dir });
  expect(result.status).not.toBe(0); expect(result.stderr).toContain("checksum");
  expect(current(fx)).toBe(before);
});

test("bad metadata never changes the active release", () => {
  const fx = fixture(); const before = current(fx); const next = feed(fx);
  for (const metadata of [
    { ...next.metadata, prerelease: true },
    { ...next.metadata, draft: true },
    { ...next.metadata, tag_name: "v../../escape" },
    { ...next.metadata, assets: [] },
    { ...next.metadata, assets: next.metadata.assets.map(asset => ({ ...asset, browser_download_url: "https://example.com/evil" })) },
    { ...next.metadata, assets: [...next.metadata.assets, next.metadata.assets[0]] },
  ]) {
    writeFileSync(join(next.dir, "latest.json"), JSON.stringify(metadata));
    expect(ruby(adapter, [fx.install], { FEED: next.dir }).status).not.toBe(0);
    expect(current(fx)).toBe(before);
  }
  writeFileSync(join(next.dir, "latest.json"), "not json");
  expect(ruby(adapter, [fx.install], { FEED: next.dir }).status).not.toBe(0);
});

test("binary version failure and activation failure preserve the old installation", () => {
  const fx = fixture(); const before = current(fx); const bad = feed(fx, "0.1.1", "0.0.9");
  expect(ruby(adapter, [fx.install], { FEED: bad.dir }).stderr).toContain("binary version check failed");
  expect(current(fx)).toBe(before);
  const good = feed(fx, "0.1.3");
  expect(ruby(adapter, [fx.install], { FEED: good.dir }).status).toBe(0);
  const activeBeforeFailure = current(fx);
  const previousBeforeFailure = realpathSync(join(fx.install, "previous"));
  const releasesBeforeFailure = readdirSync(join(fx.install, "releases")).sort();
  const next = feed(fx, "0.1.4");
  const fail = `class FailedActivation < Grok2Release
    def atomic_link(target, path)
      raise 'injected activation failure' if File.basename(path) == 'current'
      super
    end
  end
  update = FailedActivation.new(ARGV[0]); update.locked { update.activate(ARGV[1]) }`;
  expect(ruby(fail, [fx.install, next.unpacked]).status).not.toBe(0);
  expect(current(fx)).toBe(activeBeforeFailure);
  expect(realpathSync(join(fx.install, "previous"))).toBe(previousBeforeFailure);
  expect(readdirSync(join(fx.install, "releases")).sort()).toEqual(releasesBeforeFailure);
  expect(spawnSync(join(fx.install, "xai-grok-pager"), ["--version"], { encoding: "utf8" }).stdout).toContain("0.1.3");
  expect(ruby("Grok2Release.new(ARGV[0]).rollback", [fx.install]).status).toBe(0);
  expect(current(fx)).toBe(before);
});

test("unsafe archives reject links, traversal, duplicates and missing files", () => {
  const fx = fixture();
  for (const kind of ["symlink", "traversal", "duplicate", "missing"]) {
    const archive = join(fx.dir, `${kind}.tgz`); const dest = join(fx.dir, kind); mkdirSync(dest);
    const make = `Zlib::GzipWriter.open(ARGV[0]) do |gz|
      Gem::Package::TarWriter.new(gz) do |tar|
        case ARGV[1]
        when 'symlink' then tar.add_symlink('grok2', '/tmp/escape', 0755)
        when 'traversal' then tar.add_file_simple('../escape', 0644, 1) { |f| f.write('x') }
        when 'duplicate' then 2.times { tar.add_file_simple('grok2', 0755, 1) { |f| f.write('x') } }
        end
      end
    end`;
    expect(ruby(make, [archive, kind]).status).toBe(0);
    expect(ruby("Grok2Release.new(ARGV[0]).unpack(ARGV[1], ARGV[2])", [fx.install, archive, dest]).status).not.toBe(0);
    expect(existsSync(join(fx.dir, "escape"))).toBe(false);
  }
});

test("equal and older releases are skipped and auto checks are throttled", () => {
  const fx = fixture(); const before = current(fx); const next = feed(fx);
  for (const version of ["0.1.0", "0.0.9"]) {
    writeFileSync(join(next.dir, "latest.json"), JSON.stringify({ ...next.metadata, tag_name: `v${version}` }));
    expect(ruby(adapter, [fx.install], { FEED: next.dir }).status).toBe(0);
    expect(current(fx)).toBe(before);
  }
  expect(ruby(adapter, [fx.install, "auto"], { FEED: next.dir, OFFLINE: "1" }).status).toBe(0);
});

test("a held update lock skips automatic work and releases after process exit", async () => {
  const fx = fixture(); const next = feed(fx);
  const child = spawn("ruby", ["-r", updater, "-e", "Grok2Release.new(ARGV[0]).locked { STDOUT.sync = true; puts 'locked'; sleep 30 }", fx.install], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => { child.stdout.once("data", () => resolve()); child.once("error", reject); child.once("exit", () => reject(new Error("lock holder exited"))); });
    expect(ruby(adapter, [fx.install, "auto"], { FEED: next.dir }).status).toBe(0);
    expect(ruby(adapter, [fx.install], { FEED: next.dir }).stderr).toContain("in progress");
  } finally { child.kill("SIGKILL"); await new Promise(resolve => child.once("exit", resolve)); }
  expect(ruby(adapter, [fx.install], { FEED: next.dir }).status).toBe(0);
});

test("launches preserve arguments and status while background update fails", () => {
  const fx = fixture(); const mocks = join(fx.dir, "mocks"); mkdirSync(mocks);
  const actualRuby = spawnSync("which", ["ruby"], { encoding: "utf8" }).stdout.trim();
  writeFileSync(join(mocks, "curl"), '#!/bin/sh\nprintf 200\n');
  const marker = join(fx.dir, "auto-started");
  writeFileSync(join(mocks, "ruby"), `#!/bin/sh\nif [ "$2" = auto ]; then touch '${marker}'; exit 42; fi\nexec '${actualRuby}' "$@"\n`);
  for (const name of ["curl", "ruby"]) chmodSync(join(mocks, name), 0o755);
  const config = join(fx.dir, "proxy.yaml"); writeFileSync(config, "api-keys: [test-key]\n");
  const env = { ...process.env, GROK2_AUTO_UPDATE: "1", PATH: `${mocks}:${process.env.PATH}`, CLI_PROXY_BIN: join(fx.install, "xai-grok-pager"), CLI_PROXY_CONFIG: config };
  delete env.GROK2_BINARY;
  for (const args of [[], ["--resume", "saved session"], ["--continue"], ["--single", "hello world"]]) {
    const result = spawnSync(join(fx.commands, "grok2"), args, { env, encoding: "utf8", timeout: 5000 });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`0.1.0\n${args.length ? args.join("\n") : ""}\n`);
  }
  // Wait for the detached test updater, not for any network operation.
  expect(spawnSync("ruby", ["-e", "100.times { exit if File.exist?(ARGV[0]); sleep 0.01 }; exit 1", marker]).status).toBe(0);
  rmSync(marker);
  expect(spawnSync(join(fx.commands, "grok2"), ["--continue"], { env: { ...env, GROK2_AUTO_UPDATE: "0" }, timeout: 5000 }).status).toBe(0);
  expect(existsSync(marker)).toBe(false);
  expect(spawnSync(join(fx.commands, "grok2"), ["--no-auto-update", "--continue"], { env, timeout: 5000 }).status).toBe(0);
  expect(existsSync(marker)).toBe(false);
});

test("HTTP transport rejects failed requests, unsafe redirects and oversized bodies", () => {
  const fx = fixture();
  const code = `
    class FakeConnection
      def request(request)
        raise 'unexpected credentials' if request['authorization']
        mode = ENV.fetch('HTTP_CASE')
        raise Net::ReadTimeout if mode == 'timeout'
        response = case mode
        when '403' then Net::HTTPForbidden.new('1.1', '403', 'Forbidden')
        when '429' then Net::HTTPTooManyRequests.new('1.1', '429', 'Too many requests')
        when 'redirect'
          result = Net::HTTPFound.new('1.1', '302', 'Found')
          result['location'] = 'http://example.com/untrusted'
          result
        else Net::HTTPOK.new('1.1', '200', 'OK')
        end
        def response.read_body; yield 'too much data'; end
        yield response
      end
    end
    class << Net::HTTP
      def start(*args, **options); yield FakeConnection.new; end
    end
    Grok2Release.new(ARGV[0]).download('https://api.github.com/repos/opencoredev/grok-build2/releases/latest', ARGV[1], 4)
  `;
  for (const [mode, error] of [["403", "HTTP 403"], ["429", "HTTP 429"], ["timeout", "Net::ReadTimeout"], ["redirect", "Untrusted update URL"], ["oversize", "too large"]]) {
    const result = ruby(code, [fx.install, join(fx.dir, "download")], { HTTP_CASE: mode });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(error);
  }
  expect(ruby("Grok2Release.new(ARGV[0]).download('http://example.com/file', ARGV[1], 4)", [fx.install, join(fx.dir, "bad")]).stderr).toContain("Untrusted update URL");
});

test("flat installation migration retains the old executable and command backups", () => {
  const fx = fixture(); const next = fx.payload("0.2.0");
  const legacy = join(fx.dir, "legacy"); const commands = join(fx.dir, "legacy-bin");
  mkdirSync(legacy); mkdirSync(commands);
  writeFileSync(join(legacy, "xai-grok-pager"), "old binary");
  writeFileSync(join(legacy, "grok2"), "old launcher");
  symlinkSync(join(legacy, "grok2"), join(commands, "grok"));
  const result = ruby("Grok2Release.new(ARGV[0]).install(ARGV[1], ARGV[2])", [legacy, next.unpacked, commands]);
  expect(result.status).toBe(0);
  expect(readFileSync(join(legacy, "xai-grok-pager.previous"), "utf8")).toBe("old binary");
  expect(readFileSync(join(legacy, "grok2.previous"), "utf8")).toBe("old launcher");
  expect(realpathSync(join(commands, "grok"))).toBe(realpathSync(join(legacy, "grok2")));
  expect(readFileSync(join(legacy, "grok2"), "utf8")).toContain('exec "$release/grok2" "$@"');
});

test("an updater killed during staging leaves the old release usable", async () => {
  const fx = fixture(); const before = current(fx); const next = feed(fx);
  const code = `class PausedRelease < Grok2Release
    def smoke_test(source, data)
      STDOUT.sync = true; puts 'staged'; sleep 30
    end
  end
  updater = PausedRelease.new(ARGV[0]); updater.locked { updater.activate(ARGV[1]) }`;
  const child = spawn("ruby", ["-r", updater, "-e", code, fx.install, next.unpacked], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => { child.stdout.once("data", () => resolve()); child.once("error", reject); child.once("exit", () => reject(new Error("staging process exited"))); });
    expect(current(fx)).toBe(before);
  } finally { child.kill("SIGKILL"); await new Promise(resolve => child.once("exit", resolve)); }
  expect(spawnSync(join(fx.install, "xai-grok-pager"), ["--version"], { encoding: "utf8" }).stdout).toContain("0.1.0");
  expect(ruby(adapter, [fx.install], { FEED: next.dir }).status).toBe(0);
});

test("simultaneous updates converge on one complete release", async () => {
  const fx = fixture(); const before = current(fx); const next = feed(fx);
  const run = () => new Promise<{ status: number | null; error: string }>((resolve, reject) => {
    const child = spawn("ruby", ["-r", updater, "-e", adapter, fx.install], { env: { ...process.env, FEED: next.dir }, stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", chunk => { error += chunk; });
    child.once("error", reject);
    child.once("close", status => resolve({ status, error }));
  });
  const results = await Promise.all([run(), run()]);
  expect(results.some(result => result.status === 0)).toBe(true);
  for (const result of results) if (result.status !== 0) expect(result.error).toContain("in progress");
  expect(realpathSync(join(fx.install, "previous"))).toBe(realpathSync(join(fx.install, before)));
  expect(readFileSync(join(fx.install, "current", "release.json"), "utf8")).toContain('"0.1.1"');
  expect(spawnSync(join(fx.install, "xai-grok-pager"), ["--version"], { encoding: "utf8" }).stdout).toContain("0.1.1");
});
