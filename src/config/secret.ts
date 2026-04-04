const jwtSecret = process.env.ACCESS_TOKEN_SECRET;

if (!jwtSecret) {
    throw new Error("ACCESS_TOKEN_SECRET is not set");
}

export const JWT_SECRET = jwtSecret;
