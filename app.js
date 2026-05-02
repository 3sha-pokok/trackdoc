import "dotenv/config";
import express from "express";
import path from "path";
import cookieSession from "cookie-session";
import { fileURLToPath } from "url";

import authRouter from "./routes/auth.js";
import docsRouter from "./routes/docs.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* ------------------ VIEW ENGINE ------------------ */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

/* ------------------ MIDDLEWARE ------------------ */
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  cookieSession({
    name: "trackdoc_sess",
    keys: [process.env.SESSION_SECRET || "dev_secret"],
    maxAge: 24 * 60 * 60 * 1000, // ✅ REQUIRED
    httpOnly: true,
    sameSite: "lax",
  })
);

/* ------------------ ROUTES ------------------ */

// ✅ LANDING PAGE (FIRST PAGE)
app.get("/", (req, res) => {
  res.render("login");
});

// Auth & Docs routes
app.use("/auth", authRouter);
app.use("/docs", docsRouter);

/* ------------------ SERVER ------------------ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TrackDoc running at http://localhost:${PORT}`);
});
