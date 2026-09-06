use crate::app::actions::Action;
use crate::app::cli_proxy_login::CliProxyProvider;
use crate::slash::command::{
    AppCtx, ArgItem, CommandExecCtx, CommandResult, SlashCommand, slash_meta,
};

pub struct LoginCommand;

impl SlashCommand for LoginCommand {
    slash_meta! {
        name: "login",
        description: "Log in to a model provider",
        usage: "/login <provider>",
        takes_args: true,
        args_required: true,
        arg_placeholder: "<provider>",
    }

    fn suggest_args(&self, _ctx: &AppCtx, _args_query: &str) -> Option<Vec<ArgItem>> {
        Some(
            CliProxyProvider::ALL
                .into_iter()
                .map(|provider| ArgItem {
                    display: provider.label().to_string(),
                    match_text: format!("{} {}", provider.label(), provider.token()),
                    insert_text: provider.token().to_string(),
                    description: "Subscription login".to_string(),
                })
                .collect(),
        )
    }

    fn run(&self, _ctx: &mut CommandExecCtx, args: &str) -> CommandResult {
        match CliProxyProvider::parse(args) {
            Some(provider) => CommandResult::Action(Action::CliProxyLogin(provider)),
            None => CommandResult::Error(
                "Choose OpenAI, Claude, Devin, Cursor, or Grok from /login.".to_string(),
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app_ctx(models: &crate::acp::model_state::ModelState) -> AppCtx<'_> {
        AppCtx {
            models,
            cwd: std::path::Path::new("."),
            has_session_announcements: false,
            billing_surface_visible: true,
            usage_command_visible: true,
            workflows_available: true,
            saved_workflows: &[],
            workflow_runs: &[],
            screen_mode: crate::app::ScreenMode::Fullscreen,
            current_title: None,
        }
    }

    #[test]
    fn suggests_all_subscription_providers() {
        let models = crate::acp::model_state::ModelState::default();
        let items = LoginCommand
            .suggest_args(&app_ctx(&models), "")
            .expect("provider suggestions");
        assert_eq!(items.len(), 5);
        assert_eq!(
            items
                .iter()
                .map(|item| item.insert_text.as_str())
                .collect::<Vec<_>>(),
            ["openai", "claude", "devin", "cursor", "grok"]
        );
    }
}
