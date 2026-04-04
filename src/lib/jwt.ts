import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import { JWT_SECRET } from "../config/secret.js";

export function signJwt(
    payload: string | Buffer | object,
    options?: SignOptions,
): string {
    return jwt.sign(payload, JWT_SECRET, options);
}

export function verifyJwt(token: string): JwtPayload | string | null {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch {
        return null;
    }
}
