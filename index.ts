import { ApolloServer } from "apollo-server-express";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { authRouter } from "./routes/authRoutes";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { useServer } from "graphql-ws/lib/use/ws";
import { WebSocketServer } from "ws";
import { typeDefs } from "./graphql/schema";
import { resolvers } from "./graphql/resolvers";
import { PrismaClient } from "@prisma/client";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "./utils/token";
import { ApolloServerPluginLandingPageGraphQLPlayground } from "apollo-server-core";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();


const prisma = new PrismaClient();
const app = express();
const httpServer = http.createServer(app);

app.use(cookieParser());
app.use("/auth", express.json(), authRouter);
app.use(
  cors({
    origin: "http://localhost:5173", // your frontend
    credentials: true, // needed if you use cookies
  })
);

// GraphQL schema
const schema = makeExecutableSchema({ typeDefs, resolvers });

// WebSocket server for subscriptions
const wsServer = new WebSocketServer({
  server: httpServer,
  path: "/subscriptions",
});

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

// Apollo server
const server = new ApolloServer({
  schema,
  introspection: true,
  plugins: [
    ApolloServerPluginLandingPageGraphQLPlayground(), // ← Now real!
  ],
  context: async ({ req, res }) => {
    let userId: number | null = null;

    const authHeader = req.headers.authorization;
    const token = authHeader?.split(" ")[1];

    if (token) {
      try {
        const payload: any = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!);
        userId = payload.userId;
      } catch {
        const refreshToken = req.cookies.refreshToken;
        if (refreshToken) {
          const device = await prisma.userDevice.findUnique({ where: { refreshToken } });
          if (device && !device.isRevoked) {
            try {
              const payload: any = verifyRefreshToken(refreshToken);

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

              res.cookie("refreshToken", newRefreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "strict",
                path: "/",
              });

              res.setHeader("x-access-token", newAccessToken);
              userId = payload.userId;
            } catch {
              userId = null;
            }
          }
        }
      }
    }

    return { prisma, userId, req, res };
  },
});

await server.start();
server.applyMiddleware({
  app,
  cors: {
    origin: [
      "http://localhost:5173",
      "https://studio.apollographql.com",
    ],
    credentials: true,
  },
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}${server.graphqlPath}`);
  console.log(`Subscriptions ready at ws://localhost:${PORT}${server.graphqlPath}`);
});