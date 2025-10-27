import { ApolloServer } from "apollo-server-express";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { authRouter } from "./routes/auth";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { useServer } from "graphql-ws/lib/use/ws";
import { WebSocketServer } from "ws";
import { typeDefs } from "./graphql/schema";
import { resolvers } from "./graphql/resolvers";
import { authMiddleware } from "./middleware/AuthMiddleware";

const app = express();
const httpServer = http.createServer(app);

// Only parse JSON for REST routes
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
    context: (ctx) => {
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

// Apollo server for GraphQL queries and mutations
const server = new ApolloServer({
  schema,
  introspection: true,
  context: ({ req }) => {
    const token = req.headers.authorization?.split(" ")[1]; // Bearer <token>
    if (!token) return { userId: null };
    try {
      const payload: any = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!);
      return { userId: payload.userId };
    } catch {
      return { userId: null };
    }
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
