import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import authRoutes from "./routes/auth.routes.js";
import callRoutes from "./routes/calls.routes.js";
import conversationRoutes from "./routes/conversations.routes.js";
import userRoutes from "./routes/users.routes.js";
import { registerSocketHandlers } from "./socket/index.js";

const FRONTEND_ORIGINS = Array.from(
    new Set(
        [
            process.env.FRONTEND_URL,
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ].filter((value): value is string => Boolean(value?.trim())),
    ),
);

const liveKitHttpUrl = process.env.LIVEKIT_URL?.replace(/^wss:/, "https:").replace(
    /^ws:/,
    "http:",
);

const app = express();
app.disable("x-powered-by");
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                baseUri: ["'self'"],
                connectSrc: ["'self'", ...FRONTEND_ORIGINS, ...(liveKitHttpUrl ? [liveKitHttpUrl] : [])],
                fontSrc: ["'self'", "https:", "data:"],
                formAction: ["'self'"],
                frameAncestors: ["'none'"],
                imgSrc: ["'self'", "data:", "https:"],
                objectSrc: ["'none'"],
                scriptSrc: ["'self'"],
                scriptSrcAttr: ["'none'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https:"],
                upgradeInsecureRequests: [],
            },
        },
        dnsPrefetchControl: { allow: false },
        crossOriginEmbedderPolicy: false,
        crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
        crossOriginResourcePolicy: { policy: "cross-origin" },
        frameguard: { action: "deny" },
        hsts:
            process.env.NODE_ENV === "production"
                ? {
                    maxAge: 31536000,
                    includeSubDomains: true,
                    preload: true,
                }
                : false,
        ieNoOpen: true,
        noSniff: true,
        originAgentCluster: true,
        permittedCrossDomainPolicies: { permittedPolicies: "none" },
        referrerPolicy: { policy: "no-referrer" },
    }),
);
app.use((_, res, next) => {
    res.setHeader(
        "Permissions-Policy",
        [
            "accelerometer=()",
            "autoplay=(self)",
            "camera=(self)",
            "display-capture=(self)",
            "fullscreen=(self)",
            "geolocation=()",
            "gyroscope=()",
            "magnetometer=()",
            "microphone=(self)",
            "payment=()",
            "usb=()",
        ].join(", "),
    );
    // Modern browsers rely on CSP instead, but keeping this explicit avoids ambiguity.
    res.setHeader("X-XSS-Protection", "0");
    next();
});
app.use(
    cors({
        origin(origin, callback) {
            if (!origin || FRONTEND_ORIGINS.includes(origin)) {
                callback(null, true);
                return;
            }

            callback(new Error("CORS origin not allowed"));
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
);
app.use(express.json());

app.use("/auth", authRoutes);
app.use("/calls", callRoutes);
app.use("/conversations", conversationRoutes);
app.use("/users", userRoutes);

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: FRONTEND_ORIGINS,
        credentials: true,
        methods: ["GET", "POST"],
    },
});

registerSocketHandlers(io);

const port = Number(process.env.PORT ?? 5000);

server.listen(port, () => {
    console.log(`Server running on ${port}`);
});
