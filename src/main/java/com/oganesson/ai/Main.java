package com.oganesson.ai;

import com.oganesson.ai.handler.DataHandler;
import com.oganesson.ai.handler.UIHandler;
import com.sun.net.httpserver.Filter;
import com.sun.net.httpserver.HttpContext;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.awt.Desktop;
import java.io.IOException;
import java.io.OutputStream;
import java.io.PrintStream;
import java.net.BindException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.Executors;

public class Main {

    private static final int PORT = 6677;
    private static final String DATA_FILE = "oganesson_data.json";

    /** True when running from a packaged app (see scripts/build-app.sh), where the install folder is read-only. */
    private static final boolean PACKAGED = Boolean.getBoolean("oganesson.packaged");

    public static void main(String[] args) throws IOException {
        Path baseDir = PACKAGED ? userDataDir() : locateBaseDir();
        Files.createDirectories(baseDir);

        String url = "http://localhost:" + PORT;

        HttpServer server;
        try {
            // Loopback only: the app is local-first, nothing on the network should be able to reach it.
            server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), PORT), 0);
        } catch (BindException e) {
            System.err.println("Port " + PORT + " is already in use. Is Oganesson AI already running?");
            if (PACKAGED) {
                // A copy is already running (e.g. the app was double-clicked twice): just show it.
                launchSystemBrowser(url);
                return;
            }
            System.exit(1);
            return;
        }

        Filter guard = new LocalRequestGuard(PORT);
        HttpContext ui = server.createContext("/", new UIHandler(baseDir));
        HttpContext data = server.createContext("/api/data", new DataHandler(baseDir.resolve(DATA_FILE)));
        HttpContext quit = server.createContext("/api/shutdown", exchange -> {
            // POST only, and the guard already rejects requests from any other website.
            if (!"POST".equals(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(405, -1);
                exchange.close();
                return;
            }
            byte[] body = "Stopped".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(body);
            }
            // Stop after this response has gone out, so the page gets its answer.
            new Thread(() -> {
                try { Thread.sleep(300); } catch (InterruptedException ignored) { }
                server.stop(0);
                System.exit(0);
            }, "shutdown").start();
        });
        ui.getFilters().add(guard);
        data.getFilters().add(guard);
        quit.getFilters().add(guard);

        server.setExecutor(Executors.newCachedThreadPool());
        server.start();
        Runtime.getRuntime().addShutdownHook(new Thread(() -> server.stop(0)));

        System.out.println("=====================================================");
        System.out.println(" 🔮 Oganesson AI Server Ready!");
        System.out.println(" 🌐 Open browser at: " + url);
        System.out.println(" 💾 Data saved in: " + baseDir.resolve(DATA_FILE));
        if (PACKAGED) System.out.println(" ⏻  Quit from Settings in the app.");
        System.out.println("=====================================================");

        boolean skipBrowser = args.length > 0 && "--no-browser".equals(args[0]);
        if (!skipBrowser) {
            launchSystemBrowser(url);
        }
    }

    /**
     * Where a packaged app keeps its data: a per-user folder, because the app's own folder is read-only once installed.
     */
    private static Path userDataDir() {
        String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
        Path home = Paths.get(System.getProperty("user.home"));
        if (os.contains("win")) {
            String appData = System.getenv("APPDATA");
            return (appData != null ? Paths.get(appData) : home.resolve("AppData").resolve("Roaming")).resolve("OganessonAI");
        }
        if (os.contains("mac")) {
            return home.resolve("Library").resolve("Application Support").resolve("OganessonAI");
        }
        String xdg = System.getenv("XDG_DATA_HOME");
        return (xdg != null && !xdg.isBlank() ? Paths.get(xdg) : home.resolve(".local").resolve("share")).resolve("oganesson-ai");
    }

    /**
     * Finds the project folder (the one holding src/main/resources/static and the data file) so the app
     * behaves the same no matter which directory it was started from. The working directory wins if it
     * already looks like the project; otherwise we walk up from the compiled classes (e.g. bin/ -> project).
     */
    private static Path locateBaseDir() {
        List<Path> candidates = new ArrayList<>();
        Path cwd = Paths.get("").toAbsolutePath();
        candidates.add(cwd);
        try {
            Path codeSource = Paths.get(Main.class.getProtectionDomain().getCodeSource().getLocation().toURI());
            Path p = Files.isDirectory(codeSource) ? codeSource : codeSource.getParent();
            for (int i = 0; p != null && i < 4; i++, p = p.getParent()) {
                candidates.add(p);
            }
        } catch (Exception ignored) {
            // Fall back to the working directory below.
        }
        for (Path candidate : candidates) {
            if (Files.isDirectory(candidate.resolve("src").resolve("main").resolve("resources").resolve("static"))
                    || Files.isRegularFile(candidate.resolve(DATA_FILE))) {
                return candidate;
            }
        }
        return cwd;
    }

    /**
     * Only accepts requests addressed to localhost, and (when a browser sends an Origin) only from our own page.
     * This blocks other websites from reading or overwriting your data through your browser, including DNS rebinding.
     */
    private static final class LocalRequestGuard extends Filter {
        private final Set<String> allowedHosts;
        private final Set<String> allowedOrigins;

        LocalRequestGuard(int port) {
            allowedHosts = Set.of("localhost:" + port, "127.0.0.1:" + port, "[::1]:" + port);
            allowedOrigins = Set.of("http://localhost:" + port, "http://127.0.0.1:" + port, "http://[::1]:" + port);
        }

        @Override
        public void doFilter(HttpExchange exchange, Chain chain) throws IOException {
            String host = exchange.getRequestHeaders().getFirst("Host");
            String origin = exchange.getRequestHeaders().getFirst("Origin");

            boolean hostOk = host != null && allowedHosts.contains(host.toLowerCase(Locale.ROOT));
            boolean originOk = origin == null || allowedOrigins.contains(origin.toLowerCase(Locale.ROOT));

            if (!hostOk || !originOk) {
                byte[] body = "403 Forbidden".getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=UTF-8");
                exchange.sendResponseHeaders(403, body.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(body);
                }
                return;
            }
            chain.doFilter(exchange);
        }

        @Override
        public String description() {
            return "Rejects requests that are not addressed to localhost";
        }
    }

    private static void launchSystemBrowser(String url) {
        PrintStream originalErr = System.err;
        System.setErr(new PrintStream(OutputStream.nullOutputStream()));

        try {
            String os = System.getProperty("os.name").toLowerCase();

            if (os.contains("nix") || os.contains("nux")) {
                ProcessBuilder pb = new ProcessBuilder("xdg-open", url);
                pb.redirectOutput(ProcessBuilder.Redirect.DISCARD);
                pb.redirectError(ProcessBuilder.Redirect.DISCARD);
                pb.start();
                return;
            }

            if (Desktop.isDesktopSupported()) {
                Desktop desktop = Desktop.getDesktop();
                if (desktop.isSupported(Desktop.Action.BROWSE)) {
                    desktop.browse(new URI(url));
                    return;
                }
            }

            ProcessBuilder pb = null;
            if (os.contains("win")) {
                pb = new ProcessBuilder("rundll32", "url.dll,FileProtocolHandler", url);
            } else if (os.contains("mac")) {
                pb = new ProcessBuilder("open", url);
            }

            if (pb != null) {
                pb.redirectOutput(ProcessBuilder.Redirect.DISCARD);
                pb.redirectError(ProcessBuilder.Redirect.DISCARD);
                pb.start();
            }
        } catch (Exception ignored) {
        } finally {
            System.setErr(originalErr);
        }
    }
}
