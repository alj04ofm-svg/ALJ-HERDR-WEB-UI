# ALJ Harbor

**A self-hosted workspace for your code and coding agents.** Run Claude Code, Codex, OpenCode, and other agent CLIs in your own [herdr](https://github.com/herdrdev/herdr) instance. Pick up the same work from a desktop or phone, read an agent's reply in Chat, or switch to its live Terminal.

[Install from source](#install-from-source) · [Setup and safety](docs/guide.md#access-and-safety) · [Request a feature](#request-a-feature)

![Waterfront artwork used in the ALJ Harbor chat backdrop](src/brand/city-harbor.webp)

## Your workspace

- **Chat and Terminal.** Switch views in the same pane, answer supported agent prompts, and open files your agent mentions. Start a new workspace with an agent already installed on your computer.
- **Live tabs and a sidebar you can get out of the way.** Organize tabs into groups, see which agents are running, put your Chat tabs directly in the top bar, and switch from the full sidebar to a slim rail or close it entirely. The rail keeps active tabs, Tasks, and configured usage meters within reach.
- **Projects and tasks.** Plan work in a Trello-style Kanban board or a compact list, add cards directly to a column, and organize them into projects and subprojects. Find due work with filters and archive completed cards. Track progress by project and open Quick Capture from the Chat composer to organize a task with your configured assistant. The Agents view lets you turn live work into a saved task when you choose.
- **A waterfront in Chat.** Set your location for current weather or choose a scene preset. Open the marina controls to start the Harbor Grand Prix with a random or custom fleet, pick a winner, explore waterfront landmarks, or pause the scene. The interface respects reduced-motion preferences.
- **Connect your setup.** Open **Settings → Setup guide** for supported agent install and sign-in instructions. Connect another computer through **Settings → Remote PCs**.

## Install from source

Install [herdr](https://github.com/herdrdev/herdr) (0.9.0 or newer), [Bun](https://bun.sh/), and [Node.js](https://nodejs.org/) (18 or newer for live terminal attachment on Linux and macOS). Install and sign in to any agent CLIs you want to use, such as Codex or Claude Code. Start herdr with `herdr` and leave it running. In a second terminal on that same computer, run:

```sh
git clone https://github.com/alj04ofm-svg/ALJ-HERDR-WEB-UI.git
cd ALJ-HERDR-WEB-UI
bun install --frozen-lockfile
cd integrations/messaging
bun install --frozen-lockfile
cd ../..
bun run build
bun run server
```

Open [http://127.0.0.1:7317](http://127.0.0.1:7317) and choose **New workspace** or pick an existing one. On Windows, herdr currently uses a terminal screen mirror. If port 7317 is already in use, set `PORT` to another free port before starting the server.

This repository contains source code and bundled artwork. Each installation connects to the owner's own herdr session through its local bridge. The server listens on loopback by default, and anonymous install and update telemetry is off by default in this edition. For access from another device, use a private tunnel or configure authentication before exposing the bridge. [Access and safety](docs/guide.md#access-and-safety)

Task data is saved in your connection server’s state directory and shared among the interact devices paired to that instance. Use a separate instance and state directory per owner. If you choose **Organize with Codex**, the draft note is sent to Codex using the host’s existing ChatGPT sign-in. Regular task editing and plain drafts need no AI provider.

## Update

Stop the web server, run `git pull --ff-only` from the checkout, repeat both dependency installs and `bun run build`, then restart with `bun run server`. This keeps your installation on this repository's `main` branch.

## Request a feature

[Open an issue](https://github.com/alj04ofm-svg/ALJ-HERDR-WEB-UI/issues/new) with the workflow you want to make easier. Use sample data in screenshots and logs.

## Credits

ALJ Harbor is based on [herdr web ui by devswha](https://github.com/devswha/herdr-web-ui) and is distributed under the [MIT license](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for dependency licenses.
