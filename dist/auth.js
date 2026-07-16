"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAuth = getAuth;
const mongodb_1 = require("mongodb");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
let _auth = null;
let _authPromise = null;
async function getAuth() {
    if (_auth)
        return _auth;
    if (_authPromise)
        return _authPromise;
    _authPromise = (async () => {
        const [betterAuthMod, adapterMod, pluginsMod] = await Promise.all([
            Promise.resolve().then(() => __importStar(require("better-auth"))),
            Promise.resolve().then(() => __importStar(require("better-auth/adapters/mongodb"))),
            Promise.resolve().then(() => __importStar(require("better-auth/plugins"))),
        ]);
        const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
        const client = new mongodb_1.MongoClient(mongoUri);
        const db = client.db("FosholBari");
        _auth = betterAuthMod.betterAuth({
            database: adapterMod.mongodbAdapter(db),
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
