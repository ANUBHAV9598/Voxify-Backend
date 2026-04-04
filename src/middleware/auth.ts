import type { JwtPayload } from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { verifyJwt } from "../lib/jwt.js";
import prisma from "../lib/prisma.js";

export interface AuthenticatedRequest extends Request {
    user?: JwtPayload | string;
}

const AUTH_COOKIE_NAME = "voxify_auth";

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

export const getRequestToken = (req: Request) => {
    const authHeader = req.headers.authorization;

    if (authHeader) {
        const [scheme, token] = authHeader.split(" ");

        if (scheme === "Bearer" && token) {
            return token;
        }
    }

    return getCookieValue(req.headers.cookie, AUTH_COOKIE_NAME);
};

export const authMiddleware = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
) => {
    const token = getRequestToken(req);

    if (!token) {
        return res.status(401).json({ message: "Authentication is required" });
    }

    const decoded = verifyJwt(token);

    if (!decoded || typeof decoded === "string" || !decoded.sub) {
        return res.status(401).json({ message: "Invalid or expired token" });
    }

    const user = await prisma.user.findUnique({
        where: { id: decoded.sub },
        select: { sessionId: true }
    });

    if (user?.sessionId !== decoded.sessionId) {
        return res.status(401).json({ message: "Session expired. You logged in on another device." });
    }

    req.user = decoded;
    next();
};

export { AUTH_COOKIE_NAME };
