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
      try {
        const categories = req.query.categories as string | undefined;
        const tags = req.query.tags as string | undefined;
        const maxPrice = req.query.maxPrice as string | undefined;
        const sort = req.query.sort as string | undefined;
        const pageParam = req.query.page as string | undefined;
        const limitParam = req.query.limit as string | undefined;

        const PAGE_LIMIT = limitParam ? Math.max(1, Number(limitParam)) : 6;
        const currentPage = pageParam ? Math.max(1, Number(pageParam)) : 1;
        const skip = (currentPage - 1) * PAGE_LIMIT;

        const query: any = {};

        // 1. Category Filter
        if (categories && typeof categories === "string" && categories.trim() !== "") {
          const categoriesList = categories.split(",").map(c => c.trim());
          if (categoriesList.length > 0) {
            query.category = { $in: categoriesList };
          }
        }

        // 2. Tag Filter
        if (tags && typeof tags === "string" && tags.trim() !== "") {
          const tagsList = tags.split(",").map(t => t.trim());
          if (tagsList.length > 0) {
            query.tag = { $in: tagsList };
          }
        }

        // 3. Price Filter
        if (maxPrice) {
          const priceLimit = Number(maxPrice);
          if (!isNaN(priceLimit)) {
            query.price = { $lte: priceLimit };
          }
        }

        const sortQuery: any = {};
        // 4. Sort
        if (sort === "price-asc") {
          sortQuery.price = 1;
        } else if (sort === "price-desc") {
          sortQuery.price = -1;
        } else {
          sortQuery._id = -1;
        }

        // 5. Pagination
        const totalCount = await Exp.countDocuments(query);
        const totalPages = Math.ceil(totalCount / PAGE_LIMIT);

        const data = await Exp.find(query)
          .sort(sortQuery)
          .skip(skip)
          .limit(PAGE_LIMIT)
          .toArray();

        res.send({ data, totalCount, totalPages, currentPage });
      } catch (error) {
        console.error("Error fetching explore items:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.get("/explore/filters", async (req: Request, res: Response) => {
      try {
        const categories = await Exp.distinct("category");
        const tags = await Exp.distinct("tag");
        res.send({ categories, tags });
      } catch (error) {
        console.error("Error fetching filters:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
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