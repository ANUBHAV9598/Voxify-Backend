import type { JwtPayload } from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
export interface AuthenticatedRequest extends Request {
    user?: JwtPayload | string;
}
declare const AUTH_COOKIE_NAME = "voxify_auth";
export declare const getRequestToken: (req: Request) => string | null;
export declare const authMiddleware: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
export { AUTH_COOKIE_NAME };
//# sourceMappingURL=auth.d.ts.map