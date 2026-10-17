import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import jwt from 'jsonwebtoken';
import { typeDefs } from './graphql/typeDefs';
import { resolvers } from './graphql/resolvers';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/munshi';

const startServer = async () => {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
  });

  await server.start();

  app.use(
    '/graphql',
    expressMiddleware(server, {
      context: async ({ req }) => {
        const authHeader = req.headers.authorization;
        let user = null;
        
        if (authHeader) {
          const token = authHeader.split(' ')[1];
          try {
            user = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
          } catch (e) {
            // Invalid token
          }
        }
        
        return { user };
      },
    })
  );

  mongoose.connect(MONGO_URI, {dbName:'munshi'})
    .then(() => {
      console.log('Connected to MongoDB');
      app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}/graphql`);
      });
    })
    .catch((err) => {
      console.error('MongoDB connection error:', err);
    });
};

startServer();
