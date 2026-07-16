import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

let _auth: any = null;
let _authPromise: Promise<any> | null = null;

export async function getAuth() {
  if (_auth) return _auth;
  if (_authPromise) return _authPromise;

  _authPromise = (async () => {
    const [betterAuthMod, adapterMod, pluginsMod] = await Promise.all([
      import("better-auth"),
      import("better-auth/adapters/mongodb"),
      import("better-auth/plugins"),
    ]);

    const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
    const client = new MongoClient(mongoUri);
    const db = client.db("FosholBari");

    _auth = betterAuthMod.betterAuth({
      database: adapterMod.mongodbAdapter(db),
      trustedOrigins: [process.env.CLIENT_URL as string],
      emailAndPassword: {
        enabled: true,
        autoSignIn: false,
      },
      socialProviders: {
        google: {
          clientId: process.env.CLIENT_ID as string,
          clientSecret: process.env.CLIENT_SECRET as string,
        },
      },
      user: {
        changeEmail: {
          enabled: true,
          updateEmailWithoutVerification: true,
        },
        additionalFields: {
          role: {
            type: "string",
            required: false,
            defaultValue: "Buyer",
            input: true,
          },
          phoneNumber: {
            type: "string",
            required: false,
            input: true,
          },
        },
      },
      plugins: [
        pluginsMod.bearer(),
        pluginsMod.jwt({
          jwt: {
            expirationTime: "7d",
          },
        }),
      ],
    });

    return _auth;
  })();

  return _authPromise;
}
