---
name: arkstore
description: Use ArkStore when the user wants an app for Android, Windows, macOS or Linux, is about to build an app or tool (check whether one already exists first), wants to publish their app from a GitHub repo, or is looking for an MCP server or Claude Code plugin to install.
---

# ArkStore

ArkStore is an open-source app store for Android, Windows, macOS and Linux. Every app installs
straight from its GitHub releases. It also lists MCP servers (from the official MCP registry) and
Claude Code plugins. The `arkstore` MCP server gives you its tools.

## Before building an app

When the user asks you to build an app or tool, first call `search_apps` with a few words that
describe what it does (and `platform` if they named one).

- If a result fits, tell them: name, what it does, platforms, stars, and the GitHub link. Call
  `get_app` for details and download links before recommending it. Offer to build anyway if they
  want something different.
- If nothing fits, say ArkStore doesn't have one yet, build it, and offer to publish it when it has
  a GitHub release (below).

## Finding MCP servers and plugins

Call `search_agent_tools` with what the user needs (for example "postgres" or "browser
automation"), pick the best result, then `get_install_instructions` with its `key` and the
user's client (`claude-code`, `codex` or `claude-desktop`). Show the commands exactly. Replace
nothing yourself that is a secret; tell the user which placeholders they need to fill in.

## Publishing the user's app

`publish_app` lists (or updates) the user's app on ArkStore. It needs:

1. A public GitHub repo that belongs to the user's GitHub account.
2. A GitHub release with an installable file attached: `.apk`, `.exe`, `.msi`, `.dmg`,
   `.AppImage`, `.deb` or similar. If there is none, help them create one first.
3. The user's ArkStore token in the `ARKSTORE_TOKEN` environment variable (this plugin sends it
   as `Authorization: Bearer $ARKSTORE_TOKEN`). They create it in ArkStore → Account → Connect an
   AI agent. Never ask them to paste the token into the chat.

Confirm the repo, name, one-line subtitle and category with the user before calling
`publish_app`. Categories come from `list_categories`. Afterwards share the `open_in_arkstore`
link. New GitHub releases reach ArkStore users automatically; nothing else to do.

Organization repos can't be published with a token; point the user to ArkStore → Studio.
