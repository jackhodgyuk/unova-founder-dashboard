import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(express.json());

app.get('/', (req, res) => {
    res.send('FounderBot Dashboard Online');
});

app.post('/fivem/update', (req, res) => {

    console.log(req.body);

    res.sendStatus(200);

});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
    console.log(`FounderBot running on port ${PORT}`);
});
