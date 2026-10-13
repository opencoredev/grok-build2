use super::*;
use crate::McpServerTransportConfig;

#[test]
fn codex_mcp_loader_reads_only_servers_and_translates_http_headers() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("config.toml");
    std::fs::write(
        &path,
        r#"
model = "must-not-import"

[model_providers.private]
api_key = "must-not-import"

[mcp_servers.remote]
url = "https://example.com/mcp"
http_headers = { Authorization = "Bearer test" }

[mcp_servers.local]
command = "server-bin"
args = ["--stdio"]
"#,
    )
    .unwrap();

    let servers = load_codex_mcp_servers_from(&path);
    assert_eq!(servers.len(), 2);
    let remote = servers.get("remote").unwrap();
    match &remote.transport {
        McpServerTransportConfig::StreamableHttp { headers, .. } => {
            assert_eq!(
                headers
                    .as_ref()
                    .and_then(|headers| headers.get("Authorization"))
                    .map(String::as_str),
                Some("Bearer test")
            );
        }
        other => panic!("expected HTTP server, got {other:?}"),
    }
    assert!(servers.contains_key("local"));
}

#[test]
fn codex_mcp_runtime_options_survive_config_lookup() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("config.toml");
    std::fs::write(
        &path,
        r#"
[mcp_servers.codex]
command = "server-bin"
startup_timeout_sec = 12
tool_timeout_sec = 34
expose_image_base64 = true
"#,
    )
    .unwrap();
    let codex = load_codex_mcp_servers_from(&path);
    let config = codex.get("codex").unwrap();
    assert_eq!(config.startup_timeout_sec, Some(12));
    assert_eq!(config.tool_timeout_sec, Some(34));
    assert_eq!(config.expose_image_base64, Some(true));
}

#[test]
fn codex_resolutions_respect_the_mcps_cell() {
    let home = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(home.path().join(".codex")).unwrap();
    std::fs::write(
        home.path().join(".codex/config.toml"),
        "[mcp_servers.local]\ncommand = \"server-bin\"\n",
    )
    .unwrap();
    let preferences = crate::McpPreferencesFile::default();

    let mut compat = CompatConfig::default();
    let servers = load_codex_mcp_servers(&compat, Some(home.path()), &preferences);
    assert_eq!(servers.len(), 1);

    compat.codex.mcps = false;
    assert!(load_codex_mcp_servers(&compat, Some(home.path()), &preferences).is_empty());
}

#[test]
fn client_codex_server_dropped_when_codex_mcps_disabled() {
    let home = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(home.path().join(".codex")).unwrap();
    std::fs::write(
        home.path().join(".codex/config.toml"),
        "[mcp_servers.codex-killswitch]\ncommand = \"true\"\n",
    )
    .unwrap();
    let mut compat = CompatConfig::default();
    compat.codex.mcps = false;
    let client = acp::McpServer::Stdio(acp::McpServerStdio::new("codex-killswitch", "true"));
    let merged = crate::mcp_servers::admit_client_mcp_servers_at(
        vec![client],
        home.path(),
        &compat,
        Some(home.path()),
        &crate::McpPreferencesFile::default(),
    );
    assert!(
        merged.is_empty(),
        "client-forwarded Codex server must be dropped when codex.mcps is off"
    );
}
