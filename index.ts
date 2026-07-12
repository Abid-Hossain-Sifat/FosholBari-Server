import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI as string;

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

app.all("/api/auth/*any", toNodeHandler(auth));

app.use(express.json());

const client = new MongoClient(MONGODB_URI);

async function run() {
  try {
    await client.connect();
    console.log("MongoDB connected successfully");

    const db = client.db("FosholBari");

    app.get("/", (req: Request, res: Response) => {
      res.send("Server is running");
    });

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("MongoDB connection failed:", error);
  }
}

run();