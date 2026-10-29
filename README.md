# Oganesson AI

A local character-chat app. A tiny Java server (no dependencies) serves the web UI and stores your data;
the chat itself goes to a model server running on your machine (LM Studio, Ollama, llama.cpp, ...).

# Oganesson AI

A local character-chat app. A tiny Java server (no dependencies) serves the web UI and stores your data;
the chat itself goes to a model server running on your machine (LM Studio, Ollama, llama.cpp, ...).

## Download the app (no Java needed)

Each release on the GitHub Releases page has a ready-to-run app for:

- **Windows:** unzip `OganessonAI-windows-x64.zip` and run `OganessonAI.exe`. SmartScreen may warn about an
  unknown publisher: click *More info*, then *Run anyway*.
- **macOS:** unzip the file for your Mac (`macos-arm64` for Apple Silicon, `macos-x64` for Intel) and drag
  `OganessonAI.app` to Applications. The first time, right-click it and choose *Open*. If macOS still refuses, run
  `xattr -dr com.apple.quarantine /Applications/OganessonAI.app` once in Terminal.
- **Linux:** extract `OganessonAI-linux-x64.tar.gz` and run `OganessonAI/bin/OganessonAI`.

The app opens in your browser as usual. Packaged apps keep your data in your user profile instead of the project
folder: `%APPDATA%\OganessonAI` on Windows, `~/Library/Application Support/OganessonAI` on macOS and
`~/.local/share/oganesson-ai` on Linux. To stop a packaged app, use **Settings → Quit Oganesson AI**.

## Publish a release (maintainers)

Pushing a version tag builds the apps on Windows, Linux and both kinds of Mac, then creates the release:

```
git tag v1.0.0
git push origin v1.0.0
```

The build runs in the **Actions** tab. When it finishes, the **Releases** page shows the downloads. Use a new
version number for each release (`v1.0.1`, `v1.1.0`, ...). To test a build without publishing, run the "Build apps"
workflow by hand from the Actions tab.

## Run from source

### Run

Needs Java 17 or newer.

```
javac -d bin $(find src -name '*.java')      # Windows PowerShell: javac -d bin (Get-ChildItem -Recurse src -Filter *.java).FullName
java -cp bin com.oganesson.ai.Main
```

Or just press Run in VS Code. The browser opens on http://localhost:6677 (add `--no-browser` to skip that).
The server only listens on your own machine.

## Your logo

Put a PNG named `logo.png` in `src/main/resources/static/img/`. It replaces the "O" tile in the top-left
corner and becomes the icon in the browser tab. A square image (256 x 256 or 512 x 512) works best; transparent
backgrounds are fine. After adding or changing it, refresh with Ctrl+F5 so the tab icon updates.
Without a `logo.png` the "O" tile is shown.

## Your data

Everything (characters, chats, settings, profile) lives in `oganesson_data.json` next to `src/`.
A rolling backup is kept in `oganesson_data.json.bak`. The file contains your profile, so keep it out of
git and out of anything you share (the `.gitignore` already does that).

## Model server

Open Settings in the app and set the endpoint (default `http://localhost:1234/v1/chat/completions`).
LM Studio uses whichever model is loaded. Ollama and some other servers need a model name: fill in
"Model Name" (for Ollama the endpoint is `http://localhost:11434/v1/chat/completions`).

## Working fully offline

Styling uses Tailwind. The app uses the copy in `src/main/resources/static/js/vendor/tailwind.js` when it
exists, and falls back to the internet otherwise.

## Characters

- **Description**: your private notes about the character. It is never sent to the model.
- **Personality** and **Scenario**: sent to the model.
- **Opening greetings**: add as many as you like with the "+" tab. You pick one when a chat starts.
- Import accepts the JSON and PNG character cards used by most character-chat tools (Character Card V2/V3,
  TavernAI). Export writes a standard V2 card. `{{char}}` and `{{user}}` are filled in with the names.

## Chats

- **Regenerate** keeps the earlier replies: use the < 1/3 > arrows under a reply to go back to a previous version.
  The version you are on is the one the model sees in later messages.
- **Deleting a message** also deletes every message below it, after a confirmation.
- Settings has a **Download backup** button (all characters, chats and settings in one file) and a response-length choice.

Needs Java 17 or newer.

```
javac -d bin $(find src -name '*.java')      # Windows PowerShell: javac -d bin (Get-ChildItem -Recurse src -Filter *.java).FullName
java -cp bin com.oganesson.ai.Main
```

Or just press Run in VS Code. The browser opens on http://localhost:6677 (add `--no-browser` to skip that).
The server only listens on your own machine.

## Your logo

Put a PNG named `logo.png` in `src/main/resources/static/img/`. It replaces the "O" tile in the top-left
corner and becomes the icon in the browser tab. A square image (256 x 256 or 512 x 512) works best; transparent
backgrounds are fine. After adding or changing it, refresh with Ctrl+F5 so the tab icon updates.
Without a `logo.png` the "O" tile is shown.

## Your data

Everything (characters, chats, settings, profile) lives in `oganesson_data.json` next to `src/`.
A rolling backup is kept in `oganesson_data.json.bak`. The file contains your profile, so keep it out of
git and out of anything you share (the `.gitignore` already does that).

## Model server

Open Settings in the app and set the endpoint (default `http://localhost:1234/v1/chat/completions`).
LM Studio uses whichever model is loaded. Ollama and some other servers need a model name: fill in
"Model Name" (for Ollama the endpoint is `http://localhost:11434/v1/chat/completions`).

## Working fully offline

Styling uses Tailwind. The app uses the copy in `src/main/resources/static/js/vendor/tailwind.js` when it
exists, and falls back to the internet otherwise.

## Characters

- **Description**: your private notes about the character. It is never sent to the model.
- **Personality** and **Scenario**: sent to the model.
- **Opening greetings**: add as many as you like with the "+" tab. You pick one when a chat starts.
- Import accepts the JSON and PNG character cards used by most character-chat tools (Character Card V2/V3,
  TavernAI). Export writes a standard V2 card. `{{char}}` and `{{user}}` are filled in with the names.

## Chats

- **Regenerate** keeps the earlier replies: use the < 1/3 > arrows under a reply to go back to a previous version.
  The version you are on is the one the model sees in later messages.
- **Deleting a message** also deletes every message below it, after a confirmation.
- Settings has a **Download backup** button (all characters, chats and settings in one file) and a response-length choice.

## License

Oganesson AI is released under the MIT License (see `LICENSE`). Third-party code included in the project, and
its license notices, are listed in `THIRD_PARTY_LICENSES.md`.
