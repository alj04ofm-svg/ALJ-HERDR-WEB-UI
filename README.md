# ALJ HERDR WEB UI

A self-hosted browser and phone interface for [herdr](https://github.com/herdrdev/herdr). Open your own agent conversations and terminals, organize tabs into groups, and check subscription usage from the same workspace.

![The waterfront skyline used in the animated chat backdrop](src/brand/city-harbor.webp)

- Switch between agent chat and the live terminal. Start a workspace with **New workspace** and choose an agent installed on your computer.
- Expand the sidebar to see groups, workspaces, tab actions, and usage over frosted waterfront glass in Chat. Minimize it to a thin rail with agent icons and short tab labels, and move between them with the arrow keys.
- In Chat, open **City playground** to explore the waterfront, race and drag the boats, or find the bunny. **Marina weather** switches between clear skies, coastal fog, rain showers, and an automatic weather cycle. **Pause marina** freezes the scene. The app also respects your system’s reduced-motion setting.
- Open **Settings → Remote PCs** to connect another computer over SSH.

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

## Update

Stop the web server, run `git pull --ff-only` from the checkout, repeat both dependency installs and `bun run build`, then restart with `bun run server`. This keeps your installation on this repository's `main` branch.

## Credits

ALJ HERDR WEB UI is based on [herdr web ui by devswha](https://github.com/devswha/herdr-web-ui) and is distributed under the [MIT license](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for dependency licenses.
