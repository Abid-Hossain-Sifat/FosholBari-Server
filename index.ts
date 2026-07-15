import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth";

dotenv.config();

const app = express();
const PORT = process.env.PORT;
const MONGODB_URI = process.env.MONGODB_URI as string;

app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.all("/api/auth/*any", toNodeHandler(auth));
app.use(express.json({ limit: "10mb" }));

// ─── MongoDB (lazy, cached connection for serverless) ──────────────────────
const client = new MongoClient(MONGODB_URI);
let dbPromise: Promise<import("mongodb").Db> | null = null;

const getDb = async () => {
  if (!dbPromise) {
    dbPromise = client.connect().then(() => client.db("FosholBari"));
  }
  return dbPromise;
};

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

// ══════════════════════════════════════════════════════════════════
// EXPLORE / PRODUCTS
// ══════════════════════════════════════════════════════════════════

// GET /explore  — public list with filter + pagination
app.get("/explore", async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const Exp = db.collection("explore");

    const { categories, tags, maxPrice, sort, page, limit, farmerId, search } =
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

    if (search?.trim()) {
      const searchRegex = { $regex: search.trim(), $options: "i" };
      query.$or = [
        { name: searchRegex },
        { category: searchRegex },
        { tag: searchRegex },
      ];
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
    const db = await getDb();
    const Exp = db.collection("explore");

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
      const db = await getDb();
      const Exp = db.collection("explore");

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

    const db = await getDb();
    const Exp = db.collection("explore");

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

      const db = await getDb();
      const Exp = db.collection("explore");

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

      const db = await getDb();
      const Exp = db.collection("explore");

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

    const db = await getDb();
    const Orders = db.collection("orders");

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

// POST /orders  — buyer places order (Buyer role only)
app.post("/orders", async (req: Request, res: Response) => {
  try {
    const session = await getSession(req);
    if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

    const userRole = (session.user as { role?: string }).role;
    if (userRole !== "Buyer") {
      return res.status(403).send({
        message: "শুধুমাত্র ক্রেতা পণ্য কিনতে পারবেন।",
      });
    }

    const db = await getDb();
    const Exp = db.collection("explore");
    const Orders = db.collection("orders");
    const Profiles = db.collection("profiles");

    const { productId, qty, weight, address, phone } = req.body;
    if (!productId) {
      return res.status(400).send({ message: "productId required" });
    }

    let product;
    try {
      product = await Exp.findOne({ _id: new ObjectId(productId) });
    } catch {
      return res.status(400).send({ message: "Invalid product ID" });
    }
    if (!product) {
      return res.status(404).send({ message: "Product not found" });
    }

    const quantity = Math.max(1, Number(qty) || 1);
    const unitPrice = Number(product.price) || 0;
    const profile = await Profiles.findOne({ userId: session.user.id });

    const order = {
      buyerId: session.user.id,
      buyerName: session.user.name || "",
      farmerId: product.farmerId || "",
      farmerName: product.farmerName || "",
      productId: String(product._id),
      productName: product.name || "",
      productImage: product.image || "",
      unit: product.unit || "",
      weight: weight || product.unit || "",
      qty: quantity,
      price: unitPrice,
      total: unitPrice * quantity,
      address: address || profile?.location || "",
      phone: phone || profile?.phone || (session.user as { phoneNumber?: string }).phoneNumber || "",
      status: "Pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await Orders.insertOne(order);
    res.status(201).send({ ...order, _id: result.insertedId });
  } catch {
    res.status(500).send({ message: "Internal Server Error" });
  }
});

// PATCH /orders/:id  — farmer updates status for their orders
app.patch(
  "/orders/:id",
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const session = await getSession(req);
      if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

      const db = await getDb();
      const Orders = db.collection("orders");

      const userRole = (session.user as { role?: string }).role;
      const { status } = req.body;
      const allowedStatuses = ["Pending", "Shipped", "Delivered", "Cancelled"];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).send({ message: "Invalid status" });
      }

      let orderId: ObjectId;
      try {
        orderId = new ObjectId(req.params.id);
      } catch {
        return res.status(400).send({ message: "Invalid order ID" });
      }

      const existing = await Orders.findOne({ _id: orderId });
      if (!existing) return res.status(404).send({ message: "Order not found" });

      if (userRole === "Farmer") {
        if (existing.farmerId !== session.user.id) {
          return res.status(403).send({ message: "Not your order" });
        }
      } else if (userRole === "Buyer") {
        if (existing.buyerId !== session.user.id || status !== "Cancelled") {
          return res.status(403).send({ message: "Buyers can only cancel their orders" });
        }
      } else {
        return res.status(403).send({ message: "Forbidden" });
      }

      const result = await Orders.findOneAndUpdate(
        { _id: orderId },
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
    const db = await getDb();
    const Demands = db.collection("demands");
    const Users = db.collection("user");
    const Profiles = db.collection("profiles");

    const { my } = req.query;

    let demandsList = [];
    if (my === "true") {
      const session = await getSession(req);
      if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

      demandsList = await Demands.find({ buyerId: session.user.id })
        .sort({ createdAt: -1 })
        .toArray();
    } else {
      demandsList = await Demands.find({})
        .sort({ createdAt: -1 })
        .toArray();
    }

    const hydratedDemands = await Promise.all(
      demandsList.map(async (demand) => {
        try {
          const buyer = await Users.findOne({ _id: new ObjectId(demand.buyerId) });
          const profile = await Profiles.findOne({ userId: demand.buyerId });
          return {
            ...demand,
            buyerName: buyer?.name || demand.buyerName || "অজ্ঞাত ক্রেতা",
            location: profile?.location || demand.location || "অজ্ঞাত স্থান",
          };
        } catch {
          return demand;
        }
      })
    );

    res.send(hydratedDemands);
  } catch {
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.post("/demands", async (req: Request, res: Response) => {
  try {
    const session = await getSession(req);
    if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

    const db = await getDb();
    const Demands = db.collection("demands");
    const Profiles = db.collection("profiles");

    const { crop, qty, budget, deadline, description, productName, quantity, location: bodyLocation } = req.body;
    const finalCrop = crop || productName;
    const finalQty = qty || quantity;

    if (!finalCrop || !finalQty)
      return res.status(400).send({ message: "crop/productName and qty/quantity required" });

    const profile = await Profiles.findOne({ userId: session.user.id });
    const location = bodyLocation || profile?.location || "";

    const demand = {
      buyerId: session.user.id,
      buyerName: session.user.name,
      location,
      productName: finalCrop,
      crop: finalCrop,
      quantity: finalQty,
      qty: finalQty,
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

app.post(
  "/demands/:id/comments",
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const session = await getSession(req);
      if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

      const userRole = (session.user as { role?: string }).role;
      if (userRole !== "Farmer") {
        return res.status(403).send({ message: "শুধুমাত্র কৃষকরা প্রস্তাব বা মন্তব্য করতে পারবেন।" });
      }

      const db = await getDb();
      const Demands = db.collection("demands");

      const { text } = req.body;
      if (!text || !text.trim()) {
        return res.status(400).send({ message: "Comment text is required" });
      }

      const newComment = {
        id: new ObjectId().toString(),
        authorId: session.user.id,
        authorName: session.user.name,
        authorRole: "farmer",
        text: text.trim(),
        time: new Date(),
      };

      const result = await Demands.findOneAndUpdate(
        { _id: new ObjectId(req.params.id) },
        {
          $push: { comments: newComment } as any,
          $inc: { responses: 1 },
        },
        { returnDocument: "after" }
      );

      if (!result) return res.status(404).send({ message: "Demand not found" });
      res.send(result);
    } catch {
      res.status(500).send({ message: "Internal Server Error" });
    }
  }
);

app.patch(
  "/demands/:id",
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const session = await getSession(req);
      if (!session?.user) return res.status(401).send({ message: "Unauthorized" });

      const db = await getDb();
      const Demands = db.collection("demands");

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

      const db = await getDb();
      const Demands = db.collection("demands");

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

    const db = await getDb();
    const BazarNotes = db.collection("bazar_notes");

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

    const db = await getDb();
    const BazarNotes = db.collection("bazar_notes");

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

      const db = await getDb();
      const BazarNotes = db.collection("bazar_notes");

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

      const db = await getDb();
      const BazarNotes = db.collection("bazar_notes");

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

    const db = await getDb();
    const Profiles = db.collection("profiles");

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

    const db = await getDb();
    const Profiles = db.collection("profiles");

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

    const db = await getDb();
    const Exp = db.collection("explore");
    const Orders = db.collection("orders");

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

    const db = await getDb();
    const Orders = db.collection("orders");

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

// ══════════════════════════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════════════════════════

app.get("/", (_req: Request, res: Response) => {
  res.send("FosholBari Server is running");
});

// ─── Vercel serverless export ───────────────────────────────────────────────
// Vercel calls this exported handler directly; it must NOT call app.listen().
export default app;

// ─── Local development only ─────────────────────────────────────────────────
// Runs a real listening server when you do `node index.ts` / `ts-node index.ts`
// locally. On Vercel this branch never executes because VERCEL is set to "1".
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}