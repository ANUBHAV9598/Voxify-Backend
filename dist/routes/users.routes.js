import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authMiddleware, } from "../middleware/auth.js";
const router = Router();
const getUserIdFromRequest = (req) => {
    const payload = req.user;
    if (!payload || typeof payload === "string" || !payload.sub) {
        return null;
    }
    return String(payload.sub);
};
router.get("/", authMiddleware, async (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
        return res.status(401).json({ message: "Invalid token payload" });
    }
    try {
        const users = await prisma.user.findMany({
            where: {
                id: {
                    not: userId,
                },
            },
            orderBy: {
                createdAt: "desc",
            },
            select: {
                id: true,
                name: true,
                email: true,
                isOnline: true,
                lastSeen: true,
                createdAt: true,
            },
        });
        return res.status(200).json({ users });
    }
    catch (error) {
        console.error("Fetching users failed:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});
export default router;
//# sourceMappingURL=users.routes.js.map