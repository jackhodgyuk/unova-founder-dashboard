import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.status(200).send("FounderBot Dashboard Online");
});

app.post("/fivem/update", (req, res) => {

    console.log("FiveM Update Received:");
    console.log(req.body);

    res.status(200).json({
        success: true
    });

});

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {

    console.log(`FounderBot API running on port ${PORT}`);

});
