import { Router } from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import {
  authMiddleware,
  type AuthenticatedRequest,
} from "../middleware/auth.js";

const router = Router();

const directConversationSchema = z.object({
    targetUserId: z.string().uuid("targetUserId must be a valid UUID"),
});

const groupConversationSchema = z.object({
    name: z
        .string()
        .trim()
        .min(2, "Group name must be at least 2 characters")
        .max(60, "Group name must be at most 60 characters"),
    memberIds: z
        .array(z.string().uuid("memberIds must contain valid UUIDs"))
        .min(1, "Select at least 1 member")
        .max(9, "A group can have at most 10 users including you"),
});

const messageSchema = z.object({
    content: z.string().trim().min(1, "Message content is required"),
});

const conversationInclude = {
    members: {
        include: {
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    isOnline: true,
                    lastSeen: true,
                },
            },
        },
    },
    messages: {
        orderBy: { createdAt: "desc" as const },
        take: 1,
        include: {
            sender: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                },
            },
        },
    },
};

const getUserIdFromRequest = (req: AuthenticatedRequest) => {
    const payload = req.user;

    if (!payload || typeof payload === "string" || !payload.sub) {
        return null;
    }

    return String(payload.sub);
};

const getConversationIdFromRequest = (req: AuthenticatedRequest) => {
    const conversationId = req.params.id;

    if (typeof conversationId !== "string" || conversationId.trim().length === 0) {
        return null;
    }

    return conversationId;
};

router.use(authMiddleware);

router.post("/direct", async (req: AuthenticatedRequest, res) => {
    const userId = getUserIdFromRequest(req);

    if (!userId) {
        return res.status(401).json({ message: "Invalid token payload" });
    }

    const parsed = directConversationSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
        message: "Invalid direct conversation data",
        errors: parsed.error.flatten(),
        });
    }

    const { targetUserId } = parsed.data;

    if (targetUserId === userId) {
        return res
        .status(400)
        .json({ message: "You cannot create a direct conversation with yourself" });
    }

    try {
        const targetUser = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true },
        });

        if (!targetUser) {
        return res.status(404).json({ message: "Target user not found" });
        }

        const existingConversationMembers =
        await prisma.conversationMember.findMany({
            where: {
            userId: { in: [userId, targetUserId] },
            conversation: { type: "direct" },
            },
            include: {
            conversation: {
                include: {
                members: true,
                },
            },
            },
        });

        const existingConversation = existingConversationMembers
        .map((membership) => membership.conversation)
        .find((conversation) => {
            const memberIds = conversation.members.map((member) => member.userId);
            return (
            memberIds.length === 2 &&
            memberIds.includes(userId) &&
            memberIds.includes(targetUserId)
            );
        });

        if (existingConversation) {
        const conversation = await prisma.conversation.findUnique({
            where: { id: existingConversation.id },
            include: conversationInclude,
        });

        return res.status(200).json({ conversation });
        }

        const conversation = await prisma.conversation.create({
        data: {
            type: "direct",
            members: {
            create: [{ userId }, { userId: targetUserId }],
            },
        },
        include: conversationInclude,
        });

        return res.status(201).json({ conversation });
    } catch (error) {
        console.error("Creating direct conversation failed:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
    });

router.post("/group", async (req: AuthenticatedRequest, res) => {
    const userId = getUserIdFromRequest(req);

    if (!userId) {
        return res.status(401).json({ message: "Invalid token payload" });
    }

    const parsed = groupConversationSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Invalid group conversation data",
            errors: parsed.error.flatten(),
        });
    }

    const uniqueMemberIds = Array.from(
        new Set(parsed.data.memberIds.filter((memberId) => memberId !== userId)),
    );

    if (uniqueMemberIds.length === 0) {
        return res.status(400).json({
            message: "A group needs at least 1 other participant",
        });
    }

    if (uniqueMemberIds.length > 9) {
        return res.status(400).json({
            message: "A group can have at most 10 users including you",
        });
    }

    try {
        const users = await prisma.user.findMany({
            where: {
                id: { in: uniqueMemberIds },
            },
            select: {
                id: true,
            },
        });

        if (users.length !== uniqueMemberIds.length) {
            return res.status(404).json({ message: "One or more users were not found" });
        }

        const conversation = await prisma.conversation.create({
            data: {
                type: "group",
                name: parsed.data.name,
                members: {
                    create: [userId, ...uniqueMemberIds].map((memberId) => ({
                        userId: memberId,
                    })),
                },
            },
            include: conversationInclude,
        });

        return res.status(201).json({ conversation });
    } catch (error) {
        console.error("Creating group conversation failed:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});

    router.get("/", async (req: AuthenticatedRequest, res) => {
    const userId = getUserIdFromRequest(req);

    if (!userId) {
        return res.status(401).json({ message: "Invalid token payload" });
    }

    try {
        const conversations = await prisma.conversation.findMany({
        where: {
            members: {
            some: { userId },
            },
        },
        orderBy: {
            createdAt: "desc",
        },
        include: conversationInclude,
        });

        const conversationsWithUnreadCount = await Promise.all(
            conversations.map(async (conv) => {
                const currentUserMember = conv.members.find((m) => m.userId === userId);
                const unreadCount = await prisma.message.count({
                    where: {
                        conversationId: conv.id,
                        createdAt: { gt: currentUserMember?.lastReadAt ?? new Date(0) },
                    },
                });
                return { ...conv, unreadCount };
            }),
        );

        return res.status(200).json({ conversations: conversationsWithUnreadCount });
    } catch (error) {
        console.error("Fetching conversations failed:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
    });

router.get("/:id/messages", async (req: AuthenticatedRequest, res) => {
    const userId = getUserIdFromRequest(req);
    const conversationId = getConversationIdFromRequest(req);

    if (!userId) {
        return res.status(401).json({ message: "Invalid token payload" });
    }

    if (!conversationId) {
        return res.status(400).json({ message: "Invalid conversation id" });
    }

    try {
        const membership = await prisma.conversationMember.findUnique({
        where: {
            conversationId_userId: {
            conversationId,
            userId,
            },
        },
        });

        if (!membership) {
        return res.status(403).json({ message: "Access denied to conversation" });
        }

        const messages = await prisma.message.findMany({
            where: { conversationId },
            orderBy: { createdAt: "asc" },
            include: {
                sender: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
            },
        });

        const members = await prisma.conversationMember.findMany({
            where: { conversationId },
            select: {
                userId: true,
                lastReadAt: true,
                lastDeliveredAt: true,
            },
        });

        return res.status(200).json({ messages, members });
    } catch (error) {
        console.error("Fetching messages failed:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
    });

router.post("/:id/messages", async (req: AuthenticatedRequest, res) => {
    const userId = getUserIdFromRequest(req);
    const conversationId = getConversationIdFromRequest(req);

    if (!userId) {
        return res.status(401).json({ message: "Invalid token payload" });
    }

    if (!conversationId) {
        return res.status(400).json({ message: "Invalid conversation id" });
    }

    const parsed = messageSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
        message: "Invalid message data",
        errors: parsed.error.flatten(),
        });
    }

    try {
        const membership = await prisma.conversationMember.findUnique({
        where: {
            conversationId_userId: {
            conversationId,
            userId,
            },
        },
        });

        if (!membership) {
        return res.status(403).json({ message: "Access denied to conversation" });
        }

        const message = await prisma.message.create({
        data: {
            conversationId,
            senderId: userId,
            content: parsed.data.content,
        },
        include: {
            sender: {
            select: {
                id: true,
                name: true,
                email: true,
            },
            },
        },
        });

        return res.status(201).json({ message });
    } catch (error) {
        console.error("Sending message failed:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});

export default router;
