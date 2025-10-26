import { ApolloServer } from "apollo-server-express";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { useServer } from "graphql-ws/lib/use/ws";
import { WebSocketServer } from "ws";
import { typeDefs } from "./graphql/schema";
import {resolvers} from "./graphql/resolvers";

const app = express();
const httpServer = http.createServer(app);

const schema = makeExecutableSchema({ typeDefs, resolvers });

// Create WebSocket server
const wsServer = new WebSocketServer({
  server: httpServer,
  path: "/graphql",
});

// Attach subscriptions
useServer(
  {
    schema,
    context: (ctx, msg, args) => {
      const auth = (ctx.connectionParams as any)?.authorization;
      const token = typeof auth === "string" ? auth.split(" ")[1] : undefined;
      if (!token) return { userId: null };
      try {
        const payload: any = jwt.verify(token, process.env.JWT_SECRET!);
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
  context: ({ req }) => {
    const token = req.headers.authorization?.split(" ")[1]; // "Bearer <token>"
    if (!token) return { userId: null };

    try {
      const payload: any = jwt.verify(token, process.env.JWT_SECRET!);
      return { userId: payload.userId };
    } catch {
      return { userId: null };
    }
  },
});

await server.start();
server.applyMiddleware({ app });

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}${server.graphqlPath}`);
  console.log(`📡 Subscriptions ready at ws://localhost:${PORT}${server.graphqlPath}`);
});
