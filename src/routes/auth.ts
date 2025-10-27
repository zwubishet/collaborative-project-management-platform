import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "../utils/token";
import { authMiddleware } from "../middleware/AuthMiddleware";

export const prisma = new PrismaClient();
export const authRouter = Router();

authRouter.post("/register",  async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: "All fields required" });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing)
      return res.status(400).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { name, email, password: hashedPassword, role: "OWNER" },
    });

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    await prisma.userDevice.create({
      data: {
        userId: user.id,
        refreshToken,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      },
    });

    res.json({
      message: "User registered successfully",
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

authRouter.post("/login",  async (req, res) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  console.log("User found:", user);
  if (!user) return res.status(400).json({ message: "No user found!" });

  const valid = await bcrypt.compare(password, user.password);
  console.log("Password valid:", valid);
  if (!valid) return res.status(400).json({ message: "Invalid credentials" });

  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);

  await prisma.userDevice.create({
    data: {
      userId: user.id,
      refreshToken,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    },
  });

  res.json({ accessToken, refreshToken });
});

authRouter.get("/profile", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });

  if (!user) return res.status(404).json({ message: "User not found" });
  res.json(user);
});

authRouter.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ message: "Missing token" });

  const device = await prisma.userDevice.findUnique({ where: { refreshToken } });
  if (!device || device.isRevoked)
    return res.status(403).json({ message: "Invalid token" });

  try {
    const payload: any = verifyRefreshToken(refreshToken);
    const newAccessToken = generateAccessToken(payload.userId);

    res.json({ accessToken: newAccessToken });
  } catch {
    res.status(403).json({ message: "Token expired or invalid" });
  }
});

authRouter.post("/logout", async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ message: "Missing token" });

  await prisma.userDevice.updateMany({
    where: { refreshToken },
    data: { isRevoked: true },
  });

  res.json({ message: "Logged out successfully" });
});
