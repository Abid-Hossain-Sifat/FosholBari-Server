import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { jwt, bearer } from "better-auth/plugins";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const client = new MongoClient(process.env.MONGODB_URI as string);
const db = client.db("FosholBari");

export const auth = betterAuth({
    database: mongodbAdapter(db),
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
        bearer(),
        jwt({
            jwt: {
                expirationTime: "7d",
            },
        }),
    ],
});