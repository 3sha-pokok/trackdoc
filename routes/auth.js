import express from "express";
import { getAuthUrl, getOAuth2Client } from "../services/google.js";

const router = express.Router();

// Google login
router.get("/google", (req, res) => {
  const url = getAuthUrl();
  res.redirect(url);
});

// Google callback
router.get("/google/callback", async (req, res) => {
  try {
    const code = req.query.code;

    if (!code) {
      return res.redirect("/");
    }

    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    oauth2Client.setCredentials(tokens);

    // store tokens in session
    req.session.tokens = tokens;

    // redirect to submit doc page
    res.redirect("/docs/submit");
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.redirect("/");
  }
});

// Logout
router.get("/logout", (req, res) => {
  req.session = null;
  res.redirect("/");
});

export default router;
