import express from "express";

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send("Unova Management Dashboard Online");
});

app.post("/fivem/update", (req, res) => {
  console.log("FiveM update received:", req.body);
  res.status(200).json({ ok: true });
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Unova Management dashboard listening on port ${PORT}`);
});
