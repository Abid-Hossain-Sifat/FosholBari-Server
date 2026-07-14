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

app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.all("/api/auth/*any", toNodeHandler(auth));
app.use(express.json({ limit: "10mb" }));

const client = new MongoClient(MONGODB_URI);

// ─── Session helper ────────────────────────────────────────────────────────
const getSession = async (req: Request) => {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
    }
    return await auth.api.getSession({ headers });
  } catch {
    return null;
  }
};

const run = async () => {
  try {
    await client.connect();
    const db = client.db("FosholBari");
    const Exp = db.collection("explore");
    const Orders = db.collection("orders");
    const Demands = db.collection("demands");
    const BazarNotes = db.collection("bazar_notes");
    const Profiles = db.collection("profiles");

    // ══════════════════════════════════════════════════════════════════
    // EXPLORE / PRODUCTS
    // ══════════════════════════════════════════════════════════════════

    // GET /explore  — public list with filter + pagination
    app.get("/explore", async (req: Request, res: Response) => {
      try {
        const { categories, tags, maxPrice, sort, page, limit, farmerId } =
          req.query as Record<string, string>;

        const PAGE_LIMIT = limit ? Math.max(1, Number(limit)) : 6;
        const currentPage = page ? Math.max(1, Number(page)) : 1;
        const skip = (currentPage - 1) * PAGE_LIMIT;

        const query: any = {};
        if (farmerId) query.farmerId = farmerId;
        if (categories?.trim())
          query.category = { $in: categories.split(",").map((c) => c.trim()) };
        if (tags?.trim())
          query.tag = { $in: tags.split(",").map((t) => t.trim()) };
        if (maxPrice) {
          const p = Number(maxPrice);
          if (!isNaN(p)) query.price = { $lte: p };
        }

        const sortQuery: any =
          sort === "price-asc"
            ? { price: 1 }
            : sort === "price-desc"
            ? { price: -1 }
            : { _id: -1 };

        const totalCount = await Exp.countDocuments(query);
        const totalPages = Math.ceil(totalCount / PAGE_LIMIT);
        const data = await Exp.find(query)
          .sort(sortQuery)
          .skip(skip)
          .limit(PAGE_LIMIT)
          .toArray();

        res.send({ data, totalCount, totalPages, currentPage });
      } catch {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // GET /explore/filters
    app.get("/explore/filters", async (_req: Request, res: Response) => {
      try {
        const categories = await Exp.distinct("category");
        const tags = await Exp.distinct("tag");
        res.send({ categories, tags });
      } catch {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // GET /explore/:id
    app.get(
      "/explore/:id",
      async (req: Request<{ id: string }>, res: Response) => {
        try {
          const item = await Exp.findOne({ _id: new ObjectId(req.params.id) });
          if (!item) return res.status(404).send({ message: "Product not found" });
          res.send(item);
        } catch {
          res.status(400).send({ message: "Invalid ID" });
        }
      }
    );

    // POST /explore  — farmer adds product
    app.post("/explore", async (req: Request, res: Response) => {
      try {
        const session = await getSession(req);
        if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

        const {
          name,
          tag,
          category,
          unit,
          price,
          originalPrice,
          image,
          description,
          bulletPoints,
        } = req.body;

        if (!name || !price || !category)
          return res.status(400).send({ message: "name, price, category required" });

        const product = {
          name,
          tag: tag || "",
          category,
          unit: unit || "প্রতি কেজি",
          price: Number(price),
          originalPrice: originalPrice ? Number(originalPrice) : null,
          image: image || "",
          description: description || "",
          bulletPoints: Array.isArray(bulletPoints)
            ? bulletPoints.filter(Boolean)
            : [],
          farmerId: session.user.id,
          farmerName: session.user.name,
          stock: 0,
          sales: 0,
          createdAt: new Date(),
        };

        const result = await Exp.insertOne(product);
        res.status(201).send({ ...product, _id: result.insertedId });
      } catch {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // PATCH /explore/:id  — update product (farmer only)
    app.patch(
      "/explore/:id",
      async (req: Request<{ id: string }>, res: Response) => {
        try {
          const session = await getSession(req);
          if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

          const allowed = [
            "name","tag","category","unit","price","originalPrice",
            "image","description","bulletPoints","stock",
          ];
          const updateFields: any = {};
          for (const key of allowed) {
            if (req.body[key] !== undefined) {
              updateFields[key] = ["price", "originalPrice", "stock"].includes(key)
                ? Number(req.body[key])
                : req.body[key];
            }
          }

          const result = await Exp.findOneAndUpdate(
            { _id: new ObjectId(req.params.id), farmerId: session.user.id },
            { $set: updateFields },
            { returnDocument: "after" }
          );

          if (!result)
            return res.status(404).send({ message: "Not found or unauthorized" });
          res.send(result);
        } catch {
          res.status(500).send({ message: "Internal Server Error" });
        }
      }
    );

    // DELETE /explore/:id  — farmer only
    app.delete(
      "/explore/:id",
      async (req: Request<{ id: string }>, res: Response) => {
        try {
          const session = await getSession(req);
          if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

          const result = await Exp.deleteOne({
            _id: new ObjectId(req.params.id),
            farmerId: session.user.id,
          });
          if (result.deletedCount === 0)
            return res.status(404).send({ message: "Not found or unauthorized" });
          res.send({ message: "Deleted" });
        } catch {
          res.status(500).send({ message: "Internal Server Error" });
        }
      }
    );

    // ══════════════════════════════════════════════════════════════════
    // ORDERS
    // ══════════════════════════════════════════════════════════════════

    // GET /orders?role=buyer|farmer
    app.get("/orders", async (req: Request, res: Response) => {
      try {
        const session = await getSession(req);
        if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

        const role = req.query.role as string;
        const query: any = {};
        if (role === "buyer") query.buyerId = session.user.id;
        else if (role === "farmer") query.farmerId = session.user.id;
        else return res.status(400).send({ message: "role required: buyer|farmer" });

        const orders = await Orders.find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.send(orders);
      } catch {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // POST /orders  — buyer places order
    app.post("/orders", async (req: Request, res: Response) => {
      try {
        const session = await getSession(req);
        if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

        const {
          productId,
          productName,
          farmerId,
          farmerName,
          qty,
          price,
          address,
          phone,
        } = req.body;

        const order = {
          buyerId: session.user.id,
          buyerName: session.user.name,
          farmerId: farmerId || "",
          farmerName: farmerName || "",
          productId: productId || "",
          productName: productName || "",
          qty: Number(qty),
          price: Number(price),
          total: Number(price) * Number(qty),
          address: address || "",
          phone: phone || "",
          status: "Pending",
          createdAt: new Date(),
        };

        const result = await Orders.insertOne(order);
        res.status(201).send({ ...order, _id: result.insertedId });
      } catch {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // PATCH /orders/:id  — update status (farmer updates; buyer can cancel)
    app.patch(
      "/orders/:id",
      async (req: Request<{ id: string }>, res: Response) => {
        try {
          const session = await getSession(req);
          if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

          const { status } = req.body;
          const result = await Orders.findOneAndUpdate(
            { _id: new ObjectId(req.params.id) },
            { $set: { status, updatedAt: new Date() } },
            { returnDocument: "after" }
          );
          if (!result) return res.status(404).send({ message: "Order not found" });
          res.send(result);
        } catch {
          res.status(500).send({ message: "Internal Server Error" });
        }
      }
    );

    // ══════════════════════════════════════════════════════════════════
    // DEMANDS
    // ══════════════════════════════════════════════════════════════════

    app.get("/demands", async (req: Request, res: Response) => {
      try {
        const session = await getSession(req);
        if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

        const demands = await Demands.find({ buyerId: session.user.id })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(demands);
      } catch {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.post("/demands", async (req: Request, res: Response) => {
      try {
        const session = await getSession(req);
        if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

        const { crop, qty, budget, deadline, description } = req.body;
        if (!crop || !qty)
          return res.status(400).send({ message: "crop and qty required" });

        const demand = {
          buyerId: session.user.id,
          buyerName: session.user.name,
          crop,
          qty,
          budget: budget || "",
          deadline: deadline || "",
          description: description || "",
          responses: 0,
          status: "Active",
          createdAt: new Date(),
        };

        const result = await Demands.insertOne(demand);
        res.status(201).send({ ...demand, _id: result.insertedId });
      } catch {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.patch(
      "/demands/:id",
      async (req: Request<{ id: string }>, res: Response) => {
        try {
          const session = await getSession(req);
          if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

          const result = await Demands.findOneAndUpdate(
            { _id: new ObjectId(req.params.id), buyerId: session.user.id },
            { $set: { ...req.body, updatedAt: new Date() } },
            { returnDocument: "after" }
          );
          if (!result) return res.status(404).send({ message: "Not found" });
          res.send(result);
        } catch {
          res.status(500).send({ message: "Internal Server Error" });
        }
      }
    );

    app.delete(
      "/demands/:id",
      async (req: Request<{ id: string }>, res: Response) => {
        try {
          const session = await getSession(req);
          if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

          const result = await Demands.deleteOne({
            _id: new ObjectId(req.params.id),
            buyerId: session.user.id,
          });
          if (result.deletedCount === 0)
            return res.status(404).send({ message: "Not found" });
          res.send({ message: "Deleted" });
        } catch {
          res.status(500).send({ message: "Internal Server Error" });
        }
      }
    );

    // ══════════════════════════════════════════════════════════════════
    // BAZAR NOTES
    // ══════════════════════════════════════════════════════════════════

    app.get("/bazar-notes", async (req: Request, res: Response) => {
      try {
        const session = await getSession(req);
        if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

        const notes = await BazarNotes.find({ buyerId: session.user.id })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(notes);
      } catch {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.post("/bazar-notes", async (req: Request, res: Response) => {
      try {
        const session = await getSession(req);
        if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

        const { cropName, quantity, estimatedBudget, notes } = req.body;
        if (!cropName)
          return res.status(400).send({ message: "cropName required" });

        const note = {
          buyerId: session.user.id,
          cropName,
          quantity: quantity || "",
          estimatedBudget: estimatedBudget || "",
          notes: notes || "",
          isCompleted: false,
          createdAt: new Date(),
        };

        const result = await BazarNotes.insertOne(note);
        res.status(201).send({ ...note, _id: result.insertedId });
      } catch {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.patch(
      "/bazar-notes/:id",
      async (req: Request<{ id: string }>, res: Response) => {
        try {
          const session = await getSession(req);
          if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

          const result = await BazarNotes.findOneAndUpdate(
            { _id: new ObjectId(req.params.id), buyerId: session.user.id },
            { $set: req.body },
            { returnDocument: "after" }
          );
          if (!result) return res.status(404).send({ message: "Not found" });
          res.send(result);
        } catch {
          res.status(500).send({ message: "Internal Server Error" });
        }
      }
    );

    app.delete(
      "/bazar-notes/:id",
      async (req: Request<{ id: string }>, res: Response) => {
        try {
          const session = await getSession(req);
          if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

          const result = await BazarNotes.deleteOne({
            _id: new ObjectId(req.params.id),
            buyerId: session.user.id,
          });
          if (result.deletedCount === 0)
            return res.status(404).send({ message: "Not found" });
          res.send({ message: "Deleted" });
        } catch {
          res.status(500).send({ message: "Internal Server Error" });
        }
      }
    );

    // ══════════════════════════════════════════════════════════════════
    // EXTENDED PROFILE  (farmName, farmLocation, bio, nid, payment, location …)
    // ══════════════════════════════════════════════════════════════════

    app.get("/profile", async (req: Request, res: Response) => {
      try {
        const session = await getSession(req);
        if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

        const profile = await Profiles.findOne({ userId: session.user.id });
        res.send(profile || {});
      } catch {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.patch("/profile", async (req: Request, res: Response) => {
      try {
        const session = await getSession(req);
        if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

        const result = await Profiles.findOneAndUpdate(
          { userId: session.user.id },
          { $set: { ...req.body, userId: session.user.id, updatedAt: new Date() } },
          { upsert: true, returnDocument: "after" }
        );
        res.send(result);
      } catch {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // ══════════════════════════════════════════════════════════════════
    // STATS
    // ══════════════════════════════════════════════════════════════════

    app.get("/stats/farmer", async (req: Request, res: Response) => {
      try {
        const session = await getSession(req);
        if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

        const farmerId = session.user.id;
        const [
          totalProducts,
          outOfStock,
          totalOrders,
          pendingOrders,
          revenueResult,
          recentOrders,
        ] = await Promise.all([
          Exp.countDocuments({ farmerId }),
          Exp.countDocuments({ farmerId, stock: 0 }),
          Orders.countDocuments({ farmerId }),
          Orders.countDocuments({ farmerId, status: "Pending" }),
          Orders.aggregate([
            { $match: { farmerId, status: "Delivered" } },
            { $group: { _id: null, total: { $sum: "$total" } } },
          ]).toArray(),
          Orders.find({ farmerId }).sort({ createdAt: -1 }).limit(5).toArray(),
        ]);

        res.send({
          totalProducts,
          outOfStock,
          totalOrders,
          pendingOrders,
          totalRevenue: revenueResult[0]?.total || 0,
          recentOrders,
        });
      } catch {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.get("/stats/buyer", async (req: Request, res: Response) => {
      try {
        const session = await getSession(req);
        if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

        const buyerId = session.user.id;
        const [totalOrders, activeOrders, spentResult, recentOrders] =
          await Promise.all([
            Orders.countDocuments({ buyerId }),
            Orders.countDocuments({
              buyerId,
              status: { $in: ["Pending", "Shipped"] },
            }),
            Orders.aggregate([
              { $match: { buyerId } },
              { $group: { _id: null, total: { $sum: "$total" } } },
            ]).toArray(),
            Orders.find({ buyerId }).sort({ createdAt: -1 }).limit(3).toArray(),
          ]);

        res.send({
          totalOrders,
          activeOrders,
          totalSpent: spentResult[0]?.total || 0,
          recentOrders,
        });
      } catch {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("✅ MongoDB Connected — FosholBari");
  } catch (error) {
    console.error(error);
  }
};

run();

app.get("/", (_req: Request, res: Response) => {
  res.send("FosholBari Server is running 🌾");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});