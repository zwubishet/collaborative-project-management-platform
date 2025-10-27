import { ApolloServer } from "apollo-server-express";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { authRouter } from "./routes/auth";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { useServer } from "graphql-ws/lib/use/ws";
import { WebSocketServer } from "ws";
import { typeDefs } from "./graphql/schema";
import { resolvers } from "./graphql/resolvers";
import { PrismaClient } from "@prisma/client";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "./utils/token";

const prisma = new PrismaClient();
const app = express();
const httpServer = http.createServer(app);

// Middleware
app.use(cookieParser());
app.use("/auth", express.json(), authRouter);

// GraphQL schema
const schema = makeExecutableSchema({ typeDefs, resolvers });

// WebSocket server for subscriptions
const wsServer = new WebSocketServer({
  server: httpServer,
  path: "/graphql",
});

// GraphQL subscriptions context
useServer(
  {
    schema,
    context: async (ctx) => {
      const auth = (ctx.connectionParams as any)?.authorization;
      const token = typeof auth === "string" ? auth.split(" ")[1] : undefined;
      if (!token) return { userId: null };
      try {
        const payload: any = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!);
        return { userId: payload.userId };
      } catch {
        return { userId: null };
      }
    },
  },
  wsServer
);

// Apollo server with automatic cookie refresh support
const server = new ApolloServer({
  schema,
  introspection: true,
  context: async ({ req, res }) => {
    let userId: number | null = null;

    // Check access token
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(" ")[1];
    if (token) {
      try {
        const payload: any = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!);
        userId = payload.userId;
      } catch {
        // Access token expired, try refresh token from cookie
        const refreshToken = req.cookies.refreshToken;
        if (refreshToken) {
          const device = await prisma.userDevice.findUnique({ where: { refreshToken } });
          if (device && !device.isRevoked) {
            try {
              const payload: any = verifyRefreshToken(refreshToken);

              // Rotate refresh token
              await prisma.userDevice.updateMany({
                where: { refreshToken },
                data: { isRevoked: true },
              });
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

              // Set new refresh token cookie
              res.cookie("refreshToken", newRefreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "strict",
                path: "/auth/refresh",
              });

              userId = payload.userId;

              // Optionally send new access token in header
              res.setHeader("x-access-token", newAccessToken);
            } catch {
              userId = null;
            }
          }
        }
      }
    }

    return { userId, req, res };
  },
});

await server.start();
server.applyMiddleware({ app });

// Start HTTP + WS server
const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}${server.graphqlPath}`);
  console.log(`📡 Subscriptions ready at ws://localhost:${PORT}${server.graphqlPath}`);
});
