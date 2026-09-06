#!/usr/bin/env ruby
# Updates only this fork. No provider credentials are sent to GitHub.
require 'json'
require 'net/http'
require 'uri'
require 'digest'
require 'fileutils'
require 'tmpdir'
require 'securerandom'
require 'timeout'
require 'zlib'
require 'rubygems/package'
require 'rbconfig'

class Grok2Release
  REPO = 'opencoredev/grok-build2'.freeze
  FILES = %w[xai-grok-pager grok2 update.rb install.sh release.json LICENSE CHANGELOG.md THIRD-PARTY-NOTICES SOURCE_REV README.md].freeze
  EXECUTABLES = %w[xai-grok-pager grok2 install.sh].freeze
  TARGETS = %w[x86_64-unknown-linux-gnu aarch64-apple-darwin].freeze
  MAX_ARCHIVE = 600 * 1024 * 1024
  MAX_EXPANDED = 1200 * 1024 * 1024
  INTERVAL = 6 * 60 * 60
  BOOTSTRAP = <<~'SH'.freeze
    #!/usr/bin/env bash
    set -euo pipefail
    launcher="${BASH_SOURCE[0]}"
    while [[ -L "$launcher" ]]; do
      directory="$(cd -- "$(dirname -- "$launcher")" && pwd -P)"
      launcher="$(readlink "$launcher")"
      [[ "$launcher" == /* ]] || launcher="$directory/$launcher"
    done
    directory="$(cd -- "$(dirname -- "$launcher")" && pwd -P)"
    release="$(cd -- "$directory/current" && pwd -P)"
    exec "$release/grok2" "$@"
  SH

  def initialize(root)
    @root = File.expand_path(root)
  end

  def version(value)
    raise 'Invalid release version' unless value.is_a?(String) && value.size < 64 && value.match?(/\A(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\z/)
    value.split('.').map(&:to_i)
  end

  def manifest(directory)
    data = JSON.parse(File.read(File.join(directory, 'release.json')))
    raise 'Unsupported release manifest' unless data['schema'] == 1 && data['product'] == 'grok-build2' && TARGETS.include?(data['target'])
    version(data['version'])
    data
  end

  def active(name = 'current')
    if name == 'previous'
      current = active
      return nil unless current
      link = File.join(current, '.previous')
      return nil unless File.symlink?(link)
      target = File.readlink(link)
      raise 'Invalid previous release link' unless target.match?(%r{\A\.\./[a-zA-Z0-9._-]+\z})
      directory = File.expand_path(target, current)
      raise 'Missing previous release' unless File.directory?(directory) && !File.symlink?(directory)
      return directory
    end
    link = File.join(@root, name)
    return nil unless File.symlink?(link)
    target = File.readlink(link)
    raise "Invalid #{name} release link" unless target.match?(%r{\Areleases/[a-zA-Z0-9._-]+\z})
    directory = File.join(@root, target)
    raise "Missing #{name} release" unless File.directory?(directory) && !File.symlink?(directory)
    directory
  end

  def locked
    FileUtils.mkdir_p(@root)
    @root = File.realpath(@root)
    File.open(File.join(@root, '.update.lock'), File::RDWR | File::CREAT, 0600) do |lock|
      return false unless lock.flock(File::LOCK_EX | File::LOCK_NB)
      yield
      true
    end
  end

  def atomic_link(target, path)
    staged = File.join(File.dirname(path), ".link-#{SecureRandom.hex(8)}")
    begin
      File.symlink(target, staged)
      File.rename(staged, path)
    ensure
      File.unlink(staged) if File.symlink?(staged)
    end
  end

  def validate_payload(source)
    data = manifest(source)
    FILES.each do |name|
      path = File.join(source, name)
      raise "Invalid release file: #{name}" unless File.file?(path) && !File.symlink?(path)
    end
    EXECUTABLES.each do |name|
      raise "Release file is not executable: #{name}" unless File.executable?(File.join(source, name))
    end
    data
  end

  def smoke_test(source, data)
    cpu = RbConfig::CONFIG['host_cpu']
    os = RbConfig::CONFIG['host_os']
    target = if os.include?('darwin') && ['arm64', 'aarch64'].include?(cpu)
      'aarch64-apple-darwin'
    elsif os.include?('linux') && cpu == 'x86_64'
      'x86_64-unknown-linux-gnu'
    end
    raise 'Release does not support this platform' unless data['target'] == target
    Dir.mktmpdir('.smoke-', @root) do |directory|
      output = File.join(directory, 'version')
      pid = Process.spawn({'GROK_DISABLE_AUTOUPDATER' => '1', 'GROK2_AUTO_UPDATE' => '0'},
        File.join(source, 'xai-grok-pager'), '--version', :out => output, :err => File::NULL)
      begin
        status = Timeout.timeout(10) { Process.wait2(pid)[1] }
        text = File.open(output) { |file| file.read(4096) }
        raise 'Release binary version check failed' unless status.success? && text.split.any? { |part| [data['version'], "v#{data['version']}"].include?(part) }
      rescue Timeout::Error
        Process.kill('KILL', pid) rescue Errno::ESRCH
        Process.wait(pid) rescue Errno::ECHILD
        raise 'Release binary version check timed out'
      end
    end
  end

  def activate(source)
    data = validate_payload(source)
    old = active
    if old
      installed = manifest(old)
      raise 'Release target does not match installation' unless data['target'] == installed['target']
      return false unless (version(data['version']) <=> version(installed['version'])) == 1
    elsif File.exist?(File.join(@root, 'current'))
      raise 'Current release path is not a managed link'
    end
    releases = File.join(@root, 'releases')
    raise 'Release directory must not be a symlink' if File.symlink?(releases)
    FileUtils.mkdir_p(releases)
    stage = Dir.mktmpdir('.stage-', releases)
    destination = nil
    activated = false
    begin
      FILES.each { |name| FileUtils.cp(File.join(source, name), File.join(stage, name), :preserve => true) }
      validate_payload(stage)
      smoke_test(stage, data)
      name = "#{data['version']}-#{SecureRandom.hex(6)}"
      destination = File.join(releases, name)
      File.symlink("../#{File.basename(old)}", File.join(stage, '.previous')) if old
      File.rename(stage, destination)
      atomic_link("releases/#{name}", File.join(@root, 'current'))
      activated = true
      true
    ensure
      FileUtils.remove_entry(stage) if File.directory?(stage)
      # A failed pointer swap must not retain an unreachable full binary.
      if destination && !activated && File.directory?(destination) && active != destination
        FileUtils.remove_entry(destination)
      end
    end
  end

  def install(source, commands)
    commands = File.expand_path(commands)
    FileUtils.mkdir_p([@root, commands])
    @root = File.realpath(@root)
    commands = File.realpath(commands)
    raise 'Install and command directories must differ.' if File.realpath(@root) == File.realpath(commands)
    raise 'Another installation is in progress' unless locked do
      validate_payload(source)
      # Migrate flat installations and preserve user command backups only once.
      [[@root, 'grok2'], [@root, 'xai-grok-pager'], [commands, 'grok'], [commands, 'grok2']].each do |dir, name|
        path = File.join(dir, name)
        next unless File.exist?(path) || File.symlink?(path)
        raise "Cannot replace directory: #{path}" if File.directory?(path) && !File.symlink?(path)
        backup = "#{path}.previous"
        unless File.exist?(backup) || File.symlink?(backup)
          File.symlink(File.readlink(path), backup) if File.symlink?(path)
          FileUtils.cp(path, backup, :preserve => true) unless File.symlink?(path)
        end
      end
      activate(source)
      atomic_link('current/.previous', File.join(@root, 'previous'))
      bootstrap = File.join(@root, ".bootstrap-#{SecureRandom.hex(8)}")
      begin
        File.write(bootstrap, BOOTSTRAP)
        File.chmod(0755, bootstrap)
        File.rename(bootstrap, File.join(@root, 'grok2'))
      ensure
        File.unlink(bootstrap) if File.exist?(bootstrap)
      end
      atomic_link('current/xai-grok-pager', File.join(@root, 'xai-grok-pager'))
      %w[grok grok2].each { |name| atomic_link(File.join(@root, 'grok2'), File.join(commands, name)) }
    end
    puts "Installed Grok Build 2. Add #{commands} to PATH."
    puts 'Updates install in the background. Restart to use the new version.'
  end

  def rollback
    raise 'Another installation is in progress' unless locked do
      current = active
      previous = active('previous')
      raise 'No previous release is available' unless current && previous
      validate_payload(previous)
      # Hold this version until the user explicitly requests another update.
      File.write(File.join(@root, '.update-paused'), '')
      atomic_link("releases/#{File.basename(previous)}", File.join(@root, 'current'))
    end
    puts 'Previous release restored. Automatic updates paused; run grok2 update to resume.'
  end

  def download(url, path, limit)
    uri = URI(url)
    6.times do
      allowed = %w[api.github.com github.com release-assets.githubusercontent.com objects.githubusercontent.com]
      raise 'Untrusted update URL' unless uri.scheme == 'https' && uri.port == 443 && !uri.userinfo && allowed.include?(uri.host)
      redirect = nil
      Net::HTTP.start(uri.host, uri.port, :use_ssl => true, :open_timeout => 5, :read_timeout => 15) do |http|
        request = Net::HTTP::Get.new(uri.request_uri)
        request['User-Agent'] = 'grok-build2-updater'
        http.request(request) do |response|
          if response.is_a?(Net::HTTPRedirection)
            redirect = URI.join(uri.to_s, response.fetch('location'))
          else
            raise "Update server returned HTTP #{response.code}" unless response.is_a?(Net::HTTPSuccess)
            size = 0
            File.open(path, 'wb', 0600) do |file|
              response.read_body do |chunk|
                size += chunk.bytesize
                raise 'Release download is too large' if size > limit
                file.write(chunk)
              end
            end
          end
        end
      end
      return unless redirect
      uri = redirect
    end
    raise 'Too many update redirects'
  end

  def unpack(archive, directory)
    seen = []
    total = 0
    Zlib::GzipReader.open(archive) do |gzip|
      Gem::Package::TarReader.new(gzip) do |tar|
        tar.each do |entry|
          next if entry.directory? && ['.', './'].include?(entry.full_name)
          name = entry.full_name.sub(%r{\A\./}, '')
          raise "Unsafe release archive entry: #{name.inspect}" unless FILES.include?(name) && entry.file? && !seen.include?(name)
          total += entry.header.size
          raise 'Expanded release is too large' if total > MAX_EXPANDED
          seen << name
          path = File.join(directory, name)
          File.open(path, 'wb', 0600) do |file|
            until entry.eof?
              file.write(entry.read(1024 * 1024))
            end
          end
          File.chmod(entry.header.mode & 0777, path)
        end
      end
    end
    validate_payload(directory)
  end

  def update(automatic = false)
    result = locked do
      current = active
      raise 'Install a release archive first; source builds are not auto-updated' unless current
      installed = manifest(current)
      stamp = File.join(@root, '.update-check')
      if automatic
        next if File.exist?(File.join(@root, '.update-paused'))
        next if File.exist?(stamp) && (Time.now - File.mtime(stamp)) < INTERVAL
      end
      File.write(stamp, '')
      Dir.mktmpdir('.download-', @root) do |stage|
        Timeout.timeout(120) do
          metadata = File.join(stage, 'latest.json')
          download("https://api.github.com/repos/#{REPO}/releases/latest", metadata, 2 * 1024 * 1024)
          release = JSON.parse(File.read(metadata))
          raise 'Latest release is not stable' if release['draft'] || release['prerelease']
          tag = release.fetch('tag_name')
          raise 'Invalid release tag' unless tag.is_a?(String) && tag.start_with?('v')
          latest = tag[1..-1]
          if (version(latest) <=> version(installed['version'])) != 1
            puts "Grok Build 2 #{installed['version']} is current." unless automatic
            next
          end
          name = "grok-build2-#{latest}-#{installed['target']}.tar.gz"
          [name, "#{name}.sha256"].each do |asset_name|
            matches = release.fetch('assets').select { |asset| asset['name'] == asset_name }
            expected = "https://github.com/#{REPO}/releases/download/#{tag}/#{asset_name}"
            raise "Missing or invalid release asset: #{asset_name}" unless matches.size == 1 && matches[0]['browser_download_url'] == expected
            download(expected, File.join(stage, asset_name), asset_name.end_with?('.sha256') ? 1024 : MAX_ARCHIVE)
          end
          checksum = File.read(File.join(stage, "#{name}.sha256"))
          match = checksum.match(/\A([a-f0-9]{64})  #{Regexp.escape(name)}\n?\z/)
          archive = File.join(stage, name)
          raise 'Release checksum verification failed' unless match && Digest::SHA256.file(archive).hexdigest == match[1]
          payload = File.join(stage, 'payload')
          Dir.mkdir(payload)
          data = unpack(archive, payload)
          raise 'Release identity mismatch' unless data['version'] == latest && data['target'] == installed['target']
          activate(payload)
          puts "Installed Grok Build 2 #{latest}. Restart to use it."
        end
      end
      File.unlink(File.join(@root, '.update-paused')) if !automatic && File.exist?(File.join(@root, '.update-paused'))
    end
    raise 'Another installation is in progress' if !result && !automatic
  end
end

if $PROGRAM_NAME == __FILE__
  begin
    action, root, *args = ARGV
    raise 'Missing installation directory' unless root
    updater = Grok2Release.new(root)
    case action
    when 'install' then updater.install(args.fetch(0), args.fetch(1))
    when 'update' then updater.update(false)
    when 'auto' then updater.update(true)
    when 'rollback' then updater.rollback
    else raise 'Unknown updater command'
    end
  rescue StandardError => error
    warn "grok2 update: #{error.message}"
    exit 1
  end
end
