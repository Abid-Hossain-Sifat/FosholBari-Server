"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.auth = void 0;
const better_auth_1 = require("better-auth");
const mongodb_1 = require("better-auth/adapters/mongodb");
const plugins_1 = require("better-auth/plugins");
const mongodb_2 = require("mongodb");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const client = new mongodb_2.MongoClient(process.env.MONGODB_URI);
const db = client.db("FosholBari");
exports.auth = (0, better_auth_1.betterAuth)({
    database: (0, mongodb_1.mongodbAdapter)(db),
    trustedOrigins: [process.env.CLIENT_URL],
    emailAndPassword: {
        enabled: true,
        autoSignIn: false,
    },
    socialProviders: {
        google: {
            clientId: process.env.CLIENT_ID,
            clientSecret: process.env.CLIENT_SECRET,
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
        (0, plugins_1.bearer)(),
        (0, plugins_1.jwt)({
            jwt: {
                expirationTime: "7d",
            },
        }),
    ],
});
