import { Router } from "express";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { z } from "zod";
import { authMiddleware, } from "../middleware/auth.js";
const router = Router();
const joinCallSchema = z.object({
    roomName: z
        .string()
        .trim()
        .min(3, "roomName must be at least 3 characters")
        .max(120, "roomName must be at most 120 characters")
        .regex(/^[a-zA-Z0-9:_-]+$/, "roomName contains unsupported characters"),
});
const MAX_CALL_PARTICIPANTS = 10;
const getJwtPayload = (req) => {
    const payload = req.user;
    if (!payload || typeof payload === "string" || !payload.sub) {
        return null;
    }
    return payload;
};
const getLiveKitConfig = () => {
    const url = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!url || !apiKey || !apiSecret) {
        return null;
    }
    return { url, apiKey, apiSecret };
};
router.use(authMiddleware);
router.post("/token", async (req, res) => {
    const payload = getJwtPayload(req);
    if (!payload) {
        return res.status(401).json({ message: "Invalid token payload" });
    }
    const parsed = joinCallSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Invalid call room data",
            errors: parsed.error.flatten(),
        });
    }
    const liveKitConfig = getLiveKitConfig();
    if (!liveKitConfig) {
        return res.status(500).json({
            message: "LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.",
        });
    }
    const { roomName } = parsed.data;
    try {
        const roomService = new RoomServiceClient(liveKitConfig.url, liveKitConfig.apiKey, liveKitConfig.apiSecret);
        try {
            await roomService.createRoom({
                name: roomName,
                maxParticipants: MAX_CALL_PARTICIPANTS,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.toLowerCase().includes("already exists")) {
                console.warn("Creating LiveKit room failed:", error);
            }
        }
        try {
            const participants = await roomService.listParticipants(roomName);
            if (participants.length >= MAX_CALL_PARTICIPANTS) {
                return res.status(403).json({
                    message: "This call is full. The maximum room size is 10 people.",
                });
            }
        }
        catch (error) {
            console.warn("Listing LiveKit participants failed:", error);
        }
        const token = new AccessToken(liveKitConfig.apiKey, liveKitConfig.apiSecret, {
            identity: String(payload.sub),
            name: typeof payload.name === "string" ? payload.name : String(payload.sub),
            metadata: JSON.stringify({
                email: typeof payload.email === "string" ? payload.email : "",
            }),
        });
        token.addGrant({
            roomJoin: true,
            room: roomName,
            canPublish: true,
            canSubscribe: true,
            canPublishData: true,
        });
        const accessToken = await token.toJwt();
        return res.status(200).json({
            token: accessToken,
            url: liveKitConfig.url,
            roomName,
            maxParticipants: MAX_CALL_PARTICIPANTS,
        });
    }
    catch (error) {
        console.error("Creating LiveKit access token failed:", error);
        return res.status(500).json({ message: "Failed to join call" });
    }
});
export default router;
//# sourceMappingURL=calls.routes.js.map