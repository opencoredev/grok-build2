use crate::app::actions::Action;
use crate::slash::command::{CommandExecCtx, CommandResult, SlashCommand, slash_meta};

pub struct ReauthCommand;

impl SlashCommand for ReauthCommand {
    slash_meta! {
        name: "reauth",
        description: "Re-authenticate the current Grok session",
        usage: "/reauth",
    }

    fn run(&self, _ctx: &mut CommandExecCtx, _args: &str) -> CommandResult {
        CommandResult::Action(Action::Login)
    }
}
