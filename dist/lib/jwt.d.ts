import { type JwtPayload, type SignOptions } from "jsonwebtoken";
export declare function signJwt(payload: string | Buffer | object, options?: SignOptions): string;
export declare function verifyJwt(token: string): JwtPayload | string | null;
//# sourceMappingURL=jwt.d.ts.map