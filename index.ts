import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
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

const run = async () => {
  try {
    await client.connect();
    const db = client.db("FosholBari");
    const Exp = db.collection("explore");

    app.get("/explore", async (req: Request, res: Response) => {
      const cursor = Exp.find();
      const final = await cursor.toArray();
      res.send(final);
    });

    app.get("/explore/:id", async (req: Request<{ id: string }>, res: Response) => {
        try {
          const item = await Exp.findOne({
            _id: new ObjectId(req.params.id),
          });

          if (!item) {
            return res.status(404).send({ message: "Product not found" });
          }

          res.send(item);
        } catch (error) {
          res.status(400).send({ message: "Invalid ID" });
        }
      }
    );

    await client.db("admin").command({ ping: 1 });
    console.log("ping Deployed");
  } catch (error) {
    console.error(error);
  }
};

run();

app.get("/", (req: Request, res: Response) => {
  res.send("Server is running");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});