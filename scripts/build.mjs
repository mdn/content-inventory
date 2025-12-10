import { Temporal } from "@js-temporal/polyfill";
import { copyFileSync, readFileSync, writeFileSync } from "fs";
import assert from "node:assert";
import winston from "winston";
import yargs from "yargs";
import { Inventory } from "../lib/inventory.mjs";

const argv = yargs(process.argv.slice(2))
  .scriptName("build")
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
    describe: "Show more informational messages",
    type: "count",
    default: 0,
    defaultDescription: "warn",
  })
  .parseSync();

const logger = winston.createLogger({
  level: argv.verbose > 0 ? "debug" : "warn",
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.simple(),
  ),
  transports: new winston.transports.Console({
    stderrLevels: ["debug", "info", "warn"],
  }),
});

await main();

/**
 * Main function to generate inventory and package.json
 * @returns {Promise<void>}
 */
async function main() {
  const publishDate = Temporal.PlainDate.from(
    argv.date ?? Temporal.Now.zonedDateTimeISO(),
  )
    .toZonedDateTime({ timeZone: "UTC", plainTime: "00:00:01" })
    .startOfDay();

  logger.info("Generating inventory…");
  await makeInventoryJSON();

  logger.info("Creating package.json…");
  makePackageJSON({ publishDate });

  logger.info("Copying readme.md");
  copyFileSync("readme.md", "package/readme.md");
}

/**
 * Generate the inventory JSON file
 * @returns {Promise<void>}
 */
async function makeInventoryJSON() {
  const startOfDay = Temporal.PlainDate.from(
    argv.date ?? Temporal.Now.zonedDateTimeISO(),
  )
    .toZonedDateTime({ timeZone: "UTC", plainTime: "00:00:01" })
    .startOfDay();

  const inv = new Inventory({ logger });
  await inv.init(argv.ref, startOfDay.toString());

  writeFileSync(
    "package/index.json",
    JSON.stringify(inv.toObject(), undefined),
    { encoding: "utf8" },
  );
}

/**
 * Generate the package.json file for the package
 * @param {{ publishDate: Temporal.ZonedDateTime }} opts
 * @returns {void}
 */
function makePackageJSON(opts) {
  const { publishDate } = opts;

  const { name, version, description, repository, author } = JSON.parse(
    readFileSync("package.json", { encoding: "utf-8" }),
  );

  copyFileSync("LICENSE.txt", "package/LICENSE.txt");

  const [major, minor, patch] = version.split(".");
  for (const versionPart of [major, minor, patch]) {
    assert(typeof versionPart === "string");
  }

  writeFileSync(
    "package/package.json",
    JSON.stringify(
      {
        name,
        version: `${major}.${minor}.${publishDate.toString().slice(0, 10).replaceAll("-", "")}`,
        description,
        repository,
        author,
        license: "CC-BY-SA-2.5",
        main: "index.mjs",
        type: "module",
        scripts: {},
      },
      undefined,
      2,
    ),
    { encoding: "utf-8" },
  );
}
