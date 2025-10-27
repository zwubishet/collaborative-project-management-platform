import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "../utils/token";
import { authMiddleware } from "../middleware/AuthMiddleware";

export const prisma = new PrismaClient();
export const authRouter = Router();

// Cookie options
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/auth/refresh", // cookie only sent to /auth/refresh
};

// --- REGISTER ---
authRouter.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: "All fields required" });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, password: hashedPassword, role: "OWNER" },
    });

    // Generate tokens
    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    // Save refresh token in DB
    await prisma.userDevice.create({
      data: {
        userId: user.id,
        refreshToken,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      },
    });

    // Set refresh token as HTTP-only cookie
    res.cookie("refreshToken", refreshToken, cookieOptions);

    res.json({
      message: "User registered successfully",
      accessToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// --- LOGIN ---
authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(400).json({ message: "No user found!" });

  const valid = await bcrypt.compare(password, user.password);
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

  res.cookie("refreshToken", refreshToken, cookieOptions);

  res.json({ accessToken });
});

// --- REFRESH TOKEN ---
authRouter.post("/refresh", async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) return res.status(401).json({ message: "Missing token" });

    const device = await prisma.userDevice.findUnique({ where: { refreshToken } });
    if (!device || device.isRevoked) return res.status(403).json({ message: "Invalid token" });

    let payload: any;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      await prisma.userDevice.updateMany({ where: { refreshToken }, data: { isRevoked: true } });
      return res.status(403).json({ message: "Token expired or invalid" });
    }

    // Rotate refresh token
    await prisma.userDevice.updateMany({ where: { refreshToken }, data: { isRevoked: true } });
    const newAccessToken = generateAccessToken(payload.userId);
    const newRefreshToken = generateRefreshToken(payload.userId);

    await prisma.userDevice.create({
      data: {
        userId: payload.userId,
        refreshToken: newRefreshToken,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      },
    });

    // Update cookie
    res.cookie("refreshToken", newRefreshToken, cookieOptions);

    res.json({ accessToken: newAccessToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// --- LOGOUT ---
authRouter.post("/logout", async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) return res.status(400).json({ message: "Missing token" });

  await prisma.userDevice.updateMany({ where: { refreshToken }, data: { isRevoked: true } });

  // Clear cookie
  res.clearCookie("refreshToken", { path: "/auth/refresh" });

  res.json({ message: "Logged out successfully" });
});

// --- PROFILE ---
authRouter.get("/profile", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });

  if (!user) return res.status(404).json({ message: "User not found" });
  res.json(user);
});
