package com.oganesson.ai.handler;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Forwards chat completion requests to an external provider so the browser never talks to the
 * cloud directly (CORS + API-key isolation). OpenAI-compatible bodies are passed through; Claude
 * (Anthropic Messages API) is translated both ways so the front end can keep one stream parser.
 */
public class ProxyHandler implements HttpHandler {

    private static final int MAX_REQUEST_BYTES = 8 * 1024 * 1024;

    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(20))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    private static final Pattern ANTHROPIC_TEXT_DELTA = Pattern.compile(
            "\"type\"\\s*:\\s*\"text_delta\"[^}]*\"text\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
    private static final Pattern ANTHROPIC_ERROR = Pattern.compile(
            "\"message\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        try {
            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                exchange.getResponseHeaders().set("Allow", "POST");
                exchange.sendResponseHeaders(405, -1);
                return;
            }

            Headers reqHeaders = exchange.getRequestHeaders();
            String targetUrl = first(reqHeaders, "X-Target-Url");
            String provider = first(reqHeaders, "X-Provider");
            String apiKey = first(reqHeaders, "X-Api-Key");

            if (targetUrl == null || targetUrl.isBlank()) {
                writeError(exchange, 400, "Missing X-Target-Url header.");
                return;
            }
            URI target;
            try {
                target = URI.create(targetUrl.trim());
            } catch (Exception e) {
                writeError(exchange, 400, "Invalid X-Target-Url.");
                return;
            }
            String scheme = target.getScheme();
            if (scheme == null || (!scheme.equalsIgnoreCase("https") && !scheme.equalsIgnoreCase("http"))) {
                writeError(exchange, 400, "Target URL must be http or https.");
                return;
            }

            if (scheme.equalsIgnoreCase("http") && !isLocalHost(target.getHost())) {
                // A key sent over plain http would be readable on the network. Only addresses on this machine or
                // the local network may use http; everything else must be https.
                writeError(exchange, 400, "Use an https:// address for an online provider, so your key is encrypted.");
                return;
            }

            byte[] bodyBytes;
            try (InputStream in = exchange.getRequestBody()) {
                bodyBytes = in.readNBytes(MAX_REQUEST_BYTES + 1);
            }
            if (bodyBytes.length > MAX_REQUEST_BYTES) {
                writeError(exchange, 413, "The request is too large.");
                return;
            }
            String body = new String(bodyBytes, StandardCharsets.UTF_8);
            boolean anthropic = "claude".equalsIgnoreCase(provider == null ? "" : provider.trim());

            HttpRequest.Builder builder = HttpRequest.newBuilder(target)
                    .timeout(Duration.ofMinutes(10));

            if (anthropic) {
                String converted;
                try {
                    converted = toAnthropicBody(body);
                } catch (Exception e) {
                    writeError(exchange, 400, "Could not convert request for Claude: " + e.getMessage());
                    return;
                }
                builder.POST(HttpRequest.BodyPublishers.ofString(converted, StandardCharsets.UTF_8));
                builder.header("Content-Type", "application/json");
                builder.header("anthropic-version", "2023-06-01");
                if (apiKey != null && !apiKey.isBlank()) {
                    builder.header("x-api-key", apiKey.trim());
                }
            } else {
                builder.POST(HttpRequest.BodyPublishers.ofByteArray(bodyBytes));
                builder.header("Content-Type", "application/json");
                if (apiKey != null && !apiKey.isBlank()) {
                    builder.header("Authorization", "Bearer " + apiKey.trim());
                }
                // OpenRouter asks for these optionally; harmless elsewhere.
                if ("openrouter".equalsIgnoreCase(provider)) {
                    builder.header("HTTP-Referer", "https://localhost");
                    builder.header("X-Title", "Oganesson AI");
                }
            }

            HttpResponse<InputStream> upstream;
            try {
                upstream = CLIENT.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                writeError(exchange, 502, "Upstream request interrupted.");
                return;
            } catch (IOException e) {
                writeError(exchange, 502, "Could not reach provider: " + safeMessage(e));
                return;
            }

            int status = upstream.statusCode();
            Headers out = exchange.getResponseHeaders();
            out.set("Cache-Control", "no-store");
            out.set("X-Content-Type-Options", "nosniff");

            String contentType = upstream.headers().firstValue("Content-Type").orElse("application/json");
            out.set("Content-Type", contentType);

            if (status >= 400) {
                byte[] errBody = upstream.body().readAllBytes();
                exchange.sendResponseHeaders(status, errBody.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(errBody);
                }
                return;
            }

            // Stream the body. For Anthropic, rewrite events into OpenAI-style SSE chunks.
            exchange.sendResponseHeaders(status, 0);
            try (InputStream in = upstream.body();
                 OutputStream os = exchange.getResponseBody()) {
                if (anthropic) {
                    streamAnthropicAsOpenAi(in, os);
                } else {
                    // Copy chunk by chunk and flush each one, so tokens reach the page as they are produced.
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        os.write(buffer, 0, read);
                        os.flush();
                    }
                }
                os.flush();
            }
        } finally {
            exchange.close();
        }
    }

    private static void streamAnthropicAsOpenAi(InputStream in, OutputStream os) throws IOException {
        BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        String line;
        String event = "";
        while ((line = reader.readLine()) != null) {
            if (line.startsWith("event:")) {
                event = line.substring(6).trim();
                continue;
            }
            if (!line.startsWith("data:")) {
                continue;
            }
            String data = line.substring(5).trim();
            if (data.isEmpty()) continue;

            if ("content_block_delta".equals(event) || data.contains("text_delta")) {
                String text = extractAnthropicText(data);
                if (text != null && !text.isEmpty()) {
                    String chunk = "{\"choices\":[{\"delta\":{\"content\":" + jsonString(text) + "}}]}";
                    writeSse(os, chunk);
                }
            } else if ("message_delta".equals(event) && data.contains("stop_reason")) {
                writeSse(os, "{\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}");
            } else if ("error".equals(event) || data.contains("\"type\":\"error\"")) {
                String msg = extractAnthropicError(data);
                String chunk = "{\"error\":" + jsonString(msg != null ? msg : "Anthropic error") + "}";
                writeSse(os, chunk);
            }
            // message_start / content_block_start / message_stop ignored
            event = "";
        }
        writeSse(os, "[DONE]");
    }

    private static void writeSse(OutputStream os, String data) throws IOException {
        os.write(("data: " + data + "\n\n").getBytes(StandardCharsets.UTF_8));
        os.flush();
    }

    private static String extractAnthropicText(String data) {
        Matcher m = ANTHROPIC_TEXT_DELTA.matcher(data);
        if (!m.find()) return null;
        return unescapeJson(m.group(1));
    }

    private static String extractAnthropicError(String data) {
        Matcher m = ANTHROPIC_ERROR.matcher(data);
        if (!m.find()) return null;
        return unescapeJson(m.group(1));
    }

    /**
     * Converts an OpenAI chat-completions body into an Anthropic Messages API body. Only the fields the app sends are
     * used. Claude needs the system prompt separately, turns that alternate between user and assistant, and a first
     * turn from the user. The app always starts with the character's greeting (an assistant turn), so one is added.
     */
    private static String toAnthropicBody(String openaiJson) {
        Map<String, Object> root = parseLooseObject(openaiJson);
        String model = stringVal(root.get("model"));
        if (model == null || model.isBlank()) {
            throw new IllegalArgumentException("A model name is required for Claude.");
        }
        Number maxTokens = numberVal(root.get("max_tokens"));
        int max = maxTokens != null ? maxTokens.intValue() : 2048;
        boolean stream = Boolean.TRUE.equals(root.get("stream"));
        Number temperature = numberVal(root.get("temperature"));

        StringBuilder system = new StringBuilder();
        List<String[]> turns = new ArrayList<>();   // {role, content}
        for (Map<String, Object> msg : listOfMaps(root.get("messages"))) {
            String role = stringVal(msg.get("role"));
            String content = stringVal(msg.get("content"));
            if (content == null) content = "";
            if ("system".equals(role)) {
                if (system.length() > 0) system.append("\n\n");
                system.append(content);
            } else if ("user".equals(role) || "assistant".equals(role)) {
                if (!turns.isEmpty() && turns.get(turns.size() - 1)[0].equals(role)) {
                    // Claude rejects two turns from the same side in a row, so they are joined.
                    String[] last = turns.get(turns.size() - 1);
                    last[1] = last[1] + "\n\n" + content;
                } else {
                    turns.add(new String[] {role, content});
                }
            }
        }
        if (turns.isEmpty() || !"user".equals(turns.get(0)[0])) {
            turns.add(0, new String[] {"user", "(The roleplay begins now.)"});
        }

        StringBuilder out = new StringBuilder(512);
        out.append('{');
        out.append("\"model\":").append(jsonString(model));
        out.append(",\"max_tokens\":").append(max);
        out.append(",\"stream\":").append(stream);
        if (temperature != null) {
            out.append(",\"temperature\":").append(temperature.doubleValue());
        }
        if (system.length() > 0) {
            out.append(",\"system\":").append(jsonString(system.toString()));
        }
        out.append(",\"messages\":[");
        for (int i = 0; i < turns.size(); i++) {
            if (i > 0) out.append(',');
            out.append("{\"role\":").append(jsonString(turns.get(i)[0]))
               .append(",\"content\":").append(jsonString(turns.get(i)[1])).append('}');
        }
        out.append("]}");
        return out.toString();
    }

    /** True for this machine, the local network, and names that only resolve locally. */
    private static boolean isLocalHost(String host) {
        if (host == null) return false;
        String h = host.toLowerCase(Locale.ROOT);
        if (h.startsWith("[") && h.endsWith("]")) h = h.substring(1, h.length() - 1);
        if (h.equals("localhost") || h.endsWith(".localhost") || h.endsWith(".local") || h.equals("::1")) return true;
        if (!h.contains(".") && !h.contains(":")) return true;   // a single name on the local network
        Matcher v4 = Pattern.compile("^(\\d+)\\.(\\d+)\\.(\\d+)\\.(\\d+)$").matcher(h);
        if (!v4.matches()) return h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80");
        int a = Integer.parseInt(v4.group(1)), b = Integer.parseInt(v4.group(2));
        return a == 127 || a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || (a == 169 && b == 254);
    }

    // --- tiny JSON helpers (enough for the shapes we send) ---

    private static Map<String, Object> parseLooseObject(String json) {
        Object value = parseValue(new Cursor(json.trim()));
        if (!(value instanceof Map<?, ?> map)) {
            throw new IllegalArgumentException("The request body is not a JSON object.");
        }
        Map<String, Object> out = new LinkedHashMap<>();
        map.forEach((key, val) -> out.put(String.valueOf(key), val));
        return out;
    }

    private static Object parseValue(Cursor c) {
        c.skipWs();
        if (c.eof()) return null;
        char ch = c.peek();
        if (ch == '{') return parseObject(c);
        if (ch == '[') return parseArray(c);
        if (ch == '"') return parseString(c);
        if (ch == 't' || ch == 'f') return parseBool(c);
        if (ch == 'n') {
            c.expect("null");
            return null;
        }
        return parseNumber(c);
    }

    private static Map<String, Object> parseObject(Cursor c) {
        Map<String, Object> map = new LinkedHashMap<>();
        c.expect('{');
        c.skipWs();
        if (c.peek() == '}') {
            c.advance();
            return map;
        }
        while (!c.eof()) {
            c.skipWs();
            String key = parseString(c);
            c.skipWs();
            c.expect(':');
            Object val = parseValue(c);
            map.put(key, val);
            c.skipWs();
            if (c.peek() == ',') {
                c.advance();
                continue;
            }
            if (c.peek() == '}') {
                c.advance();
                break;
            }
            break;
        }
        return map;
    }

    private static List<Object> parseArray(Cursor c) {
        List<Object> list = new ArrayList<>();
        c.expect('[');
        c.skipWs();
        if (c.peek() == ']') {
            c.advance();
            return list;
        }
        while (!c.eof()) {
            list.add(parseValue(c));
            c.skipWs();
            if (c.peek() == ',') {
                c.advance();
                continue;
            }
            if (c.peek() == ']') {
                c.advance();
                break;
            }
            break;
        }
        return list;
    }

    private static String parseString(Cursor c) {
        c.expect('"');
        StringBuilder sb = new StringBuilder();
        while (!c.eof()) {
            char ch = c.advance();
            if (ch == '"') break;
            if (ch == '\\') {
                if (c.eof()) break;
                char esc = c.advance();
                switch (esc) {
                    case '"':
                    case '\\':
                    case '/':
                        sb.append(esc);
                        break;
                    case 'b':
                        sb.append('\b');
                        break;
                    case 'f':
                        sb.append('\f');
                        break;
                    case 'n':
                        sb.append('\n');
                        break;
                    case 'r':
                        sb.append('\r');
                        break;
                    case 't':
                        sb.append('\t');
                        break;
                    case 'u':
                        if (c.remaining() >= 4) {
                            String hex = c.take(4);
                            try {
                                sb.append((char) Integer.parseInt(hex, 16));
                            } catch (NumberFormatException e) {
                                sb.append(hex);
                            }
                        }
                        break;
                    default:
                        sb.append(esc);
                }
            } else {
                sb.append(ch);
            }
        }
        return sb.toString();
    }

    private static Boolean parseBool(Cursor c) {
        if (c.peek() == 't') {
            c.expect("true");
            return Boolean.TRUE;
        }
        c.expect("false");
        return Boolean.FALSE;
    }

    private static Number parseNumber(Cursor c) {
        int start = c.pos;
        if (c.peek() == '-') c.advance();
        while (!c.eof() && (Character.isDigit(c.peek()) || c.peek() == '.' || c.peek() == 'e' || c.peek() == 'E' || c.peek() == '+' || c.peek() == '-')) {
            // stop if the '-' / '+' is not part of exponent (simple: consume while valid-ish)
            char ch = c.peek();
            if ((ch == '+' || ch == '-') && c.pos > start && c.charAt(c.pos - 1) != 'e' && c.charAt(c.pos - 1) != 'E') break;
            c.advance();
        }
        String raw = c.slice(start, c.pos);
        if (raw.indexOf('.') >= 0 || raw.indexOf('e') >= 0 || raw.indexOf('E') >= 0) {
            return Double.parseDouble(raw);
        }
        try {
            return Long.parseLong(raw);
        } catch (NumberFormatException e) {
            return Double.parseDouble(raw);
        }
    }

    private static final class Cursor {
        final String s;
        int pos;

        Cursor(String s) {
            this.s = s;
        }

        boolean eof() {
            return pos >= s.length();
        }

        char peek() {
            return eof() ? '\0' : s.charAt(pos);
        }

        char charAt(int i) {
            return s.charAt(i);
        }

        char advance() {
            return s.charAt(pos++);
        }

        int remaining() {
            return s.length() - pos;
        }

        String take(int n) {
            String out = s.substring(pos, pos + n);
            pos += n;
            return out;
        }

        String slice(int from, int to) {
            return s.substring(from, to);
        }

        void skipWs() {
            while (!eof() && Character.isWhitespace(peek())) pos++;
        }

        void expect(char ch) {
            skipWs();
            if (peek() != ch) throw new IllegalArgumentException("Expected '" + ch + "' at " + pos);
            advance();
        }

        void expect(String lit) {
            skipWs();
            if (!s.startsWith(lit, pos)) throw new IllegalArgumentException("Expected " + lit + " at " + pos);
            pos += lit.length();
        }
    }

    private static List<Map<String, Object>> listOfMaps(Object o) {
        if (!(o instanceof List<?> list)) return List.of();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object item : list) {
            if (item instanceof Map<?, ?> map) {
                Map<String, Object> copy = new LinkedHashMap<>();
                map.forEach((key, val) -> copy.put(String.valueOf(key), val));
                out.add(copy);
            }
        }
        return out;
    }

    private static String stringVal(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private static Number numberVal(Object o) {
        if (o instanceof Number) return (Number) o;
        return null;
    }

    private static String jsonString(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder(s.length() + 8);
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            switch (ch) {
                case '"':
                    sb.append("\\\"");
                    break;
                case '\\':
                    sb.append("\\\\");
                    break;
                case '\b':
                    sb.append("\\b");
                    break;
                case '\f':
                    sb.append("\\f");
                    break;
                case '\n':
                    sb.append("\\n");
                    break;
                case '\r':
                    sb.append("\\r");
                    break;
                case '\t':
                    sb.append("\\t");
                    break;
                default:
                    if (ch < 0x20) {
                        sb.append(String.format("\\u%04x", (int) ch));
                    } else {
                        sb.append(ch);
                    }
            }
        }
        sb.append('"');
        return sb.toString();
    }

    private static String unescapeJson(String s) {
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '\\' && i + 1 < s.length()) {
                char n = s.charAt(++i);
                switch (n) {
                    case '"':
                    case '\\':
                    case '/':
                        sb.append(n);
                        break;
                    case 'b':
                        sb.append('\b');
                        break;
                    case 'f':
                        sb.append('\f');
                        break;
                    case 'n':
                        sb.append('\n');
                        break;
                    case 'r':
                        sb.append('\r');
                        break;
                    case 't':
                        sb.append('\t');
                        break;
                    case 'u':
                        if (i + 4 < s.length()) {
                            try {
                                sb.append((char) Integer.parseInt(s.substring(i + 1, i + 5), 16));
                                i += 4;
                            } catch (NumberFormatException e) {
                                sb.append(n);
                            }
                        } else {
                            sb.append(n);
                        }
                        break;
                    default:
                        sb.append(n);
                }
            } else {
                sb.append(ch);
            }
        }
        return sb.toString();
    }

    private static String first(Headers headers, String name) {
        List<String> values = headers.get(name);
        if (values == null || values.isEmpty()) return null;
        return values.get(0);
    }

    private static void writeError(HttpExchange exchange, int status, String message) throws IOException {
        byte[] bytes = ("{\"error\":" + jsonString(message) + "}").getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private static String safeMessage(Exception e) {
        String m = e.getMessage();
        if (m == null || m.isBlank()) return e.getClass().getSimpleName();
        return m.length() > 200 ? m.substring(0, 200) : m;
    }
}
