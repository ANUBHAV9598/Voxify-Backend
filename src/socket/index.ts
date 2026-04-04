import { z } from "zod";
import type { Server, Socket } from "socket.io";
import prisma from "../lib/prisma.js";
import { verifyJwt } from "../lib/jwt.js";
import { AUTH_COOKIE_NAME } from "../middleware/auth.js";

type PresenceUpdatePayload = {
  userId: string;
  isOnline: boolean;
  lastSeen: string | null;
};

type PresenceSyncPayload = {
  userIds?: string[];
};

type MessageSendPayload = {
  conversationId: string;
  content: string;
};

type TypingPayload = {
  conversationId: string;
};

const conversationJoinSchema = z.object({
  conversationId: z.string().uuid("conversationId must be a valid UUID"),
});

const messageSendSchema = z.object({
  conversationId: z.string().uuid("conversationId must be a valid UUID"),
  content: z.string().trim().min(1, "Message content is required"),
});

const typingSchema = z.object({
  conversationId: z.string().uuid("conversationId must be a valid UUID"),
});

const userConnectionCounts = new Map<string, number>();

const getCookieValue = (cookieHeader: string | undefined, key: string) => {
  if (!cookieHeader) {
    return null;
  }

  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`));

  if (!cookie) {
    return null;
  }

  const value = cookie.slice(key.length + 1);
  return value ? decodeURIComponent(value) : null;
};

const getSocketToken = (socket: Socket) => {
  const authToken = socket.handshake.auth.token;

  if (typeof authToken === "string" && authToken.trim().length > 0) {
    return authToken.startsWith("Bearer ") ? authToken.slice(7) : authToken;
  }

  const authorization = socket.handshake.headers.authorization;

  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    return authorization.slice(7);
  }

  return getCookieValue(socket.handshake.headers.cookie, AUTH_COOKIE_NAME);
};

const getUserIdFromSocket = (socket: Socket) => {
  const userId = socket.data.userId;
  return typeof userId === "string" ? userId : null;
};

const emitPresenceUpdate = (
  io: Server,
  payload: PresenceUpdatePayload,
  room?: string,
) => {
  if (room) {
    io.to(room).emit("presence:update", payload);
    return;
  }

  io.emit("presence:update", payload);
};

const markUserOnline = async (io: Server, userId: string) => {
  const nextCount = (userConnectionCounts.get(userId) ?? 0) + 1;
  userConnectionCounts.set(userId, nextCount);

  if (nextCount > 1) {
    return;
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      isOnline: true,
    },
  });

  emitPresenceUpdate(io, {
    userId,
    isOnline: true,
    lastSeen: null,
  });
};

const markUserOffline = async (io: Server, userId: string) => {
  const currentCount = userConnectionCounts.get(userId) ?? 0;
  const nextCount = Math.max(currentCount - 1, 0);

  if (nextCount > 0) {
    userConnectionCounts.set(userId, nextCount);
    return;
  }

  userConnectionCounts.delete(userId);

  const lastSeen = new Date();

  await prisma.user.update({
    where: { id: userId },
    data: {
      isOnline: false,
      lastSeen,
    },
  });

  emitPresenceUpdate(io, {
    userId,
    isOnline: false,
    lastSeen: lastSeen.toISOString(),
  });
};

const isConversationMember = async (userId: string, conversationId: string) => {
  const membership = await prisma.conversationMember.findUnique({
    where: {
      conversationId_userId: {
        conversationId,
        userId,
      },
    },
  });

  return Boolean(membership);
};

const handlePresenceSync = async (
  io: Server,
  socket: Socket,
  userId: string,
  payload?: PresenceSyncPayload,
) => {
  const requestedUserIds =
    Array.isArray(payload?.userIds) && payload.userIds.length > 0
      ? Array.from(new Set(payload.userIds))
      : null;

  const users = requestedUserIds
    ? await prisma.user.findMany({
        where: {
          id: { in: requestedUserIds },
        },
        select: {
          id: true,
          isOnline: true,
          lastSeen: true,
        },
      })
    : await prisma.user.findMany({
        where: {
          id: { not: userId },
          memberships: {
            some: {
              conversation: {
                members: {
                  some: { userId },
                },
              },
            },
          },
        },
        select: {
          id: true,
          isOnline: true,
          lastSeen: true,
        },
      });

  users.forEach((user) => {
    emitPresenceUpdate(
      io,
      {
        userId: user.id,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen?.toISOString() ?? null,
      },
      socket.id,
    );
  });
};

export const registerSocketHandlers = (io: Server) => {
  io.use((socket, next) => {
    const token = getSocketToken(socket);

    if (!token) {
      next(new Error("Authentication token is required"));
      return;
    }

    const decoded = verifyJwt(token);

    if (!decoded || typeof decoded === "string" || !decoded.sub) {
      next(new Error("Invalid or expired token"));
      return;
    }

    socket.data.userId = String(decoded.sub);
    next();
  });

  io.on("connection", async (socket) => {
    const userId = getUserIdFromSocket(socket);

    if (!userId) {
      socket.disconnect();
      return;
    }

    socket.join(`user:${userId}`);

    try {
      await markUserOnline(io, userId);
    } catch (error) {
      console.error("Failed to mark user online:", error);
    }

    socket.on("conversation:join", async (payload) => {
      const parsed = conversationJoinSchema.safeParse(payload);

      if (!parsed.success) {
        socket.emit("conversation:error", {
          message: "Invalid conversation join payload",
        });
        return;
      }

      try {
        const isMember = await isConversationMember(
          userId,
          parsed.data.conversationId,
        );

        if (!isMember) {
          socket.emit("conversation:error", {
            message: "Access denied to conversation",
          });
          return;
        }

        socket.join(`conversation:${parsed.data.conversationId}`);
      } catch (error) {
        console.error("Failed to join conversation room:", error);
        socket.emit("conversation:error", {
          message: "Failed to join conversation",
        });
      }
    });

    socket.on("message:send", async (payload: MessageSendPayload) => {
      const parsed = messageSendSchema.safeParse(payload);

      if (!parsed.success) {
        socket.emit("message:error", {
          message: "Invalid message payload",
          errors: parsed.error.flatten(),
        });
        return;
      }

      try {
        const { conversationId, content } = parsed.data;
        const isMember = await isConversationMember(userId, conversationId);

        if (!isMember) {
          socket.emit("message:error", {
            message: "Access denied to conversation",
          });
          return;
        }

        const message = await prisma.message.create({
          data: {
            conversationId,
            senderId: userId,
            content,
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

        io.to(`conversation:${conversationId}`).emit("message:new", message);
      } catch (error) {
        console.error("Failed to send realtime message:", error);
        socket.emit("message:error", {
          message: "Failed to send message",
        });
      }
    });

    socket.on("typing:start", async (payload: TypingPayload) => {
      const parsed = typingSchema.safeParse(payload);

      if (!parsed.success) {
        return;
      }

      try {
        const isMember = await isConversationMember(
          userId,
          parsed.data.conversationId,
        );

        if (!isMember) {
          return;
        }

        socket.to(`conversation:${parsed.data.conversationId}`).emit("typing:update", {
          conversationId: parsed.data.conversationId,
          userId,
          isTyping: true,
        });
      } catch (error) {
        console.error("Failed to emit typing start:", error);
      }
    });

    socket.on("typing:stop", async (payload: TypingPayload) => {
      const parsed = typingSchema.safeParse(payload);

      if (!parsed.success) {
        return;
      }

      try {
        const isMember = await isConversationMember(
          userId,
          parsed.data.conversationId,
        );

        if (!isMember) {
          return;
        }

        socket.to(`conversation:${parsed.data.conversationId}`).emit("typing:update", {
          conversationId: parsed.data.conversationId,
          userId,
          isTyping: false,
        });
      } catch (error) {
        console.error("Failed to emit typing stop:", error);
      }
    });

    socket.on("presence:sync", async (payload?: PresenceSyncPayload) => {
      try {
        await handlePresenceSync(io, socket, userId, payload);
      } catch (error) {
        console.error("Failed to sync presence:", error);
        socket.emit("presence:error", {
          message: "Failed to sync presence",
        });
      }
    });

    socket.on("disconnect", async () => {
      socket.broadcast.emit("typing:update", {
        conversationId: null,
        userId,
        isTyping: false,
      });

      try {
        await markUserOffline(io, userId);
      } catch (error) {
        console.error("Failed to mark user offline:", error);
      }
    });
  });
};
