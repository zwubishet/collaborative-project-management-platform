import express from 'express';
import { ApolloServer } from 'apollo-server-express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { typeDefs } from './graphql/schema';
import { resolvers } from './graphql/resolvers';

dotenv.config();

const app = express();
app.use(cors()); // keep CORS if needed

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET!;

async function startServer() {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: ({ req }) => {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace('Bearer ', '');
      if (!token) return { userId: null };

      try {
        const payload: any = jwt.verify(token, JWT_SECRET);
        return { userId: payload.userId };
      } catch {
        return { userId: null };
      }
    },
  });

  await server.start();
  server.applyMiddleware({ app, path: '/graphql' });

  app.get('/', (_, res) => res.send('Backend running with Bun + Express + Apollo! 🚀'));

  app.listen(PORT, () => {
    console.log(`✅ Server ready at http://localhost:${PORT}${server.graphqlPath}`);
  });
}

startServer();
