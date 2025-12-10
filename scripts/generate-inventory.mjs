import { relative } from "path";
import { fileURLToPath } from "url";
import winston from "winston";
import yargs from "yargs";
import { Inventory } from "../lib/inventory.mjs";

const argv = yargs(process.argv.slice(2))
  .scriptName("dist")
  .usage("$0", "Generate JSON from MDN content")
  .option("ref", {
    describe:
      "Choose a specific ref (commit, branch, or tag) to generate the inventory from",
    type: "string",
    default: "origin/main",
  })
  .option("date", {
    describe:
      "Choose a specific date (in YYYY-MM-DD) to generate the inventory from",
    type: "string",
  })
  .option("verbose", {
    alias: "v",
    describe: "Show more information about calculating the status",
    type: "count",
    default: 0,
    defaultDescription: "warn",
  })
  .option("clean", {
    describe: "Wipe out repo when finished",
    type: "boolean",
    default: false,
  })
  .parseSync();

const logger = winston.createLogger({
  level: argv.verbose > 0 ? "debug" : "warn",
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.simple(),
  ),
  transports: new winston.transports.Console({
    stderrLevels: ["debug", "warn", "info"],
  }),
});

const destPath = relative(process.cwd(), ".mdn-content");

/**
 * Main function to generate and output inventory
 * @returns {Promise<void>}
 */
async function main() {
  const inventory = new Inventory({ destPath, logger });
  try {
    if (argv.date) {
      await inventory.init(argv.ref, argv.date);
    } else {
      await inventory.init(argv.ref);
    }
    console.log(JSON.stringify(inventory.toObject(), undefined, 2));
  } finally {
    if (argv.clean) {
      inventory.cleanUp();
    }
  }
}

if (import.meta.url.startsWith("file:")) {
  if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
  }
}
