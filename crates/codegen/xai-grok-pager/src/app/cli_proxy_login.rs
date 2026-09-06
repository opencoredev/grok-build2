use std::ffi::OsString;
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CliProxyProvider {
    OpenAi,
    Claude,
    Devin,
    Cursor,
    Xai,
}

impl CliProxyProvider {
    pub const ALL: [Self; 5] = [
        Self::OpenAi,
        Self::Claude,
        Self::Devin,
        Self::Cursor,
        Self::Xai,
    ];

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "openai" | "codex" => Some(Self::OpenAi),
            "claude" | "anthropic" => Some(Self::Claude),
            "devin" => Some(Self::Devin),
            "cursor" => Some(Self::Cursor),
            "xai" | "grok" => Some(Self::Xai),
            _ => None,
        }
    }

    pub const fn token(self) -> &'static str {
        match self {
            Self::OpenAi => "openai",
            Self::Claude => "claude",
            Self::Devin => "devin",
            Self::Cursor => "cursor",
            Self::Xai => "grok",
        }
    }

    pub const fn label(self) -> &'static str {
        match self {
            Self::OpenAi => "OpenAI / Codex",
            Self::Claude => "Claude",
            Self::Devin => "Devin",
            Self::Cursor => "Cursor",
            Self::Xai => "Grok / xAI",
        }
    }

    const fn flag(self) -> &'static str {
        match self {
            Self::OpenAi => "-codex-login",
            Self::Claude => "-claude-login",
            Self::Devin => "-devin-login",
            Self::Cursor => "-cursor-login",
            Self::Xai => "-xai-login",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PendingCliProxyLogin {
    pub provider: CliProxyProvider,
}

pub fn command_spec(provider: CliProxyProvider) -> Result<(PathBuf, Vec<OsString>), String> {
    let home = std::env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set".to_string())?;
    let bin = std::env::var_os("CLI_PROXY_BIN")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".cli-proxy-api/bin/cli-proxy-api"));
    let config = std::env::var_os("CLI_PROXY_CONFIG")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".cli-proxy-api/config.yaml"));
    Ok((
        bin,
        vec![
            OsString::from("--config"),
            config.into_os_string(),
            OsString::from(provider.flag()),
        ],
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_aliases_are_case_insensitive() {
        assert_eq!(
            CliProxyProvider::parse("OpenAI"),
            Some(CliProxyProvider::OpenAi)
        );
        assert_eq!(
            CliProxyProvider::parse("codex"),
            Some(CliProxyProvider::OpenAi)
        );
        assert_eq!(
            CliProxyProvider::parse("Anthropic"),
            Some(CliProxyProvider::Claude)
        );
        assert_eq!(CliProxyProvider::parse("GROK"), Some(CliProxyProvider::Xai));
        assert_eq!(CliProxyProvider::parse("unknown"), None);
    }

    #[test]
    fn provider_flags_are_fixed() {
        assert_eq!(CliProxyProvider::OpenAi.flag(), "-codex-login");
        assert_eq!(CliProxyProvider::Claude.flag(), "-claude-login");
        assert_eq!(CliProxyProvider::Devin.flag(), "-devin-login");
        assert_eq!(CliProxyProvider::Cursor.flag(), "-cursor-login");
        assert_eq!(CliProxyProvider::Xai.flag(), "-xai-login");
    }
}
