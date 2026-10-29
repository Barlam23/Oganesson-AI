package com.oganesson.ai.handler;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;

/**
 * Stores the whole app state (characters, chats, settings, profile) as one JSON document.
 * Writes are validated, atomic, and backed up so a bad request or a crash can't destroy your data.
 */
public class DataHandler implements HttpHandler {

    private static final long MAX_BODY_BYTES = 64L * 1024 * 1024;
    private static final long BACKUP_INTERVAL_MS = 10L * 60 * 1000;

    private static final String DEFAULT_JSON = """
            {
                "bots": [],
                "settings": { "lmStudioUrl": "http://localhost:1234/v1/chat/completions" },
                "userProfile": { "name": "User", "desc": "", "gender": "", "pronouns": "", "avatar": "" }
            }
            """;

    private final Path dataFile;
    private final Path tempFile;
    private final Path backupFile;
    private final Path backupTempFile;
    private final Object fileLock = new Object();

    public DataHandler(Path dataFile) {
        this.dataFile = dataFile.toAbsolutePath();
        this.tempFile = this.dataFile.resolveSibling(this.dataFile.getFileName() + ".tmp");
        this.backupFile = this.dataFile.resolveSibling(this.dataFile.getFileName() + ".bak");
        this.backupTempFile = this.dataFile.resolveSibling(this.dataFile.getFileName() + ".bak.tmp");
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        try {
            String method = exchange.getRequestMethod();
            if ("GET".equalsIgnoreCase(method)) {
                handleGet(exchange);
            } else if ("POST".equalsIgnoreCase(method)) {
                handlePost(exchange);
            } else {
                exchange.getResponseHeaders().set("Allow", "GET, POST");
                sendError(exchange, 405, "Method not allowed");
            }
        } catch (IOException | RuntimeException e) {
            try {
                sendError(exchange, 500, "Internal error while handling data");
            } catch (IOException | RuntimeException ignored) {
                // Response was already started; nothing more we can do.
            }
        } finally {
            exchange.close();
        }
    }

    private void handleGet(HttpExchange exchange) throws IOException {
        byte[] body;
        synchronized (fileLock) {
            if (Files.isRegularFile(dataFile)) {
                body = Files.readAllBytes(dataFile);
                if (validate(body) != null) {
                    // The main file is damaged. Serve the last good backup if there is one; otherwise report the
                    // problem (and leave the damaged file untouched) instead of pretending there is no data.
                    byte[] backup = Files.isRegularFile(backupFile) ? Files.readAllBytes(backupFile) : null;
                    if (backup != null && validate(backup) == null) {
                        body = backup;
                    } else {
                        sendError(exchange, 500, "Saved data file is damaged and no valid backup exists");
                        return;
                    }
                }
            } else {
                body = DEFAULT_JSON.getBytes(StandardCharsets.UTF_8);
            }
        }
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        send(exchange, 200, "application/json; charset=UTF-8", body);
    }

    private void handlePost(HttpExchange exchange) throws IOException {
        byte[] body;
        try (InputStream is = exchange.getRequestBody()) {
            body = is.readNBytes((int) MAX_BODY_BYTES + 1);
        }
        if (body.length > MAX_BODY_BYTES) {
            sendError(exchange, 413, "Data is too large");
            return;
        }

        String problem = validate(body);
        if (problem != null) {
            sendError(exchange, 400, problem);
            return;
        }

        synchronized (fileLock) {
            backupIfDue();
            writeAtomically(dataFile, tempFile, body);
        }
        send(exchange, 200, "application/json; charset=UTF-8", "{\"status\":\"success\"}".getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Writes to a temp file, flushes it to disk, then swaps it in so the target is never half-written.
     * Used for both the data file and the backup, so a crash mid-save can't leave either one truncated.
     */
    private static void writeAtomically(Path target, Path temp, byte[] body) throws IOException {
        try (FileChannel channel = FileChannel.open(temp,
                StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE)) {
            ByteBuffer buffer = ByteBuffer.wrap(body);
            while (buffer.hasRemaining()) {
                channel.write(buffer);
            }
            channel.force(true);
        }
        try {
            Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    /** Keeps a rolling backup of the previous valid state, refreshed at most every few minutes. */
    private void backupIfDue() {
        try {
            if (!Files.isRegularFile(dataFile)) return;
            boolean due = !Files.isRegularFile(backupFile)
                    || System.currentTimeMillis() - Files.getLastModifiedTime(backupFile).toMillis() > BACKUP_INTERVAL_MS;
            if (!due) return;
            byte[] current = Files.readAllBytes(dataFile);
            if (validate(current) == null) {
                writeAtomically(backupFile, backupTempFile, current);
            }
        } catch (IOException ignored) {
            // A failed backup must never block saving.
        }
    }

    private void send(HttpExchange exchange, int status, String contentType, byte[] body) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", contentType);
        exchange.sendResponseHeaders(status, body.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(body);
        }
    }

    private void sendError(HttpExchange exchange, int status, String message) throws IOException {
        String json = "{\"status\":\"error\",\"message\":\"" + message.replace("\\", "\\\\").replace("\"", "\\\"") + "\"}";
        send(exchange, status, "application/json; charset=UTF-8", json.getBytes(StandardCharsets.UTF_8));
    }

    /** Returns null when the bytes are a well-formed app document, otherwise a short reason. */
    static String validate(byte[] bytes) {
        String text;
        try {
            text = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException e) {
            return "Body is not valid UTF-8";
        }
        return new JsonSyntax(text).checkAppDocument();
    }

    /** Minimal strict JSON parser (the JDK has none built in). It only checks syntax and the root shape. */
    private static final class JsonSyntax {
        private static final int MAX_DEPTH = 100;
        private final String s;
        private int i;
        private boolean rootHasBotsArray;

        JsonSyntax(String s) {
            this.s = s;
        }

        String checkAppDocument() {
            try {
                skipWhitespace();
                if (peek() != '{') return "Top-level JSON value must be an object";
                parseValue(0);
                skipWhitespace();
                if (i != s.length()) return "Unexpected content after the JSON document";
                if (!rootHasBotsArray) return "Document must contain a \"bots\" array";
                return null;
            } catch (IllegalArgumentException e) {
                return "Invalid JSON: " + e.getMessage();
            }
        }

        private char peek() {
            return i < s.length() ? s.charAt(i) : '\0';
        }

        private void skipWhitespace() {
            while (i < s.length()) {
                char c = s.charAt(i);
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') i++;
                else break;
            }
        }

        private void expect(char c) {
            if (peek() != c || i >= s.length()) throw new IllegalArgumentException("expected '" + c + "' at position " + i);
            i++;
        }

        private void parseValue(int depth) {
            if (depth > MAX_DEPTH) throw new IllegalArgumentException("nested too deeply");
            skipWhitespace();
            if (i >= s.length()) throw new IllegalArgumentException("unexpected end of input");
            char c = s.charAt(i);
            switch (c) {
                case '{' -> parseObject(depth);
                case '[' -> parseArray(depth);
                case '"' -> parseString();
                case 't' -> parseLiteral("true");
                case 'f' -> parseLiteral("false");
                case 'n' -> parseLiteral("null");
                default -> {
                    if (c == '-' || (c >= '0' && c <= '9')) parseNumber();
                    else throw new IllegalArgumentException("unexpected character at position " + i);
                }
            }
        }

        private void parseObject(int depth) {
            expect('{');
            skipWhitespace();
            if (peek() == '}') {
                i++;
                return;
            }
            while (true) {
                skipWhitespace();
                if (peek() != '"') throw new IllegalArgumentException("expected a string key at position " + i);
                String key = parseString();
                skipWhitespace();
                expect(':');
                skipWhitespace();
                if (depth == 0 && "bots".equals(key) && peek() == '[') rootHasBotsArray = true;
                parseValue(depth + 1);
                skipWhitespace();
                if (peek() == ',') {
                    i++;
                    continue;
                }
                expect('}');
                return;
            }
        }

        private void parseArray(int depth) {
            expect('[');
            skipWhitespace();
            if (peek() == ']') {
                i++;
                return;
            }
            while (true) {
                parseValue(depth + 1);
                skipWhitespace();
                if (peek() == ',') {
                    i++;
                    continue;
                }
                expect(']');
                return;
            }
        }

        private String parseString() {
            expect('"');
            StringBuilder sb = new StringBuilder();
            while (true) {
                if (i >= s.length()) throw new IllegalArgumentException("unterminated string");
                char c = s.charAt(i++);
                if (c == '"') return sb.toString();
                if (c < 0x20) throw new IllegalArgumentException("control character in string at position " + (i - 1));
                if (c != '\\') {
                    sb.append(c);
                    continue;
                }
                if (i >= s.length()) throw new IllegalArgumentException("unterminated escape");
                char e = s.charAt(i++);
                switch (e) {
                    case '"', '\\', '/' -> sb.append(e);
                    case 'b' -> sb.append('\b');
                    case 'f' -> sb.append('\f');
                    case 'n' -> sb.append('\n');
                    case 'r' -> sb.append('\r');
                    case 't' -> sb.append('\t');
                    case 'u' -> {
                        if (i + 4 > s.length()) throw new IllegalArgumentException("bad unicode escape");
                        for (int k = 0; k < 4; k++) {
                            if (Character.digit(s.charAt(i + k), 16) < 0) throw new IllegalArgumentException("bad unicode escape");
                        }
                        sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                        i += 4;
                    }
                    default -> throw new IllegalArgumentException("bad escape at position " + (i - 1));
                }
            }
        }

        private void parseLiteral(String literal) {
            if (!s.startsWith(literal, i)) throw new IllegalArgumentException("unexpected token at position " + i);
            i += literal.length();
        }

        private void parseNumber() {
            if (peek() == '-') i++;
            if (peek() == '0') {
                i++;
            } else if (peek() >= '1' && peek() <= '9') {
                while (peek() >= '0' && peek() <= '9') i++;
            } else {
                throw new IllegalArgumentException("bad number at position " + i);
            }
            if (peek() == '.') {
                i++;
                if (!(peek() >= '0' && peek() <= '9')) throw new IllegalArgumentException("bad number at position " + i);
                while (peek() >= '0' && peek() <= '9') i++;
            }
            if (peek() == 'e' || peek() == 'E') {
                i++;
                if (peek() == '+' || peek() == '-') i++;
                if (!(peek() >= '0' && peek() <= '9')) throw new IllegalArgumentException("bad number at position " + i);
                while (peek() >= '0' && peek() <= '9') i++;
            }
        }
    }
}
