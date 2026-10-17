# Using inplace with ChatGPT in the browser

Part of the [inplace README](../README.md). This page covers ChatGPT on the web; for Claude Code, see [Running inplace as an MCP server for Claude Code](../README.md#running-inplace-as-an-mcp-server-for-claude-code).

ChatGPT on the web can't open files on your computer, but it can use inplace's MCP tools through a tunnel. The document stays on your disk and you edit it on the inplace page as usual. ChatGPT reads it with `read_document`, changes it with `replace_element` (one element by its `data-id`) or `find_replace`, sees your edits with `get_edits`, and reads the comments you leave on the page with `get_comments`.

There are two ways to connect:

- **OpenAI's [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).** You create a tunnel in the OpenAI Platform settings and run OpenAI's `tunnel-client` on your computer. It can start inplace itself, so nothing is exposed to the internet:

  ```bash
  tunnel-client init --sample sample_mcp_stdio_local --profile inplace --tunnel-id <your tunnel id> --mcp-command "npx -y github:jonasjancarik/inplace mcp"
  ```

  ```bash
  tunnel-client run --profile inplace
  ```

  This needs an OpenAI Platform organization with tunnel permissions and an API key for `tunnel-client`; the guide linked above covers both.

- **Any other HTTPS tunnel**, such as `cloudflared` or ngrok. Run inplace's HTTP mode with a token you choose, then point the tunnel at it:

  ```bash
  INPLACE_TOKEN=<a long random string> npx -y github:jonasjancarik/inplace mcp --http
  ```

  ```bash
  cloudflared tunnel --url http://127.0.0.1:8766
  ```

  The MCP URL is the tunnel's address followed by `/mcp/<your token>`. It listens on `127.0.0.1:8766` by default (`--port` and `--host` change that) and answers nothing without the token. Anyone who has the full URL can read and change the documents you open, so treat it like a password.

Then, in ChatGPT on the web, go to [Plugins](https://chatgpt.com/plugins), choose **Add custom MCP server**, and either select your tunnel or enter the URL, with **No authentication**. In a conversation, type `@`, pick the plugin, and ask it to open your document, giving the full path. Open the URL it returns in your own browser.

Some things to know before you rely on it:

- Whether you can add custom MCP servers depends on your ChatGPT plan and, in a workspace, on your admin. OpenAI's documentation only says workspace permissions apply. Reports differ on Plus and Pro; Business, Enterprise and Edu workspaces are the most consistently reported to allow it. Check under Settings in your own account.
- ChatGPT can't be woken by inplace. It sees your page edits only when you next send it a message, so tell it to check your edits.
- ChatGPT asks you to confirm each edit unless you tell it to remember your choice for the conversation.
- A server reached through a tunnel can only be your own, private plugin. Listing inplace in ChatGPT's plugin directory would need a public HTTPS service.
