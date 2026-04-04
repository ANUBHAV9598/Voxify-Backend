import { Router } from "express";
import type { CookieOptions } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { signJwt } from "../lib/jwt.js";
import {
  AUTH_COOKIE_NAME,
  authMiddleware,
  type AuthenticatedRequest,
} from "../middleware/auth.js";

const router = Router();

const signupSchema = z.object({
    name: z.string().trim().min(2, "Name must be at least 2 characters"),
    email: z.email().trim().toLowerCase(),
    password: z.string().min(6, "Password must be at least 6 characters"),
});

const loginSchema = z.object({
    email: z.email().trim().toLowerCase(),
    password: z.string().min(1, "Password is required"),
});

const forgotPasswordSchema = z.object({
    email: z.email().trim().toLowerCase(),
    newPassword: z.string().min(6, "Password must be at least 6 characters"),
});

const authCookieOptions: CookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
};

const clearAuthCookieOptions: CookieOptions = {
    ...authCookieOptions,
    maxAge: 0,
};

router.post("/signup", async (req, res) => {
    const parsed = signupSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
        message: "Invalid signup data",
        errors: parsed.error.flatten(),
        });
    } 

    const { name, email, password } = parsed.data;

    try {
        const existingUser = await prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            return res.status(409).json({ message: "Email is already registered" });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
        data: {
            name,
            email,
            passwordHash,
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

        const token = signJwt(
        { sub: user.id, email: user.email, name: user.name },
        { expiresIn: "7d" },
        );

        res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions);

        return res.status(201).json({
        message: "Signup successful",
            user,
        });
    } catch (error) {
        console.error("Signup failed:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
    });

    router.post("/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
        message: "Invalid login data",
        errors: parsed.error.flatten(),
        });
    }

    const { email, password } = parsed.data;

    try {
        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

        if (!isPasswordValid) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        const token = signJwt(
            { sub: user.id, email: user.email, name: user.name },
            { expiresIn: "7d" },
        );

        res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions);

        return res.status(200).json({
            message: "Login successful",
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                isOnline: user.isOnline,
                lastSeen: user.lastSeen,
                createdAt: user.createdAt,
            },
        });
    } catch (error) {
        console.error("Login failed:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
    });

router.post("/forgot-password", async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Invalid password reset data",
            errors: parsed.error.flatten(),
        });
    }

    const { email, newPassword } = parsed.data;

    try {
        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);

        await prisma.user.update({
            where: { email },
            data: { passwordHash },
        });

        return res.status(200).json({ message: "Password reset successful" });
    } catch (error) {
        console.error("Forgot password failed:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});

router.post("/logout", (_req, res) => {
    res.clearCookie(AUTH_COOKIE_NAME, clearAuthCookieOptions);
    return res.status(200).json({ message: "Logout successful" });
});

    router.get("/me", authMiddleware, async (req: AuthenticatedRequest, res) => {
    const payload = req.user;

    if (!payload || typeof payload === "string" || !payload.sub) {
        return res.status(401).json({ message: "Invalid token payload" });
    }

    try {
        const user = await prisma.user.findUnique({
            where: { id: String(payload.sub) },
            select: {
                id: true,
                name: true,
                email: true,
                isOnline: true,
                lastSeen: true,
                createdAt: true,
            },
        });

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        return res.status(200).json({ user });
    } catch (error) {
        console.error("Fetching current user failed:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});

export default router;
