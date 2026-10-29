# Oganesson AI

A local character-chat app. You create characters, write opening messages, and chat with them through a language
model that runs on your own computer. Everything stays on your machine.

## Privacy

Oganesson AI is built around privacy. **We do not collect any data.** There are no accounts, no analytics, no
telemetry, no crash reports and no advertising.

- Your characters, chats, settings and profile are stored only on your computer.
- The app runs a small server that listens only on your own machine. Nothing on your network can reach it.
- The only network traffic is between the app and the model server you configure. By default that server runs on
  your computer, so nothing leaves it. If you point the app at a cloud service, your messages go to that service,
  under its own privacy policy.
- Avatars are generated locally. The Discord button opens a link in your browser only when you click it.

## Download

Ready-to-run apps are on the [Releases](../../releases) page. Java does not need to be installed.

- **Windows:** unzip `OganessonAI-windows-x64.zip` and run `OganessonAI.exe`. SmartScreen may warn about an unknown
  publisher. Click *More info*, then *Run anyway*.
- **macOS:** unzip the file for your Mac (`macos-arm64` for Apple Silicon, `macos-x64` for Intel) and drag
  `OganessonAI.app` to Applications. The first time, right-click it and choose *Open*. If macOS still refuses, run
  `xattr -dr com.apple.quarantine /Applications/OganessonAI.app` in Terminal once.
- **Linux:** extract `OganessonAI-linux-x64.tar.gz` and run `OganessonAI/bin/OganessonAI`.

The app opens in your browser. To stop it, use **Settings → Quit Oganesson AI**.

## Run from source

You need Java 17 or newer.

```
javac -d bin $(find src -name '*.java')
java -cp bin com.oganesson.ai.Main
```

On Windows PowerShell, compile with:

```
javac -d bin (Get-ChildItem -Recurse src -Filter *.java).FullName
```

The app opens at http://localhost:6677. Add `--no-browser` to skip opening the browser.

## Connect a model

Open **Settings** and set the endpoint. The default is `http://localhost:1234/v1/chat/completions`, which matches
LM Studio.

- **LM Studio:** keep the default endpoint and load a model in LM Studio. The app uses whichever model is loaded.
- **Ollama:** use `http://localhost:11434/v1/chat/completions` and fill in **Model Name** with the model you have
  pulled.
- **Other servers** (llama.cpp and similar): use their OpenAI-compatible chat endpoint.

The **Thinking** switch asks reasoning models to think before they answer. Servers that do not support it ignore it.

## Characters

- **Description:** your private notes about the character. It is never sent to the model.
- **Personality** and **Scenario:** sent to the model to shape how the character behaves.
- **Opening greetings:** add as many as you like with the **+** tab. When you start a chat, you read them, pick one,
  and confirm it.
- **Import** accepts the JSON and PNG character cards used by most character-chat tools (Character Card V2 and V3,
  TavernAI). **Export** writes a standard V2 card.
- `{{char}}` and `{{user}}` are replaced with the character's name and your persona's name.

## Chats

- **Regenerate** creates a new reply and keeps the earlier ones. Use the arrows under a reply to switch between
  versions. The version you are on is the one the model sees in later messages.
- **Editing** a message lets you rewrite it. The edit is saved to that message.
- **Deleting** a message also deletes every message below it, after a confirmation.
- You can keep several chat sessions per character from the **Sessions** button.

## Your data

Packaged apps store everything in your user profile:

- Windows: `%APPDATA%\OganessonAI`
- macOS: `~/Library/Application Support/OganessonAI`
- Linux: `~/.local/share/oganesson-ai`

When you run from source, the data is stored in `oganesson_data.json` in the project folder. The app also keeps a
rolling backup in `oganesson_data.json.bak`.

To make a copy of everything (characters, chats, settings and profile), use **Settings → Download backup**.

## Works offline

Styling is included with the app, so the interface works without an internet connection.

## Community

Questions, feedback and discussion: https://discord.gg/jWXrdBtvZT

## License

Oganesson AI is released under the MIT License. See [LICENSE](LICENSE). Third-party code included in the project,
and its license notices, are listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
