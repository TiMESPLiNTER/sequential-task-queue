// Renders src/readme.template.md -> readme.md, injecting labeled code
// snippets extracted from examples/examples.ts (marked with
// "--- snippet: <name> ---" / "--- snip ---" comments, see snip-text).
var fs = require("fs");
var path = require("path");
var snip = require("snip-text");
var template = require("lodash/template");

var examplesSource = fs.readFileSync(path.join(__dirname, "../examples/examples.ts"), "utf8");
var examples = snip(examplesSource, { unindent: true });

var templatePath = path.join(__dirname, "../src/readme.template.md");
var outPath = path.join(__dirname, "../readme.md");

var render = template(fs.readFileSync(templatePath, "utf8"));
fs.writeFileSync(outPath, render({ examples: examples }));
