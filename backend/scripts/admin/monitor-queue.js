#!/usr/bin/env node
const max = Number(process.argv[2] || 20);
const history = [];
setInterval(() => {
  history.push({ at: new Date().toISOString(), queueDepth: Math.floor(Math.random() * 10) });
  if (history.length > max) history.shift();
  console.clear();
  console.log("SiglaCast Queue Monitor");
  history.forEach((item) => console.log(item.at, "depth=", item.queueDepth));
}, 2000);
