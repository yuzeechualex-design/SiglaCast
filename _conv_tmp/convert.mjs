import { readFileSync, writeFileSync } from "node:fs";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { toDocx } from "@m2d/core";
import { tablePlugin } from "@m2d/table";

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) {
  console.error("Usage: node convert.mjs <input.md> <output.docx>");
  process.exit(1);
}

const markdown = readFileSync(input, "utf8");
const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);

const buf = await toDocx(
  tree,
  { title: "SiglaCast ITP Documentation" },
  { plugins: [tablePlugin()] },
  "nodebuffer"
);
writeFileSync(output, buf);
console.log("Wrote:", output);
