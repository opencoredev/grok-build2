use std::sync::Arc;

use tracing_subscriber::registry::LookupSpan;

mod redact;

pub use xai_grok_otel::config::{OtelClientInfo, OtelExporterConfig, OtelLayerConfig};

pub fn build_otel_layer<S>(
    client: OtelClientInfo,
    mut config: OtelLayerConfig,
) -> impl tracing_subscriber::layer::Layer<S>
where
    S: tracing::Subscriber + for<'span> LookupSpan<'span>,
{
    config.exporter.enabled = network_export_enabled(config.exporter.enabled);
    let mode = match crate::instrumentation::current_mode() {
        crate::instrumentation::InstrumentationMode::Server => {
            xai_grok_otel::provider::OtelProviderMode::Server
        }
        _ => xai_grok_otel::provider::OtelProviderMode::Local,
    };
    xai_grok_otel::provider::build_otel_layer(
        client,
        config,
        mode,
        Arc::new(crate::client::is_session_metrics_enabled),
        Arc::new(redact::redact_batch),
    )
}

fn network_export_enabled(requested: bool) -> bool {
    requested && !crate::NETWORK_TELEMETRY_DISABLED
}

pub fn shutdown_otel() {
    let provider = std::thread::spawn(xai_grok_otel::provider::shutdown_provider);
    crate::external::shutdown();
    let _ = provider.join();
}

pub struct OtelGuard;

impl Drop for OtelGuard {
    fn drop(&mut self) {
        shutdown_otel();
    }
}

pub fn otel_guard() -> OtelGuard {
    OtelGuard
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fork_policy_rejects_direct_otel_enablement() {
        assert!(!network_export_enabled(true));
        assert!(!network_export_enabled(false));
    }
}
