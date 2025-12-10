import { Temporal } from "@js-temporal/polyfill";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { fileURLToPath } from "node:url";
import winston from "winston";
import yargs from "yargs";

const argv = yargs(process.argv.slice(2))
  .scriptName("publish-historic")
  .usage("$0", "Publish historic releases")
  .option("dry-run", {
    alias: "n",
    describe: "Don't actually publish to npm",
    type: "boolean",
    default: true,
  })
  .option("continue", {
    describe: "Continue to the next release, if a release already exists",
    type: "boolean",
    default: false,
  })
  .option("verbose", {
    alias: "v",
    describe: "Show more information about calculating the status",
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
    stderrLevels: ["debug", "warn", "info"],
  }),
});

const START_DATE = Temporal.Instant.from(
  "2023-10-01T00:00:00.000Z",
).toZonedDateTimeISO("UTC");

function main() {
  const now = Temporal.Now.zonedDateTimeISO("UTC");
  let target = START_DATE;

  while (Temporal.ZonedDateTime.compare(target, now) < 1) {
    npmRun("clean");
    npmRun("build", `--date=${target.toString()}`);

    const forthcomingVersion = JSON.parse(
      readFileSync("package/package.json", { encoding: "utf-8" }),
    ).version;
    const forthcomingHash = JSON.parse(
      readFileSync("package/index.json", { encoding: "utf-8" }),
    ).metadata.commitShort;

    const forthcomingDate = target.toString().slice(0, 10).replaceAll("-", "");
    logger.debug(
      `Attempting to publish for ${forthcomingDate} and ${forthcomingHash} as ${forthcomingVersion}`,
    );

    let alreadyPublished: false | string = false;
    for (const version of Object.keys(completedReleases())) {
      if (
        version.includes(forthcomingDate) ||
        version.includes(forthcomingHash)
      ) {
        alreadyPublished = `${forthcomingDate} or ${forthcomingHash} is already published as ${forthcomingVersion}`;
      }
    }

    if (alreadyPublished) {
      if (argv.continue) {
        logger.warn(`${alreadyPublished}; skipping this release`);
      } else {
        throw new Error(alreadyPublished);
      }
    } else {
      if (argv.dryRun) {
        npmRun("publish:dry-run");
      } else {
        npmRun("publish");
      }
    }

    npmRun("clean");
    target = target.add({ days: 1 });
  }
}

function npmRun(command: string, ...moreArgs: string[]) {
  if (moreArgs.length > 0) {
    moreArgs.unshift("--");
  }

  execFileSync("npm", ["run", command, ...moreArgs], {
    stdio: "inherit",
  });
}

function completedReleases(): Record<string, string> {
  try {
    return JSON.parse(
      execFileSync(
        "npm",
        ["view", "@mdn/content-inventory", "time", "--json"],
        { stdio: "pipe", encoding: "utf-8" },
      ),
    );
  } catch (err) {
    return {};
  }
}

if (import.meta.url.startsWith("file:")) {
  if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
  }
}
