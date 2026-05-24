import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

let latestPlayers = [];

app.use(express.static(path.join(__dirname, "../dashboard")));

app.get("/health", (req, res) => {
    res.status(200).json({
        ok: true
    });
});

app.get("/api/players", (req, res) => {

    res.json({
        players: latestPlayers
    });

});

app.post("/fivem/update", (req, res) => {

    console.log("FiveM Update Received:");
    console.log(req.body);

    latestPlayers = req.body.players || [];

    res.status(200).json({
        success: true
    });

});

app.get("*", (req, res) => {

    res.sendFile(path.join(__dirname, "../dashboard/index.html"));

});

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {

    console.log(`FounderBot API running on port ${PORT}`);

});
