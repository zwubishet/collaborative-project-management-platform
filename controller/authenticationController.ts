import type { Request, Response } from "express";
import { prisma } from "../routes/authRoutes";
import bcrypt from "bcryptjs";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "../utils/token";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};

export const userRegister = async (req: Request, res: Response) => {
  const { name, email, password } = req.body;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) return res.status(400).json({ message: "User already exists" });

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: { name, email, password: hashedPassword },
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

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });

  res.status(201).json({ accessToken });
};

export const userLogin = async (req: Request, res: Response) => {
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
}

export const userProfile = async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });

  if (!user) return res.status(404).json({ message: "User not found" });
  res.json(user);
}


export const refreshTokenHandler = async (req: Request, res: Response) => {
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
}

export const userLogout = async (req: Request, res: Response) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) return res.status(400).json({ message: "Missing token" });

  await prisma.userDevice.updateMany({ where: { refreshToken }, data: { isRevoked: true } });

  // Clear cookie
  res.clearCookie("refreshToken", { path: "/auth/refresh" });

  res.json({ message: "Logged out successfully" });
}
