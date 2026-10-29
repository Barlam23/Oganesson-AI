package com.oganesson.ai.handler;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Serves the web UI from src/main/resources/static (edits show up on refresh) or, when packaged,
 * from the classpath. Requests can never reach outside that folder.
 */
public class UIHandler implements HttpHandler {

    private static final class Entry {
        final byte[] bytes;
        final String etag;
        final long modified;
        final long size;

        Entry(byte[] bytes, long modified, long size) {
            this.bytes = bytes;
            this.modified = modified;
            this.size = size;
            this.etag = "\"" + Long.toHexString(modified) + "-" + Integer.toHexString(Arrays.hashCode(bytes)) + "\"";
        }
    }

    private final Path staticRoot;      // real path of the on-disk static folder, or null if there isn't one
    private final Map<String, Entry> cache = new ConcurrentHashMap<>();

    public UIHandler(Path baseDir) {
        Path root = baseDir.resolve("src").resolve("main").resolve("resources").resolve("static");
        Path real = null;
        try {
            if (Files.isDirectory(root)) real = root.toRealPath();
        } catch (IOException ignored) {
            // No usable on-disk folder; the classpath will be used instead.
        }
        this.staticRoot = real;
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        try {
            String method = exchange.getRequestMethod();
            boolean head = "HEAD".equalsIgnoreCase(method);
            if (!head && !"GET".equalsIgnoreCase(method)) {
                exchange.getResponseHeaders().set("Allow", "GET, HEAD");
                exchange.sendResponseHeaders(405, -1);
                return;
            }

            String relative = normalize(exchange.getRequestURI().getPath());
            Entry entry = relative == null ? null : load(relative);

            if (entry == null) {
                byte[] notFound = "404 Not Found".getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=UTF-8");
                exchange.sendResponseHeaders(404, head ? -1 : notFound.length);
                if (!head) {
                    try (OutputStream os = exchange.getResponseBody()) {
                        os.write(notFound);
                    }
                }
                return;
            }

            exchange.getResponseHeaders().set("Content-Type", resolveContentType(relative));
            exchange.getResponseHeaders().set("Cache-Control", "no-cache");   // always revalidate; the ETag makes that cheap
            exchange.getResponseHeaders().set("ETag", entry.etag);
            exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");

            if (matchesETag(exchange.getRequestHeaders().getFirst("If-None-Match"), entry.etag)) {
                exchange.sendResponseHeaders(304, -1);
                return;
            }
            if (head) {
                exchange.sendResponseHeaders(200, -1);
                return;
            }
            exchange.sendResponseHeaders(200, entry.bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(entry.bytes);
            }
        } finally {
            exchange.close();
        }
    }

    /** Turns a request path into a safe relative resource path, or null if it is not acceptable. */
    private static String normalize(String requestPath) {
        if (requestPath == null) return null;
        if ("/".equals(requestPath)) return "index.html";
        if (requestPath.indexOf('\0') >= 0 || requestPath.indexOf('\\') >= 0) return null;
        try {
            Path p = Paths.get(requestPath.replaceFirst("^/+", "")).normalize();
            if (p.isAbsolute() || p.toString().isEmpty() || p.startsWith("..")) return null;
            for (Path segment : p) {
                if (segment.toString().startsWith(".")) return null;     // no dotfiles
            }
            return p.toString().replace('\\', '/');
        } catch (InvalidPathException e) {
            return null;
        }
    }

    private Entry load(String relative) throws IOException {
        // 1) On-disk file: re-read only when it changed, so edits show up without restarting the server.
        if (staticRoot != null) {
            Path candidate = staticRoot.resolve(relative).normalize();
            if (candidate.startsWith(staticRoot) && Files.isRegularFile(candidate)) {
                Path real = candidate.toRealPath();
                if (!real.startsWith(staticRoot)) return null;        // symlink pointing outside
                long modified = Files.getLastModifiedTime(real).toMillis();
                long size = Files.size(real);
                Entry cached = cache.get(relative);
                if (cached != null && cached.modified == modified && cached.size == size) return cached;
                Entry fresh = new Entry(Files.readAllBytes(real), modified, size);
                cache.put(relative, fresh);
                return fresh;
            }
        }

        // 2) Classpath resource (when the app is packaged without the source tree).
        Entry cached = cache.get(relative);
        if (cached != null && cached.modified == -1) return cached;
        try (InputStream is = getClass().getResourceAsStream("/static/" + relative)) {
            if (is == null) return null;
            Entry fresh = new Entry(is.readAllBytes(), -1, -1);
            cache.put(relative, fresh);
            return fresh;
        }
    }

    private static boolean matchesETag(String header, String etag) {
        if (header == null) return false;
        for (String candidate : header.split(",")) {
            String c = candidate.trim();
            if (c.startsWith("W/")) c = c.substring(2);
            if (c.equals(etag) || c.equals("*")) return true;
        }
        return false;
    }

    private static String resolveContentType(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html; charset=UTF-8";
        if (p.endsWith(".css")) return "text/css; charset=UTF-8";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript; charset=UTF-8";
        if (p.endsWith(".json") || p.endsWith(".map")) return "application/json; charset=UTF-8";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".txt")) return "text/plain; charset=UTF-8";
        return "application/octet-stream";
    }
}
