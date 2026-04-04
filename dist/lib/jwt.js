import jwt, {} from "jsonwebtoken";
import { JWT_SECRET } from "../config/secret.js";
export function signJwt(payload, options) {
    return jwt.sign(payload, JWT_SECRET, options);
}
export function verifyJwt(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=jwt.js.map