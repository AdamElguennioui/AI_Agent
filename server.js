const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("Shopify app is running");
});

app.get("/auth/callback", (req, res) => {
  res.send("Auth callback ok");
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Listening on ${port}`);
});
