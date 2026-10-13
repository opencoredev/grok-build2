//! Codex MCP servers from `~/.codex/config.toml`.
//!
//! The loader never imports or copies the complete file. It keeps credentials
//! in their original location and translates Codex's `http_headers` spelling
//! to Grok's `headers` spelling in memory.

use std::path::{Path, PathBuf};

use agent_client_protocol as acp;
use indexmap::IndexMap;

use crate::McpServerConfig;
use crate::compat::CompatConfig;
use crate::mcp_servers::McpServerSource;
use crate::mcp_servers::config_toml::parse_mcp_servers_from_toml;
use crate::mcp_servers::server_list::{DefinitionResolver, McpServerResolution};

fn codex_config_path(home: &Path) -> PathBuf {
    home.join(".codex").join("config.toml")
}

/// Load the supported `[mcp_servers.*]` records from Codex user config.
pub fn load_codex_mcp_servers_as_configs(
    compat: &CompatConfig,
) -> IndexMap<String, McpServerConfig> {
    if !compat.codex.mcps {
        return IndexMap::new();
    }
    let Some(home) = xai_dirs::home_dir() else {
        return IndexMap::new();
    };
    load_codex_mcp_servers_from(&codex_config_path(&home))
}

pub(crate) fn load_codex_mcp_servers_from(path: &Path) -> IndexMap<String, McpServerConfig> {
    let Ok(content) = std::fs::read_to_string(path) else {
        return IndexMap::new();
    };
    let Ok(mut root) = toml::from_str::<toml::Value>(&content) else {
        tracing::warn!(path = %path.display(), "failed to parse Codex MCP config");
        return IndexMap::new();
    };
    if let Some(entries) = root
        .get_mut("mcp_servers")
        .and_then(toml::Value::as_table_mut)
    {
        for (_, value) in entries.iter_mut() {
            let Some(table) = value.as_table_mut() else {
                continue;
            };
            if !table.contains_key("headers")
                && let Some(headers) = table.remove("http_headers")
            {
                table.insert("headers".to_owned(), headers);
            }
        }
    }
    // Load only `[mcp_servers]`; never merge the rest of Codex configuration.
    let mut servers_only = toml::map::Map::new();
    if let Some(servers) = root.get("mcp_servers") {
        servers_only.insert("mcp_servers".to_owned(), servers.clone());
    }
    parse_mcp_servers_from_toml(&toml::Value::Table(servers_only))
}

pub(crate) fn codex_resolutions(
    compat: &CompatConfig,
    resolver: &DefinitionResolver<'_>,
    home: Option<&Path>,
) -> Vec<McpServerResolution> {
    if !compat.codex.mcps {
        return Vec::new();
    }
    let Some(home) = home else {
        return Vec::new();
    };
    let path = codex_config_path(home);
    let source = McpServerSource::CodexUser { path: path.clone() };
    load_codex_mcp_servers_from(&path)
        .iter()
        .map(|(name, config)| resolver.resolve(name, config, source.clone()))
        .collect()
}

/// Codex servers as ACP servers, used to attribute client-forwarded servers.
pub(crate) fn load_codex_mcp_servers(
    compat: &CompatConfig,
    home: Option<&Path>,
    preferences: &crate::McpPreferencesFile,
) -> Vec<acp::McpServer> {
    let mut seen_names = std::collections::HashSet::new();
    codex_resolutions(
        compat,
        &DefinitionResolver::expanding_env(preferences),
        home,
    )
    .into_iter()
    .filter_map(McpServerResolution::into_server)
    .filter(|server| seen_names.insert(server.name.clone()))
    .map(acp::McpServer::from)
    .collect()
}

#[cfg(test)]
#[path = "codex_config_tests.rs"]
mod tests;
