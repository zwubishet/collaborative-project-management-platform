import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "../utils/token";
import { authMiddleware } from "../middleware/AuthMiddleware";
import {userRegister, userLogin, refreshTokenHandler, userLogout, userProfile} from "../controller/authentication";

export const prisma = new PrismaClient();
export const authRouter = Router();

// Cookie options
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};

authRouter.post("/register", userRegister);

authRouter.post("/login", userLogin);

authRouter.post("/refresh", refreshTokenHandler);

authRouter.post("/logout", userLogout);

authRouter.get("/profile", authMiddleware, userProfile);
